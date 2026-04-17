# Knowstr architecture

## Direction decided on 2026-04-16

The app should not keep two different collaboration models.

Target model:

- one graph/editor product
- stable node UUIDs as the semantic identity across all modes
- two storage backends only:
  - local filesystem workspace
  - Nostr
- two trust modes layered over either backend:
  - single-user direct: one identity owns the graph, edits write through immediately
  - multi-user inbox/merge: foreign authors land in an inbox and are triaged via apply

The current frontend multi-user model based on follows, visible foreign documents, and deep-copy acceptance is now legacy and should be removed rather than adapted further.

## Refined on 2026-04-17

The unified inbox/merge framing was too strong. Inbox/merge is the *multi-trust* mechanic, not the always-on mechanic. A single trusted writer (human alone, or human plus a trusted AI agent) should not have to triage their own changes. So we explicitly support two modes:

- **single-user direct**: every writer is trusted, edits land in the graph immediately, conflicts resolve per-node last-writer-wins
- **multi-user inbox**: untrusted authors write into an inbox, the owner triages via apply

Trust level is a configuration concern, not a separate product. The CEO use case (graph mostly managed by a trusted AI agent, occasional human edits) runs in single-user direct mode. If trust in that agent later breaks, the agent is promoted to its own user identity and the same multi-user inbox/suggestion mechanic takes over without a new code path.

## Target product model

### Shared semantics everywhere

Regardless of backend, the user experience should be built around:

- your own graph
- stable node UUIDs as the semantic identity
- optional `knowstr_doc_id` as document-thread packaging metadata
- when more than one identity writes: incoming inbox content and `knowstr apply`-style merge/triage

Cross-user collaboration, when it exists, should happen through inbox/merge — not through foreign trees appearing live in the main graph and being copied with fresh ids. Single-trust setups skip the inbox entirely.

### The only backend difference

#### Filesystem backend

- source of truth: markdown files in `workspace_dir`
- normalization: `knowstr save` serialization (reused, not reimplemented)
- default mode: **single-user direct**
  - UI mutations write through to disk immediately — no save button, no publish queue, no deferred batching like Nostr has
  - external file changes (e.g. an AI agent writing markdown) flow back into the live graph via a file watcher
  - conflicts between UI and external writes resolve per-node last-writer-wins; in practice the two writers rarely touch the same node at the same instant
  - no inbox in this mode
- optional mode: **multi-user inbox** via `knowstr apply`, used when an additional identity (e.g. a no-longer-trusted agent) writes into the workspace
- external actors: humans and agents editing the same files
- primary use case: a single owner whose graph is mostly managed by a trusted AI agent, with the owner editing/reordering/relevance-tagging through the rich UI

#### Nostr backend

- source of truth: document events on relays
- same graph semantics as filesystem mode
- multi-user inbox/merge mechanic transported via Nostr instead of folders on disk
- writes are deferred/batched as required by the relay publish model — this is a backend-specific behavior, not a shared one

So the architectural difference is storage/transport plus the trust topology each backend naturally exposes, not the editor or graph semantics.

## What becomes legacy

These frontend mechanics are not the target direction and should be treated as removable:

- follow-based visibility as the main collaboration/query model
- foreign authors' documents just showing up in the normal graph
- deep-copy acceptance that assigns new ids as the main merge mechanic
- suggestion/version UX that assumes `basedOn` lineage is the primary multi-user sharing model

Some code from that stack may still be reusable, but the product semantics should not depend on it.

## Stable pieces worth keeping

### Editor/planner layer

Keep and reuse:

- React tree editor UI
- planner mutation model
- `views` / `panes`
- document serialization from affected roots
- `DocumentStoreProvider`-style graph materialization boundary

The editor mostly wants graph state plus a persistence backend.

### CLI/workspace pipeline

Keep and reuse:

- `src/core/workspaceSave.ts`
- `src/core/workspaceApply.ts`
- `extractMarkdownImportPayload()`
- `parseWorkspaceDocumentRoots()`
- `buildDocumentEventFromMarkdownTree()`
- `parseDocumentEvent()`

This is already the canonical filesystem representation.

## BackendProvider boundary (decided 2026-04-17)

The storage seam in the renderer is a `BackendProvider` + `BackendContext` that sits where `NostrProvider` sits today. `useBackend()` exposes `subscribe(filters)` and `publish(events)` to the rest of the tree. `NostrBackendProvider` is the first implementation; `FilesystemBackendProvider` will be the second.

The migration is staged so each step is shippable on its own:

1. Add `BackendContext` + `NostrBackendProvider` wrapping today's `relayPool`. No callers change.
2. Migrate `useEventQuery` callers (Data.tsx, UserRelayContextProvider, etc.) to `useBackend().subscribe`.
3. Migrate `planner.execute()` from `relayPool.publish` to `useBackend().publish`. After this, planner is backend-agnostic.
4. Build `FilesystemBackendProvider` in Electron main, exposed via IPC. Synthesizes `UnsignedEvent`s from markdown using the existing CLI serialization helpers.
5. File watcher in main pushes external file changes through the same `subscribe` channel.
6. First-run folder picker decides which provider to mount.

### Short-term shape vs target shape

For v1, `subscribe` mirrors today's Nostr-flavored signature (filters, OrderedMap of events keyed by event id, EOSE flag) so the migration is mechanical and call sites change minimally. The filesystem backend will ignore filters and just emit all workspace documents — `DocumentStore` already consumes everything, so this works.

**This is a transitional shape, not the destination.** Event-and-filter logic in the renderer is the wrong long-term abstraction: it leaks Nostr semantics into a layer that should only know about documents and document changes. Once the filesystem backend lands and we have two real implementations to compare, refactor `BackendContext` to a document-centric shape (load documents, subscribe to document changes, persist documents) and delete the event/filter machinery from the renderer entirely. The Nostr backend keeps the event/filter machinery internally; it just stops surfacing it through the Provider.

## Recommended app architecture

Build around a backend interface roughly shaped like:

- load documents
- subscribe/refresh documents (file watcher in filesystem mode, relay subscription in Nostr mode)
- persist a single-node mutation (eager in filesystem mode, queued/published in Nostr mode)
- persist affected roots (used by save/normalization)
- run inbox apply (only used when multi-user mode is active)
- run normalization/save

Then provide two implementations:

- workspace backend
- Nostr backend

The app above that boundary should be the same editor in both cases. Whether the inbox UI is reachable depends on trust mode, not on backend.

## Immediate practical consequence

The first implementation step should be a desktop Electron wrapper around the existing app with the Nostr backend only.

Why this is the right first milestone:

- minimal product change
- proves the desktop shell, packaging, auth, and relay behavior
- keeps knowstr.com behavior unchanged
- creates the place where filesystem support can be added next without first solving two things at once

After that, add the filesystem backend inside the Electron app.

The implementation should still move toward the long-term shape where Nostr and filesystem share the same inbox/merge semantics instead of reviving the current frontend multi-user behavior.

## UX note

The shared backend architecture does not require a shared entry UX.

- knowstr.com can stay direct and online-only if that deployment has no filesystem capability
- the first Electron version can also open directly into Nostr mode
- only later, when Electron actually supports both sources, should it add a simple opener such as `Open folder` / `Open Nostr`
- the internal model may unify around the same editor + inbox/apply semantics, while the entry flow remains deployment-specific

## Storage and sync are orthogonal (decided 2026-04-17)

A cleaner mental model than "pick a backend per launch":

- **Data always lives locally.** Either in IndexedDB (browser) or on the filesystem (desktop, CLI). There is no remote-only mode.
- **Nostr is a sync/sharing layer on top of local storage.** It mirrors all data to relays so other identities/devices can read or contribute.
- Nostr sync is **optional on filesystem** (the CEO local-only case turns it off) and **effectively required in the browser** (otherwise IndexedDB data is trapped in one browser session).
- **Sharing always happens through Nostr.** Filesystem alone has no sharing story; if you want to share, you turn on sync.

### Implications

- **Web app architecture flips.** The web should treat IndexedDB as the source of truth and Nostr as a sync mirror, rather than treating relays as source of truth and IndexedDB as cache. Side effect: web becomes offline-capable. Cost: must reconcile offline local writes against relay state on reconnect.
- **No mode picker in the desktop opener.** Electron's opener just picks a workspace folder. "Sync to Nostr" is a setting (identity + relays), not a launch-time choice. This collapses the earlier deployment-mode matrix into one launch flow per surface.
- **Same identity across surfaces.** UI, CLI, and the sync watcher all reuse the workspace identity (e.g. `~/.knowstr/profile.json` or its workspace-local equivalent). Do not introduce per-surface keypairs.

### CLI

- Data lives in the workspace dir, same as Electron filesystem mode.
- A long-running `knowstr watch` (or `knowstr sync --watch`) command provides the sync layer for headless use, mirroring the workspace ↔ relays.
- Reuses the workspace identity; no separate keypair for the CLI.

### Surface summary

| Surface | Local storage | Nostr sync |
|---|---|---|
| knowstr.com (browser) | IndexedDB | required |
| Electron, local-only | filesystem | off |
| Electron, synced | filesystem | on (setting) |
| CLI | filesystem | optional, via `watch` daemon |

## Important constraint

Do not build a new filesystem-only mutation stack and do not invest further in the current follow/deep-copy multi-user model.

The clean path is:

- remove legacy frontend multi-user semantics from the product direction
- keep one editor
- keep one merge model
- swap only the persistence backend
