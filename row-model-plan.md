# Row model plan

Status: **Done** (2026-06-10). All checkpoints and final acceptance criteria are met: `treeTraversal` returns rows, rendering/DnD/multiselect/planner boundaries work from `Row` values, `ViewContext` and all view-key identity side channels are deleted, and every hard grep acceptance gate below is clean with `npm run typescript`, `npm run lint`, and `npm test` green. Remaining follow-up is performance closeout only — see `performance-regression.md` and Phase 1A.5b in `implementation.md`.

## Goal

After `treeTraversal`, the editor works with rows, not with bare `ViewPath` / `viewKey` values.

```text
graph data + view state
  -> treeTraversal
  -> rows
  -> render rows
  -> actions receive rows
  -> planner receives row-derived graph identity
```

`viewKey` remains only a UI occurrence field on a row. It is not a graph identity lookup key.

## Core model

A row is the editor-visible item:

```text
Row = GraphNode + source + occurrence + parent edge
```

A row carries enough data for rendering and actions:

- `viewPath`
- `viewKey`
- visible index / depth
- the displayed `GraphNode`
- the row source id
- the concrete node ref: `{ sourceId, id }`
- parent row/source/id when there is a parent
- child index / insertion context for editing
- virtual-row display state when the row is a suggestion, incoming ref, version, or search row
- resolved target/source data for reference-like rows when an action needs it

The only new editor model should be the row. Do not introduce projection layers or extra identity wrappers.

## Non-negotiable rules

- Do not introduce `RowProjection`, `NodeProjection`, `RenderedRowIdentity`, `ConcreteRowProjection`, `VirtualRowProjection`, `ReferenceRowProjection`, or equivalent parallel identity types.
- Do not introduce any other types then Row.
- Do not introduce `Map<string, Row>`, `Map<string, GraphNode>`, `Map<string, NodeRef>`, `Map<string, RowProjection>`, or any view-key keyed identity lookup.
- Do not recover graph identity from `viewKey` or `ViewPath` after `treeTraversal`.
- Do not pass selected view keys across DnD/planner/action boundaries and then resolve them later.
- Do not keep migration compatibility side channels. Delete old side channels when rows replace them.
- Delete `ViewContext` as a React context/hook/provider before final acceptance. Row-rendered components must get occurrence state from `Row`; pane/root UI must use explicit pane/root helpers instead of a bare `ViewPath` context.
- Do not add all-DB or all-node fallback scans to compensate for missing source identity.
- Tests must pass after each checkpoint.

## Complexity reduction mandate

This migration is not a compatibility refactor. The purpose of the Row model is to delete the old editor identity machinery and make the editor substantially simpler.

Prefer deleting and rewriting production code over preserving old APIs, wrappers, adapters, or side channels. This project is pre-first-release; backwards compatibility is harmful here.

Rules:

- Be deletion-first.
- Do not preserve path-driven/editor helper APIs just to reduce call-site churn.
- If a function exists mainly to recover graph identity from `ViewPath`, `viewKey`, `VirtualRowsMap`, or parsed path segments, delete it once the caller has `Row`.
- If a component/action is simpler when rewritten around `row`, rewrite it instead of layering `row` on top of old code.
- Do not keep compatibility bridges between old path-driven rendering and new row-driven rendering.
- Do not introduce adapter/projection/cache types to make old code keep working.
- Do not replace one side channel with another side channel.
- Production editor code should shrink substantially. Any production-code increase must be justified by deleting more complex old machinery.
- Failing integration tests should guide direct Row-based behavior fixes, not resurrection of old lookup paths.
- Integration tests are the safety net. Preserve user-visible behavior; delete implementation complexity.
- If two implementations are possible, choose the one that deletes more old production code while keeping integration tests green.

## Checkpoint 1 — `treeTraversal` returns rows

Replace the primary `TreeResult` output with ordered rows.

Current model to remove:

```ts
{
  paths: List<ViewPath>;
  virtualRows: VirtualRowsMap;
  firstVirtualKeys: Set<string>;
}
```

Target model:

```ts
{
  rows: List<Row>;
}
```

Requirements:

- Virtual rows are rows in `rows`, not entries in a side map.
- Concrete rows are rows in `rows`, not `ViewPath`s that must be resolved later.
- `treeTraversal` does source-aware lookup once and stores the resolved row data on the row.
- `viewPath` and `viewKey` are kept only as row occurrence fields.
- No compatibility `rowByViewKey` map is introduced.

## Checkpoint 2 — Render from rows

Change editor tree rendering from path-driven rendering to row-driven rendering.

Old shape:

```tsx
paths.map((path) => (
  <ViewContext.Provider value={path}>
    <ListItem />
  </ViewContext.Provider>
));
```

Target shape:

```tsx
rows.map((row) => <ListItem key={row.viewKey} row={row} />);
```

Requirements:

- `ListItem`, `Draggable`, `Node`, selector buttons, row actions, fullscreen, and split-pane actions receive the row or use a row context.
- `ViewContext` may remain only as temporary scaffolding during the migration; it must be deleted before final acceptance.
- While it temporarily exists for focus/view-state utilities, it is populated from `row.viewPath`; it must not be used to rediscover graph identity.
- Rendering a row must not call `getNodeForView` or `getCurrentEdgeForView` to know what node it displays.

## Checkpoint 3 — Multiselect filters rows, not resolves keys

Selection state may remain view-key based because selection is UI occurrence state.

Allowed:

```ts
const selectedRows = rows.filter((row) => selection.has(row.viewKey));
```

Forbidden:

```ts
selection.map(parseViewPath);
selection.map((key) => rowMap.get(key));
selection.map((key) => getNodeForView(data, parseViewPath(key)));
```

Requirements:

- Multiselect actions receive `Row[]` / `List<Row>`, not view keys.
- Parent/child selected duplicate filtering happens over ordered rows.
- Selection storage remains UI-only and is never used as graph identity.

## Checkpoint 4 — DnD payload carries rows

Drag start has access to:

- current row
- current ordered visible rows
- current selection view keys

Build the DnD payload at drag start:

```text
if current row is selected:
  draggedRows = selected rows in visible order
else:
  draggedRows = [current row]
```

Requirements:

- DnD payload carries dragged rows, not selected view keys.
- Drop target does not resolve selected rows from view keys.
- DnD may use row `viewPath`, index, and depth for visual geometry only.
- Source node identity comes from dragged rows.
- Target parent identity comes from target row / row-derived insert context.
- Planner calls receive row-derived node refs and insertion data, not raw `ViewPath` as concrete identity.

## Checkpoint 5 — Planner/editor actions accept rows

Migrate editor action boundaries to row-based inputs.

Target shapes:

```text
delete row
move rows to target row/parent + index
copy rows to target row/parent + index
update row metadata
save row text
open row fullscreen
open row in split pane
accept/copy virtual row
```

Requirements:

- Planner wrappers receive rows or row-derived graph identity.
- `ViewPath` may be passed only for focus restoration, expansion state, DOM focus, and view-state preservation.
- `ViewPath` must not decide which graph node/source is mutated, copied, deleted, linked, or opened.
- Batch relevance, argument, indent, outdent, delete, DnD, copy, and paste operate on rows.

## Checkpoint 6 — Delete old side channels

Delete these. Do not shrink them. Do not leave compatibility versions.

- `VirtualRowsMap`
- `VirtualRowsProvider`
- `useVirtualRowsMap`
- `ViewContext` React context/provider/hook usage in row-rendered editor code
- `ReferenceRow`
- `VirtualType`
- `VersionMeta`
- `GraphNode.virtualType`
- `GraphNode.versionMeta`
- `TreeResult.paths` as the editor/render primary output
- editor action usage of `getCurrentEdgeForView`
- editor action usage of `getNodeForView`
- any `viewKey -> row` map
- any `viewKey -> node` map
- any `viewKey -> GraphNode` map
- any `viewKey -> NodeRef` map
- any `viewKey -> sourceId` map
- any `viewKey -> projection` map
- `ViewContext` as a compatibility bridge for bare `ViewPath` access
- `RowProjection` or equivalent projection layer

Hard acceptance:

```text
There is no side map that recovers row, node, source, NodeRef, or projection identity from viewKey.
```

```text
There is no Map keyed by viewKey/string viewKey that stores Row, GraphNode, NodeRef, source identity, or projection identity.
```

```text
There is no viewKey -> NodeRef map or lookup path. NodeRef values come from Row values only.
```

```text
After treeTraversal, graph identity flows only through Row values.
```

No exceptions.

## Checkpoint 7 — Remove fallback scans and hot-path lookup repetition

Requirements:

- Delete `findUniquePlanNodeByID` and any equivalent all-DB fallback scan.
- Planner lookup is exact source only.
- Do not call `graphLookupFromData(data)` inside per-row render helpers or component hot paths.
- Source-aware lookup belongs in traversal or explicit boundary helpers, not repeated inside every row component.

## Hard grep acceptance gates

These checks must be clean or every remaining hit must be UI-only and not graph identity recovery. There are no exceptions for view-key identity maps.

```sh
rg "VirtualRowsMap|VirtualRowsProvider|useVirtualRowsMap" src
rg "ViewContext|useViewPath\(|<ViewContext\.Provider" src/editor src/dnd.tsx src/planner.tsx src/treeMutations.ts src/nodeItemMutations.ts
rg "RowProjection|NodeProjection|RenderedRowIdentity|ConcreteRowProjection|VirtualRowProjection|ReferenceRowProjection" src
rg "Map<string, Row|Map<string, GraphNode|Map<string, NodeRef|Map<string, .*Projection" src
rg "rowMap\.get|rowsByViewKey|rowByViewKey|nodeByViewKey|projectionByViewKey" src
rg "\.get\(viewKey\)|\.get\(viewPathToString" src
rg "findUniquePlanNodeByID|knowledgeDBs\.valueSeq\(\)" src/planner.tsx src/core/plan.ts src/core/planLookup.ts src/treeMutations.ts src/nodeItemMutations.ts src/dnd.tsx
```

Planner/editor action files must not use these functions for concrete graph identity:

```sh
rg "getNodeForView|getCurrentEdgeForView|getRowIDFromView|getParentNode|getNodeIndexForView|getContext|getEffectiveAuthor|parseViewPath" \
  src/planner.tsx src/treeMutations.ts src/nodeItemMutations.ts src/dnd.tsx src/editor
```

Remaining hits are allowed only when they are strictly UI occurrence concerns: focus, expansion, DOM targeting, visible ordering, depth calculation, or view-state preservation. They must not choose graph source/node identity.

## Test requirements

After each checkpoint:

```sh
npm run typescript && npm run lint && npm test
```

Focused suites to run while working on row/DnD/editor behavior:

```sh
npm test -- src/editor/SuggestionDisplay.test.tsx
npm test -- src/editor/IncomingRefInteraction.test.tsx
npm test -- src/dnd.test.tsx
npm test -- src/editor/MultiTopNodeDocuments.test.tsx
npm test -- src/editor/Multiselect.test.tsx
npm test -- src/editor/MultiselectMovement.test.tsx
npm test -- src/editor/DeleteKey.test.tsx
```

Focused tests do not replace the full gate.

## Final acceptance criteria

- `treeTraversal` returns rows as the editor model.
- Editor rendering maps over rows.
- DnD payloads carry rows.
- Multiselect stores view keys only as UI state; actions filter current rows and then operate on rows.
- Planner/editor mutations receive rows or row-derived graph identity.
- `ReferenceRow`, `VirtualType`, and `VersionMeta` are deleted as standalone editor/view-row types.
- `GraphNode.virtualType` and `GraphNode.versionMeta` are deleted; virtual/version display state lives on `Row` only.
- `VirtualRowsMap`, `VirtualRowsProvider`, and `useVirtualRowsMap` are deleted.
- `ViewContext` as a React context/provider/hook is deleted from row-rendered editor code; `ViewPath` remains only as a `Row` occurrence field and explicit UI/view-state function input.
- No view-key keyed identity map exists.
- No `viewKey -> NodeRef` map, lookup, cache, or side channel exists.
- No `Map<string, NodeRef>` is introduced for editor row identity.
- No view-key keyed map stores `Row`, `GraphNode`, `NodeRef`, source identity, or projection identity.
- No virtual-row side map exists.
- No projection layer exists.
- No all-DB unique fallback exists.
- The Row migration produces a substantial net deletion of production editor identity/render/action code.
- Old path/view-key/virtual-row helper code is deleted, not wrapped.
- The final code has one direct flow: `treeTraversal -> rows -> render rows -> actions receive rows`.
- Row-rendered components do not consume a bare `ViewPath` context; they consume `Row`.
- Duplicate bare IDs across sources are safe because every row carries its source.
- `ViewPath` / `viewKey` are UI occurrence fields only.
- Any remaining `ViewPath`/`viewKey` code is strictly UI occurrence state: focus, expansion, DOM targeting, visible ordering, depth, or view-state preservation.
- `npm run typescript`, `npm run lint`, and `npm test` pass.
