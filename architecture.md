# Architecture

Stashmap is a decentralized knowledge management tool built on Nostr. Users create hierarchical trees of notes, link them with semantic relations, and collaborate via relay-based sync.

## Data Model

**Content-addressed nodes**: `hashText(text).slice(0,32)` — same text always produces the same ID. Special IDs: `EMPTY_NODE_ID`, `VERSIONS_NODE_ID` (`~Versions`), `LOG_NODE_ID` (`~Log`).

**ID types**:
- `ID` — 32-char hex hash of node text. Nodes are always identified by short ID.
- `LongID` — `publicKey_shortID`. Only relations have LongIDs (per-author).
- `PublicKey` — Nostr pubkey
- Concrete ref IDs: `cref:relationID` or `cref:relationID:targetNode`
- Search IDs: `search:query`

**KnowledgeData** (`Map<PublicKey, { nodes, relations, tombstones }>`): Each user has their own set of nodes, relations, and tombstones. Multiple users' data is merged for display.

**Relations** represent parent→children links with context:
- `head`: parent node ID
- `items`: `List<RelationItem>` — children with optional relevance/argument/virtualType
- `context`: `List<ID>` — ancestor path to the head node
- Same node can have different children in different contexts

**RelationItem properties**:
- `relevance`: "relevant" | "maybe_relevant" | "little_relevant" | "not_relevant" | undefined (=contains)
- `argument`: "confirms" | "contra" | undefined
- `virtualType`: "suggestion" | "incoming" | "version" | "occurrence" | "search"

## Component Hierarchy

```
App (Routes: /n/*, /r/:id, /, profile, follow, relays)
└── Dashboard → AppLayout
    ├── NavbarControls (home, search, user menu)
    └── DND (drag-drop context)
        └── SplitPaneLayout
            └── Pane[0..N] → TreeView (virtualized via react-virtuoso)
                └── Node (recursive tree items)
```

## Pane System (`SplitPanesContext.tsx`)

A `Pane` holds navigation state for one column:
- `stack: ID[]` — node path (navigation history)
- `author: PublicKey` — whose perspective to view
- `rootRelation?: LongID` — show a specific relation as root (when navigating via cref)
- `searchQuery?`, `scrollToNodeId?`

Operations: `addPaneAt`, `removePane`, `setPane`. Panes persisted to localStorage.

Root node for a pane: `stack[stack.length - 1]` or `EMPTY_NODE_ID` if stack is empty.

**Per-pane navigation history** (`PaneHistoryContext.tsx`): Stores previous `Pane` states per pane ID (max 50). `useNavigatePane()` pushes current pane state to history before navigating. The back button pops from this history and uses `replaceNextNavigation()` from `NavigationStateContext` to avoid polluting browser history. History is cleaned up when a pane is removed.

## View System (`ViewContext.tsx`)

Views track UI state (expansion) per node per position in the tree.

**ViewPath**: `[paneIndex, ...SubPathWithRelations[], SubPath]` — uniquely identifies a node's position. Serialized as `p0:nodeA:0:rel1:nodeB:0`.

**View**: `{ expanded?: boolean, typeFilters?: [...] }`. Stored in `Views: Map<string, View>`.

**Defaults**: Root/search nodes default to `expanded: true`; non-root nodes default to `expanded: false`. `updateView` deletes keys that match defaults (storage optimization).

Views persist across pane navigation — expansion state is NOT cleared when pane content changes.

## Navigation (`navigationUrl.ts`)

URL patterns:
- `/n/Parent/Child/Grandchild` → `pathToStack()` → array of hashed IDs
- `/r/relationID` → direct relation view
- `?author=publicKey` → view another user's perspective
- `#nodeID` → scroll target

`useNavigatePane()` updates the current pane's stack/rootRelation based on a URL.

## Plan/Execute Pattern (`planner.tsx`)

Changes are never applied directly. They're accumulated in a `Plan` (extends `Data` with pending events), then executed:

1. `createPlan()` — snapshot current Data
2. `planUpsertNode(plan, node)`, `planUpsertRelations(plan, rels)`, etc.
3. `executePlan(plan)` — sign events and publish

## Publishing & Sync

**Deletion & Tombstones**: When a relation is deleted, a `KIND_DELETE` event is published with `["head", headNodeID]` and `["c", contextNodeID]` tags preserving the relation's context path. `findTombstones()` parses these into `Tombstone = { head: ID, context: List<ID> }`, keyed by short relation ID. This allows deleted crefs in `~Log` to render their full context path (e.g. `(deleted) Investment / Alternative >>> Bitcoin`) instead of just the head label. `TreeViewNodeLoader` queries tombstone node IDs so labels resolve correctly.

**Nostr events**: Documents are `KIND_KNOWLEDGE_DOCUMENT` (34770) — a single markdown event containing an entire subtree. Legacy: nodes were `KIND_KNOWLEDGE_NODE` (34751), relations were `KIND_KNOWLEDGE_LIST` (34760). All events are replaceable (d-tag keyed).

**Document format**: Each document is a markdown list with `{uuid .relevance .argument}` extensions per item. Root is an H1. `#n` tags contain `hashText(nodeText)` for each node; `#c` tags contain context hashes; `#d` tag = root UUID.

**Relations.root**: Every relation has a `root: ID` field pointing to the short ID of its document's root relation UUID. Root relations self-reference. This groups relations into documents for serialization.

**Write path**: `executePlan` → `buildDocumentEvents(plan)` groups changed relations by `root` field, re-serializes each affected root's full tree as a `KIND_KNOWLEDGE_DOCUMENT` event.

**Read path**: `findDocumentNodesAndRelations` deduplicates document events by replaceable key (keeping newest), parses markdown → nodes + relations. Nodes are collected from ALL document versions (content-addressed, immutable); relations only from latest version.

**Query filters** (`dataQuery.tsx`): `documentByID` (`#d`), `documentByNode` (`#n`), `documentByContext` (`#c`) — all using `KIND_KNOWLEDGE_DOCUMENT`.

**PublishQueue**: Debounces (5s prod, 100ms test), batches by kind, retries with backoff, persists to IndexedDB outbox.

**Data flow**: User input → Plan → executePlan → buildDocumentEvents → sign → PublishQueue → Nostr relays → remote users receive via subscription → EventCache → KnowledgeDBs → re-render.

## References, Occurrences & Suggestions

- **Suggestions**: Items other users added to the same node (virtualType: "suggestion")
- **Versions**: Alternative relations for the same head node with diffs (virtualType: "version")
- **Occurrences**: This node appears in another relation — same node, different context (virtualType: "occurrence"). Display: `Context / Target` with `[C]` tree prefix. Includes both item-level (node is a child in another tree) and head-level (node is head of a root-level relation) appearances.
- **Outgoing references**: Stored cref items linking to another relation (display: `Context >>> Target`)
- **Incoming references**: Another relation has a cref item pointing TO our relation (virtualType: "incoming"). Display: `Target <<< Context` with `[I]` tree prefix. Found via `getIncomingCrefsForNode` reverse lookup.

Built via `getSuggestionsForNode`, `getVersionsForRelation`, `getOccurrencesForNode`, `getIncomingCrefsForNode`, `buildReferenceNode`.

### Link Direction & Relevance Model

A **concrete ref** (cref) stored in a relation creates an outgoing link (`>>>`). When the target relation also has a cref pointing back to our relation, the link is **bidirectional** (`<<< >>>`). The `<<<` arrow means "they have a cref to us" (incoming direction).

**displayAs discriminant on ReferenceNode**: For stored cref items, `buildReferenceItem` sets `displayAs` to classify how the ref should be rendered:
- `"bidirectional"`: target has a cref back to our relation, and our cref is not `not_relevant`
- `"incoming"`: target has a cref back to us, but our stored cref IS `not_relevant`
- `"occurrence"`: no cref back, but this is an occurrence origin (`targetNode` + `sourceItem` exist)
- `undefined`: plain outgoing reference

**Display matrix:**

| displayAs | Display | Meaning |
|---|---|---|
| undefined | `Context >>> Target` | Plain outgoing reference |
| "bidirectional" | `Context <<< >>> Target` | Mutual crefs between relations |
| "incoming" | `Target <<< Context` | Stored cref is not_relevant, but they link to us |
| "occurrence" | `Context / Target` (not_relevant) or `Context >>> Target` (relevant) | Node appears in target via sourceItem |

**Occurrence suppression**: Occurrences are suppressed when a stored outgoing cref OR an incoming cref already covers that context. Uses `coveredContextKeys` with merged outgoing + incoming cref IDs.

**Implementation**: `buildReferenceItem` in `buildReferenceNode.ts` checks for a reverse cref in the target relation's items (`incomingCref`). The `resolveDisplayAs` function determines the display mode based on whether the reverse cref exists, its relevance, and whether this is an occurrence origin.

## Key Patterns

- **Immutable.js** everywhere (Map, List, Set, OrderedSet)
- **Purely functional**: only `const`, no let/var
- **Keyboard-first**: full vim-style navigation with focus restoration
- **Multi-author merge**: all followed users' KnowledgeDBs displayed together
- **Virtualization**: react-virtuoso for large trees
- **Temporary UI state**: focus intents, multiselect, draft texts — not persisted to Nostr

## Key Files

| File | Purpose |
|------|---------|
| `types.ts` | All type definitions |
| `DataContext.tsx` | Provides Data to app |
| `ViewContext.tsx` | View expansion state, view path logic |
| `SplitPanesContext.tsx` | Pane management |
| `planner.tsx` | Plan/execute, all plan operations |
| `connections.tsx` | Node/relation utilities, hashText, ID parsing, occurrence/incoming ref lookup |
| `treeTraversal.ts` | Computes children for tree nodes, wires virtual items |
| `buildReferenceNode.ts` | Builds ReferenceNode display data from crefs |
| `navigationUrl.ts` | URL ↔ navigation state |
| `markdownDocument.tsx` | Markdown document serializer + parser |
| `knowledgeEvents.tsx` | Nostr event parsing |
| `dataQuery.tsx` | Relay query filter construction |
| `executor.tsx` | Event signing and relay publishing |
| `PublishQueue.ts` | Debounced publish queue |
| `SplitPaneLayout.tsx` | Multi-pane layout component |
| `TreeView.tsx` | Virtualized tree renderer |
