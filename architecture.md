# Architecture

Stashmap is a decentralized knowledge tool built on Nostr. The app stores and syncs trees of `Relations`, not a separate node graph. Tree structure is relation-first; semantic matching is an explicit secondary subsystem.

## Current Status

This document reflects the code as of March 10, 2026.

Important architectural cuts that are already done:
- `KnowledgeData.nodes` is gone
- `Relations.head` and stored `Relations.context` are gone
- `cref` is `cref:relationID` only
- `~versions` / hidden rename-history subtrees are gone
- document persistence is the only runtime write format
- `~Log` is an explicit system root, not a semantic special case

## Core Data Model

### IDs

- `ID`: short 32-char semantic/content identifier
- `LongID`: relation UUID with author prefix, e.g. `pubkey_uuid`
- `PublicKey`: Nostr pubkey

Current identifier meanings:
- `relationID`: a concrete relation UUID (`LongID`)
- `semanticID`: semantic/content identity, currently `relation.textHash`
- `rowID`: view-layer row identifier
  - may be a `relationID`
  - may be `cref:relationID`
  - may be a search ID
  - may be the temporary empty-row placeholder ID

Search IDs still use `search:query`.

Concrete references use:
- `cref:relationID`

There is no `nodeID` concept in the runtime architecture anymore.

### KnowledgeDB

Each author has one `KnowledgeData`:

```ts
type KnowledgeData = {
  relations: OrderedMap<string, Relations>;
}
```

`KnowledgeDBs` is `Map<PublicKey, KnowledgeData>`.

The app merges multiple authors' relation sets for display, but relations remain author-owned.

### Relations

`Relations` is the tree object:

```ts
type Relations = {
  id: LongID;
  items: List<RelationItem>;
  text: string;
  textHash: ID;
  parent?: LongID;
  root: ID;
  author: PublicKey;
  updated: number;
  basedOn?: LongID;
  anchor?: RootAnchor;
  systemRole?: "log";
  userPublicKey?: PublicKey;
}
```

Important invariants:
- `id` is the structural identity
- `text` is the visible label
- `textHash` is the semantic identity
- `parent` is the only stored structural ancestry link
- `root` groups relations into one persisted document
- `userPublicKey` binds a row to a stable followed pubkey even if the visible label is renamed
- standalone roots satisfy `root === shortID(id)`

`RelationItem` is the parent-child edge:

```ts
type RelationItem = {
  id: LongID | ID;
  relevance: Relevance;
  argument?: Argument;
  virtualType?: VirtualType;
  isCref?: boolean;
  linkText?: string;
}
```

Interpretation:
- normal children point to child relation IDs
- refs point to `cref:relationID`
- virtual rows are view-layer projections over relation items

### Root Anchors

Stored context was replaced by explicit root-only anchor metadata:

```ts
type RootAnchor = {
  snapshotContext: Context;
  snapshotLabels?: string[];
  sourceAuthor?: PublicKey;
  sourceRootID?: ID;
  sourceRelationID?: LongID;
  sourceParentRelationID?: LongID;
}
```

Purpose:
- preserve semantic origin for standalone subtree forks/copies
- support breadcrumb/source navigation
- keep footer/list semantic matching stable even if the live source moves

Rules:
- only standalone roots may carry `anchor`
- non-roots derive semantic context from `parent` chain
- roots derive semantic context from `anchor.snapshotContext`

### System Roots

Special roots are explicit metadata now, not semantic conventions.

Currently supported:
- `systemRole: "log"`

`~Log` is the display text for the `"log"` system root, but root identity is the `systemRole`, not the text hash.

Operational rules:
- system roots can be created lazily from UI actions
- system roots are queried via the `#s` tag
- system roots should not be auto-added back into `~Log`

Contacts now preserve their lightweight metadata on read:
- `mainRelay`
- `userName`

Rows can also persist a dedicated `userPublicKey` field in document markdown attrs.
That field is what lets follow/unfollow keep working after a row is renamed from an `npub`
to a friendlier label like `:robot: gardener`.

UI rule:
- rows with `userPublicKey` should look distinct in the existing gutter/marker system
- the current implementation uses a gutter `@`, with muted color for a bound user entry and green for a followed one
- this is separate from the violet `@` used for suggestion rows

There is no reserved `~users` system root anymore. Address books are just ordinary
documents that happen to contain rows with `userPublicKey`.

Projection rule:
- suggestion/version/incoming/occurrence overlays must respect the current visible-author set
- cached events from previously followed authors may remain on disk, but they should not surface once the author is no longer visible through `contacts`, project members, or an explicitly opened author view

Logout/cache rule:
- logout should clear the IndexedDB-backed cache as well as auth state
- clearing the DB must close active IndexedDB handles first, otherwise `deleteDatabase` can be blocked by the current tab and stale cache survives logout

Helpers live in:
- [systemRoots.ts](/Users/f/sandbox/stashmap-2/src/systemRoots.ts)

## Tree, Views, And Panes

### Pane State

A pane stores one navigation target:

```ts
type Pane = {
  id: string;
  stack: ID[];
  author: PublicKey;
  rootRelation?: LongID;
  searchQuery?: string;
  typeFilters?: ...;
  scrollToId?: string;
}
```

Meaning:
- `stack` is the semantic breadcrumb path
- `rootRelation` optionally pins the pane to a concrete standalone root
- `author` is the perspective used for semantic navigation and queries

Routes:
- `/n/...` -> semantic path navigation
- `/r/:relationID` -> concrete root relation view
- `?author=...` -> foreign author perspective
- `#rowID` -> scroll target

### View Paths

View state is relation-path based, not node-hash based.

`ViewContext.tsx` owns:
- expansion state
- row path serialization
- current relation/edge lookup
- pane-target building for fullscreen/split-pane/open-source actions

Important split:
- `useCurrentRelation()` -> current row's backing `Relations`
- `useCurrentEdge()` -> parent edge pointing to the row

The app no longer uses a fake `KnowNode` / `DisplayNode` layer for normal rows.

## Semantic Layer

Semantic matching still exists, but it is explicitly isolated.

### What semantic IDs are for

Semantic IDs exist only to:
- match semantically equivalent relations across authors/documents
- drive `/n/...` navigation
- build footer/list alternatives, suggestions, occurrences, and incoming refs
- query candidate documents by semantic tags

Semantic IDs are not used to define tree structure.
Semantic IDs should not be used to invent concrete rows when a relation ID is available.

### Semantic modules

- [semanticProjection.ts](/Users/f/sandbox/stashmap-3/src/semanticProjection.ts)
  - semantic lookup
  - context-aware matching
  - footer/list projection
  - ref/occurrence/incoming-ref grouping

- [semanticNavigation.ts](/Users/f/sandbox/stashmap-3/src/semanticNavigation.ts)
  - `/n/...` resolution
  - semantic stack -> actual relation resolution

A lint rule prevents these modules from being imported broadly across the app. Only the explicit boundary files are allowlisted.

### Direct vs semantic logic

Direct relation logic lives in:
- [connections.tsx](/Users/f/sandbox/stashmap-3/src/connections.tsx)

That file should stay relation/item-focused:
- parsing IDs
- direct relation lookup
- relation text/context derivation
- cref target resolution

It should not grow general semantic fallback logic again.

## References, Alternatives, And Footer Rows

The tree can render projected rows that are not ordinary structural child relations:
- suggestions
- incoming refs
- occurrences
- alternative lists (`[V]`, `[VO]`)

These are view projections, not core persisted tree objects.

Concrete refs:
- stored as `cref:relationID`
- navigation semantics depend on the UI action
  - generic fullscreen/open actions are structural
  - footer/list projections may intentionally open alternative roots
  - context-opening behaviors are handled in the view layer, not encoded in the cref string

Important UX rule:
- generic actions on a visible row should open that concrete row
- semantic alternative selection belongs in footer/list UI, not in generic structural buttons

Reference row building lives in:
- [buildReferenceRow.ts](/Users/f/sandbox/stashmap-3/src/buildReferenceRow.ts)

## Documents And Persistence

Runtime persistence is document-only.

### Nostr kinds

- `KIND_KNOWLEDGE_DOCUMENT = 34770`
- `KIND_DELETE = 5`

Legacy knowledge node/list kinds are gone from runtime code.

### Document structure

Each standalone root publishes one markdown document containing the whole tree under that root.

Root headings and list items carry structured attributes such as:
- `uuid`
- `semantic`
- `anchorContext`
- `anchorLabels`
- `systemRole`

Documents also emit:
- `#d` -> root relation UUID key
- `#n` -> semantic IDs contained in the document
- `#s` -> system roles such as `"log"`

`#c` and `#r` tags are gone.

Markdown read/write lives in:
- [markdownDocument.tsx](/Users/f/sandbox/stashmap-3/src/markdownDocument.tsx)

### Write path

All mutations go through the planner:

1. `createPlan()`
2. accumulate relation changes in the plan
3. `executePlan(plan)`
4. `buildDocumentEvents(plan)` reserializes affected standalone roots
5. sign and publish document events

Delete behavior is also document-root based now. There is no runtime knowledge-list delete path anymore.

### Read/query path

Queries are built in:
- [dataQuery.tsx](/Users/f/sandbox/stashmap-3/src/dataQuery.tsx)

Current query model:
- `#n` for semantic IDs
- `#s` for system roots like `log`
- delete filters for document cleanup

The app loads candidate documents broadly, then does semantic discrimination locally.

Important status note:
- the current UI query model is transitional
- it still contains overlapping pane/root/tree subscriptions
- the intended next architecture is a permanent local document replica in IndexedDB
- one broad live document sync plus paged historical backfill should replace most pane/tree document subscriptions
- normal browsing should become local-first rather than query-driven

## `~Log`

`~Log` is now a normal standalone root with:
- `systemRole: "log"`
- visible text from `getSystemRoleText("log")`

Current behavior:
- the app explicitly queries for log roots via `#s=["log"]`
- creating a new standalone root adds a cref to it in the user's log root
- home navigation uses the explicit loaded log root, not semantic lookup

Relevant files:
- [systemRoots.ts](/Users/f/sandbox/stashmap-3/src/systemRoots.ts)
- [dataQuery.tsx](/Users/f/sandbox/stashmap-3/src/dataQuery.tsx)
- [components/SplitPaneLayout.tsx](/Users/f/sandbox/stashmap-3/src/components/SplitPaneLayout.tsx)
- [components/Workspace.tsx](/Users/f/sandbox/stashmap-3/src/components/Workspace.tsx)
- [planner.tsx](/Users/f/sandbox/stashmap-3/src/planner.tsx)

## Anchored Standalone Subtrees

Forked/copied standalone subtrees are modeled as standalone roots with optional anchors, not as inline context-dependent overlays.

Current behavior:
- branch/subtree roots are structurally standalone
- semantic origin is preserved through `anchor`
- breadcrumbs can show source lineage
- a pane can jump to the live source subtree via the header "source" action

What this does not yet implement:
- merge/rebase
- inline overlay rendering of branch content into the source tree

Those would require an explicit patch/overlay model, not just anchors.

## Query And Navigation Boundaries

There are two important boundaries in the current architecture:

### Structural boundary

Structural UI and planner code should operate on:
- relation IDs
- parent/root links
- concrete ref IDs

Structural actions should not silently jump through semantic alternatives.

### Semantic boundary

Semantic code is allowed only where the product actually needs semantic behavior:
- `/n/...` navigation
- footer/list alternatives
- suggestions
- occurrences
- incoming refs
- broad document queries by semantic ID

If a file can work with a concrete relation ID, it should not import semantic helpers.

## Key Files

| File | Purpose |
|------|---------|
| [src/types.ts](/Users/f/sandbox/stashmap-3/src/types.ts) | Core runtime types |
| [src/connections.tsx](/Users/f/sandbox/stashmap-3/src/connections.tsx) | Direct relation/item utilities |
| [src/rootAnchor.ts](/Users/f/sandbox/stashmap-3/src/rootAnchor.ts) | Root-anchor creation and equality |
| [src/systemRoots.ts](/Users/f/sandbox/stashmap-3/src/systemRoots.ts) | Explicit system-root helpers (`log`) |
| [src/ViewContext.tsx](/Users/f/sandbox/stashmap-3/src/ViewContext.tsx) | View paths, current relation/edge, pane targets |
| [src/semanticProjection.ts](/Users/f/sandbox/stashmap-3/src/semanticProjection.ts) | Semantic matching and footer/list projection |
| [src/semanticNavigation.ts](/Users/f/sandbox/stashmap-3/src/semanticNavigation.ts) | `/n/...` semantic navigation |
| [src/treeTraversal.ts](/Users/f/sandbox/stashmap-3/src/treeTraversal.ts) | Child row derivation, virtual rows |
| [src/buildReferenceRow.ts](/Users/f/sandbox/stashmap-3/src/buildReferenceRow.ts) | Reference/occurrence/incoming row projection |
| [src/planner.tsx](/Users/f/sandbox/stashmap-3/src/planner.tsx) | Plan/execute, all mutations |
| [src/markdownDocument.tsx](/Users/f/sandbox/stashmap-3/src/markdownDocument.tsx) | Document parse/serialize |
| [src/dataQuery.tsx](/Users/f/sandbox/stashmap-3/src/dataQuery.tsx) | Relay query construction |
| [src/components/Workspace.tsx](/Users/f/sandbox/stashmap-3/src/components/Workspace.tsx) | Header, breadcrumbs, pane-level actions |
| [src/components/TreeView.tsx](/Users/f/sandbox/stashmap-3/src/components/TreeView.tsx) | Virtualized tree rendering |

## CLI Workspace Sync

The CLI (`src/cli/`) provides `pull` and `push` commands for offline workspace editing.

### Filesystem layout

```
DOCUMENTS/{author}/{title}.md     ← human-readable name, editable
.knowstr/base/{author}/{dTag}.md  ← stable name keyed by dTag, system-managed
.knowstr/profile.json             ← pubkey, relays, nsec_file
```

### Design principles

- **No manifest.** Filesystem is the source of truth. No `manifest.json`, no sync-state file.
- **Three-way comparison**: relay state vs baseline vs workspace.
- **Baselines keyed by dTag** (stable identity). Workspace files named by title (human-friendly).
- **Change detection = content comparison.** File differs from baseline → changed.
- **Full pull every time.** No `since` filter, no incremental state. Relay returns latest replaceable events; compare against baselines to skip unchanged.
- **Local file deletion is a no-op.** File reappears on next pull.

### Pull (`src/core/syncPull.ts`)

1. Query relays for contacts (kind 3), derive author list
2. Query relays for ALL documents + deletes per author (no `since`)
3. For each relay event: compare against baseline at `.knowstr/base/{author}/{dTag}.md`
   - No baseline → new → write workspace + baseline
   - Baseline matches → skip
   - Baseline differs, workspace not locally edited → update both
   - Baseline differs, workspace locally edited → skip (preserve local edits)
4. Delete events: remove baseline + workspace (unless locally edited)
5. Remove author directories not in contact list

### Push (`src/core/workspacePush.ts`)

1. Scan `DOCUMENTS/**/*.md`
2. Extract dTag from editing header (`<!-- ks:root=... -->`)
3. Compare against baseline at `.knowstr/base/{author}/{dTag}.md`
4. If different → validate integrity, build event, publish, update baseline

### Key CLI files

| File | Purpose |
|------|---------|
| `src/core/workspaceState.ts` | File path helpers, document writing, baseline management |
| `src/core/syncPull.ts` | Full pull from relays, content comparison |
| `src/core/workspacePush.ts` | Scan filesystem, diff vs baseline, publish |
| `src/core/workspaceIntegrity.ts` | Validate edited documents (marker integrity) |
| `src/core/writeSupport.ts` | Relay publishing, secret key loading |
| `src/cli/syncPull.ts` | CLI pull command wiring |
| `src/cli/push.ts` | CLI push command wiring |

## Remaining Cleanup Direction

The major refactor is done. Remaining work is cleanup and stricter boundary enforcement:
- shrink semantic-module allowlists further where possible
- remove remaining semantic text lookup where explicit labels can be carried instead
- reduce React `act(...)` warnings in tests
- continue pruning stale naming/comments that still imply the old node model
