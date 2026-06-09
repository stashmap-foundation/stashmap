# Delete view lookup helpers and DnD root-path migration prompt

We are continuing the row-model migration after `delete-viewpath.md`. Read `AGENTS.md`, `row-model-plan.md`, and `delete-viewpath.md` first. Treat the row-model acceptance criteria as mandatory.

## Core correction

The previous ViewContext deletion exposed a real design problem: pane and DnD code still wants a root `ViewPath`, so a helper such as `getPaneRootViewPath` is only a compatibility bridge.

Do **not** keep or reintroduce `getPaneRootViewPath` or an equivalent exported root-path helper. It preserves the old model where pane/drop/action code can recover graph identity from `ViewPath`.

A pane root path may exist only as a narrow traversal seed before rows exist. After `treeTraversal`, editor rendering, DnD, actions, and planner calls must work from `Row` values or explicit pane state.

## Core intent

Delete the old view lookup helpers from action/mutation flow:

- `getNodeForView`
- `getRowIDFromView`

Do not replace them with equivalent path parsing or `getLast(viewPath)` lookup logic. If code needs graph identity after traversal, it must come from `Row` in the editor layer and then be passed to planner/core as explicit graph/edit inputs.

## Target flow

```text
pane state -> traversal seed -> treeTraversal -> rows
rows -> render
rows -> DnD/action extraction
explicit graph inputs -> planner/core mutation
```

Not:

```text
pane state -> root ViewPath -> droppable/action -> getNodeForView/getRowIDFromView -> planner/core mutation
```

## Non-negotiable rules

- Planner/core mutation functions must not accept `Row`.
- Editor-layer components/helpers may consume `Row`, then pass explicit values to planner/core.
- `ViewPath` may be passed only for view-state persistence/focus/expansion while this migration is in progress, never to choose the graph node/source being mutated.
- Do not add `getPaneRootViewPath`, `rowByViewKey`, `nodeByViewKey`, `NodeRef` maps keyed by view key, projection types, or all-DB fallback scans.
- Do not parse `viewKey` to recover graph identity.
- Do not use `lookupViewNode`, `getLast(viewPath)`, or `lookupPlanNode(...getLast(viewPath)...)` as a replacement for deleted helpers.
- Avoid new named types/projections. Reuse `Row`, `NodeRef`, existing domain types, or direct inline parameters only when unavoidable.

Allowed planner/core inputs:

- `NodeRef`
- parent `NodeRef`
- child index / insert index
- concrete node id only when source is already explicit
- node text / metadata
- explicit pane/document target data
- `ViewPath` only for view-state updates, not graph mutation identity

Forbidden planner/core inputs:

- `Row`
- `ViewPath` as graph identity
- `viewKey` as graph identity
- parsed `viewKey`
- optional row fallback
- all-DB lookup fallback

## Why this is needed

Current remaining code still has old identity recovery paths, mainly in:

- `src/dnd.tsx`
- `src/editor/DroppableContainer.tsx`
- `src/editor/batchOperations.ts`
- `src/planner.tsx`
- `src/treeMutations.ts`
- `src/nodeItemMutations.ts`
- `src/ViewContext.tsx`

The important first cut is DnD/drop handling: `DroppableContainer` still models pane drops as a root `ViewPath`, and row drops still route through `destination`/`target` paths. That forces `dnd.tsx` and planner helpers to call `getNodeForView` / `getRowIDFromView`.

## Checkpoint 1 — Split pane drop from row drop

Goal: remove root `ViewPath` from empty-pane dropping. Empty panes have pane state, not rows.

Implementation direction:

1. Split the current droppable hook into two direct paths:
   - empty-pane drop target, used by `DroppableContainer`;
   - row drop target, used by `ListItem` / row rendering.
2. Empty-pane drop target receives explicit pane data such as pane index/current pane/ref, not a root `ViewPath`.
3. Dropping a dragged row into an empty pane updates the pane from `buildPaneTarget(plan, draggedRow)`.
4. Dropping markdown files into an empty pane imports at `paneIndex` directly.
5. Empty-pane drop must not call `getPaneRootViewPath`, `getNodeForView`, `getRowIDFromView`, or `getLast(path)` to decide graph identity.

Acceptance criteria:

- No `getPaneRootViewPath` helper exists.
- `DroppableContainer` does not construct a root `ViewPath`.
- Empty-pane row drop uses explicit pane update data.
- Empty-pane file drop uses explicit pane index.
- Full gate passes.

Verification:

```sh
npm run typescript && npm run lint && npm test
```

Focused tests while debugging:

```sh
npm test -- src/dnd.test.tsx src/editor/MultiTopNodeDocuments.test.tsx src/editor/MarkdownImportPlan.test.tsx
```

## Checkpoint 2 — Row drop target computes from rows, not paths

Goal: row DnD geometry and target calculation use current ordered rows.

Implementation direction:

1. Row drop target receives:
   - current `row`;
   - current ordered `rows`;
   - next row/depth/view key only as UI geometry if still needed;
   - pane/document state needed for constraints.
2. Drag payload carries `row` and `draggedRows` only.
3. Drop target uses row fields for visual/ordering logic:
   - `row.index`;
   - `row.depth`;
   - `row.viewKey` for occurrence prefix checks only;
   - `row.parentRef`;
   - `row.childIndex`;
   - `row.ref`;
   - `row.node.children.size`.
4. Replace path-driven drop destination helpers with row-driven calculations over `rows`.
5. Do not create a row map keyed by `viewKey`.

Acceptance criteria:

- `dnd.tsx` no longer computes drop targets by walking `ViewPath` parents.
- Drop target graph identity comes from target row / neighboring rows / pane state.
- Drag source graph identity comes from dragged rows.
- `viewKey` is used only for UI occurrence checks such as descendant/selection prefix checks.
- Must not resolve rows by `ViewPath` or `viewKey`; no `getRowForViewPath`, `viewPathToString(path) -> rows.find(...)`, `rowByViewKey`, or equivalent side channel is allowed.
- Row drop target APIs must not accept pane/root `ViewPath` values; they receive the target `Row`, ordered `rows`, neighboring rows for geometry, and explicit pane index.
- DnD destination values must carry a concrete `parentRow` and insert index only; they must not carry `parentViewPath` as identity.
- DnD pane comparisons must use explicit pane indexes from drag source/drop target, not `getPane(plan, viewPath)`.
- Same-parent/reorder decisions must compare row-derived parent refs/nodes, not parsed view-key parents.
- Remaining `row.viewPath` usage in DnD is allowed only when passed to view-state helpers such as expansion/focus/view preservation after graph identity has already come from rows.
- Focused DnD tests pass, then full gate passes.

## Checkpoint 3 — Remove editor-layer calls to `getNodeForView` / `getRowIDFromView`

Goal: row-rendered editor code no longer calls view lookup helpers.

Target files:

- `src/editor/batchOperations.ts`
- `src/editor/Node.tsx`
- `src/editor/DroppableContainer.tsx`
- `src/dnd.tsx`

Implementation direction:

1. Batch indent/outdent should receive the current ordered rows when it needs sibling/ancestor context.
2. Previous sibling and ancestor decisions come from ordered rows, not `getPreviousSibling(plan, viewPath)` or parent path lookup.
3. Node editing should use `row.parentNode`, `row.parentRef`, `row.parentChildIndex`, `row.childIndex`, `row.view`, and `row.node` for graph/edit decisions.
4. Any remaining `ViewPath` in editor code must be only for focus restoration, view-state preservation, or expansion-state updates.

Acceptance criteria:

```sh
rg "getNodeForView|getRowIDFromView" src/editor src/dnd.tsx
```

has no hits.

## Checkpoint 4 — Replace planner/tree mutation view lookup APIs with explicit graph inputs

Goal: planner/core mutation functions no longer choose mutation targets from `ViewPath`.

Current APIs to remove or rewrite:

- `planUpdateNodeText(plan, viewPath, text)`
- `planDisconnectFromParent(plan, viewPath, ...)`
- `planDeleteNodeFromView(plan, viewPath)`
- `planMoveNodeWithView(plan, sourceViewPath, targetParentViewPath, ...)`
- `planDeepCopyNode(plan, sourceViewPath, targetParentViewPath, ...)`
- `planDeepCopyNodeWithView(...)`
- `planSaveNodeAndEnsureNodes(plan, text, viewPath, ...)`
- `planAddToParent(plan, ..., parentViewPath, ...)` if it uses view lookup for parent identity
- `planUpdateViewItemMetadata(...)` if it uses view lookup for graph identity

Implementation direction:

1. Editor layer extracts explicit values from `Row`:
   - source node ref;
   - parent ref;
   - child index;
   - row id;
   - current node;
   - parent node;
   - insert index;
   - pane index / document id when operating on pane or document state.
2. Planner/core receives those explicit values, not `Row` and not graph-identity `ViewPath`.
3. Keep separate tiny view-state helpers for expansion/focus/view copying while needed. Their names must make it clear they mutate view state, not graph identity.
4. Remove old `WithView` names instead of preserving compatibility wrappers.

Acceptance criteria:

```sh
rg "getNodeForView|getRowIDFromView" src/planner.tsx src/treeMutations.ts src/nodeItemMutations.ts src/dnd.tsx src/editor
```

has no hits.

Planner/core files do not accept `Row` as function input.

## Checkpoint 5 — Delete helper exports from `ViewContext.tsx`

Goal: make old lookup recovery impossible.

Implementation direction:

1. Delete `getNodeForView` and `getRowIDFromView` from `ViewContext.tsx`.
2. Delete private helpers that existed only to support them, if unused:
   - path node lookup helpers;
   - row-id-from-path helpers;
   - any `lookupViewNode` usage that recovers graph identity from a path.
3. Keep pure `ViewPath` utility functions only if they are strictly for view settings/UI occurrence state.

Acceptance criteria:

```sh
rg "getNodeForView|getRowIDFromView" src
```

has no hits.

## Hard grep acceptance gates

Run all row-model hard greps from `row-model-plan.md` plus these:

```sh
rg "getPaneRootViewPath" src
rg "getNodeForView|getRowIDFromView" src
rg "lookupViewNode\(|getLast\(.*viewPath|lookupPlanNode\(.*getLast" src
rg "parseViewPath" src/editor src/dnd.tsx src/planner.tsx src/treeMutations.ts src/nodeItemMutations.ts
rg "plan[A-Za-z0-9]+\([^\n]*Row|row: Row" src/planner.tsx src/core src/treeMutations.ts src/nodeItemMutations.ts
```

Remaining `ViewPath` / `viewKey` hits must be strictly UI occurrence/view-state concerns: focus, expansion, DOM targeting, visible ordering, depth, or view-state preservation.

## Verification after each checkpoint

Run the full gate after every narrow checkpoint:

```sh
npm run typescript && npm run lint && npm test
```

Focused suites while debugging:

```sh
npm test -- src/dnd.test.tsx
npm test -- src/editor/MultiTopNodeDocuments.test.tsx
npm test -- src/editor/MultiselectMovement.test.tsx
npm test -- src/editor/DeleteKey.test.tsx
npm test -- src/editor/SuggestionDisplay.test.tsx
npm test -- src/editor/IncomingRefInteraction.test.tsx
npm test -- src/editor/MarkdownImportPlan.test.tsx
```

Focused tests do not replace the full gate.
