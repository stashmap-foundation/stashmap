# Relation-First Refactor Status

## Goal

The tree is relation-native:

- `Relations` owns `text`, `textHash`, `parent`, `root`
- `RelationItem.id` points to a child relation UUID or `cref:relationID`
- `ViewPath` is relation-ID based
- standalone fork roots carry explicit `anchor` metadata instead of stored per-relation `context`

The remaining work is to remove the last semantic-lookup leakage from general read paths and finish the naming/schema cleanup around that model.

## Completed

### Core model

- `KnowledgeData.nodes` is gone
- legacy knowledge node/list event runtime is gone
- `Relations.head` is gone
- `Relations.context` is gone
- root-only `anchor` metadata replaced stored root context
- `RelationItem.nodeID` was replaced with `RelationItem.id`
- normal tree identity is relation UUID + `parent`, not hash + context

### Navigation and view state

- `ViewPath` is relation-ID based
- empty editor rows use a synthetic parent-scoped placeholder path segment
- `cref` was simplified to `cref:relationID`
- cref navigation is split by UI intent instead of cref shape

### Document model

- markdown import/export is relation-first
- hidden local `~versions` / rename-history subtree was removed
- document publishing is the only active write model

### Identity and matching

- content hashes are now semantic IDs / indexes, not structural identity
- normal nodes use unique IDs; collision-renaming/dedup behavior was removed
- footer/list semantics that still need semantic matching were moved into `footerSemantics.ts`

### UI cleanup

- regular tree rows are relation-backed
- fake runtime node types (`KnowNode`, `DisplayNode`, `TextNode`) are gone
- ref UI types were renamed to `ReferenceRow`
- hook naming now reflects the model:
  - `useCurrentRelation()`
  - `useCurrentEdge()`
  - `useCurrentItemID()`

### Tests

- direct app-code `newNode()` / `createTextSeed()` helpers are gone
- `setupTestDB()` is gone
- several raw structure unit suites were deleted instead of preserved

## Remaining Work

### 1. Isolate semantic matching from general read paths

This is the main remaining architectural cut.

Desired end state:

- direct tree/view resolution uses relation ID, `parent`, and `root` only
- semantic lookup is only used where the product actually needs it:
  - alternatives `[V]` / `[VO]`
  - footer/list semantics
  - suggestions / occurrences / incoming refs
  - explicit semantic navigation such as `/n/...`

Concrete targets:

- `src/ViewContext.tsx`
  - split semantic root-route resolution from ordinary in-tree relation lookup
- `src/connections.tsx`
  - keep direct helpers direct
  - keep semantic helpers explicit
- remaining callers that still use generic `getText*ForMatching(...)` when they actually mean semantic text/hash

### 2. Clean the markdown/document schema language

The runtime model is relation-first, but the document schema still uses old names like:

- `node="..."`
- `MarkdownTreeNode.nodeID`
- `context="..."`

If we are willing to break format, rename these to reflect the real model:

- `node` -> `semantic`
- `nodeID` -> `semanticID`
- `context` -> `anchorContext`

The runtime shape is already there; this is mostly schema/name cleanup.

### 3. Finish the terminology sweep

The public helper layer is much cleaner now, but locals/comments still mix:

- `relationID`
- semantic ID / text hash
- view item ID
- `nodeID`

We should finish the cleanup so each name matches one concept:

- `relationID` = relation UUID
- `semanticID` = relation text hash / semantic key
- `itemID` = current row/view item ID

### 4. Optional follow-up after the refactor

Anchored standalone subtree branches now have:

- root-only `anchor` metadata
- source-aware breadcrumbs
- a header action that opens the source subtree

Future product work, not required to finish this refactor:

- richer branch/source status in the header
- source-missing UI states
- compare / merge workflows

## Order

1. Finish semantic read-path isolation
2. Rename markdown/document schema fields
3. Finish terminology cleanup

## Gate

After each cut:

1. `npm run typescript -- --noEmit`
2. `npm test -- --bail`
