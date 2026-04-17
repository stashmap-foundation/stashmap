# Knowstr architecture

## Direction decided on 2026-04-16

The app should not keep two different collaboration models.

Target model:

- one graph/editor product
- one collaboration mechanic: inbox/merge with stable node UUIDs
- two storage backends only:
  - local filesystem workspace
  - Nostr

The current frontend multi-user model based on follows, visible foreign documents, and deep-copy acceptance is now legacy and should be removed rather than adapted further.

## Target product model

### Shared semantics everywhere

Regardless of backend, the user experience should be built around:

- your own graph
- incoming inbox content
- `knowstr apply`-style merge/triage
- stable node UUIDs as the semantic identity
- optional `knowstr_doc_id` as document-thread packaging metadata

Cross-user collaboration should happen through inbox/merge, not through foreign trees appearing live in the main graph and being copied with fresh ids.

### The only backend difference

#### Filesystem backend

- source of truth: markdown files in `workspace_dir`
- normalization: `knowstr save`
- inbox ingestion: `knowstr apply`
- external actors: humans and agents editing the same files

#### Nostr backend

- source of truth: document events on relays
- same graph semantics as filesystem mode
- same inbox/merge mechanic, but transported/stored via Nostr instead of folders on disk

So the architectural difference is storage/transport, not merge semantics.

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

## Recommended app architecture

Build around a backend interface roughly shaped like:

- load documents
- subscribe/refresh documents
- persist affected roots
- run inbox apply
- run normalization/save

Then provide two implementations:

- workspace backend
- Nostr backend

The app above that boundary should be the same single-user/inbox editor in both cases.

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

## Important constraint

Do not build a new filesystem-only mutation stack and do not invest further in the current follow/deep-copy multi-user model.

The clean path is:

- remove legacy frontend multi-user semantics from the product direction
- keep one editor
- keep one merge model
- swap only the persistence backend
