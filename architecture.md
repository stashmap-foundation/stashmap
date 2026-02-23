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

**KnowledgeData** (`Map<PublicKey, { nodes, relations }>`): Each user has their own set of nodes and relations. Multiple users' data is merged for display.

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

**Nostr events**: Nodes are `KIND_KNOWLEDGE_NODE` (34751), relations are `KIND_KNOWLEDGE_LIST` (34760). Events are replaceable (d-tag keyed).

**PublishQueue**: Debounces (5s prod, 100ms test), batches by kind, retries with backoff, persists to IndexedDB outbox.

**Data flow**: User input → Plan → executePlan → sign → PublishQueue → Nostr relays → remote users receive via subscription → EventCache → KnowledgeDBs → re-render.

## References & Suggestions

- **Suggestions**: Items other users added to the same node (virtualType: "suggestion")
- **Versions**: Alternative relations for the same head node with diffs (virtualType: "version")
- **Incoming references**: This node referenced from another relation (virtualType: "incoming")
- **Occurrences**: This node appears in another of your own relations (virtualType: "occurrence")

Built via `getSuggestionsForNode`, `getVersionsForRelation`, `buildReferenceNode`.

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
| `connections.tsx` | Node/relation utilities, hashText, ID parsing |
| `navigationUrl.ts` | URL ↔ navigation state |
| `knowledgeEvents.tsx` | Nostr event parsing |
| `executor.tsx` | Event signing and relay publishing |
| `PublishQueue.ts` | Debounced publish queue |
| `SplitPaneLayout.tsx` | Multi-pane layout component |
| `TreeView.tsx` | Virtualized tree renderer |
