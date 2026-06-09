# Delete ViewPath migration prompt

We are continuing the row-model migration. Read `AGENTS.md` and `row-model-plan.md` first. Treat `row-model-plan.md` acceptance criteria as mandatory.

## Core intent

After `treeTraversal`, editor/rendering code works from `Row` values. `ViewPath` / `viewKey` are UI occurrence fields only.

`ViewPath` should not be used in row-rendered editor code except for view settings:

- reading view settings during traversal / row construction;
- setting view settings such as expanded/type filters / persisted view state.

Every other `ViewPath` use is wrong and must be rewritten around row fields or explicit pane/root state.

Do **not** mechanically replace `useViewPath()` with `useRow().viewPath`. That only preserves the old shape under a new spelling.

## Forcing-function checkpoint 1

Temporarily reduce `useViewPath()` to a row-only tripwire:

```ts
export function useViewPath(): ViewPath {
  return useRow().viewPath;
}
```

Do not keep any fallback to `ViewContext`.
Do not add `useOptionalRow()`.
Do not add nullable/optional row compatibility paths.

Run:

```sh
npm run typescript && npm run lint
```

Then run relevant focused tests. Runtime failures are expected; they reveal old non-row dependencies.

## Fix breakages by deleting ViewPath dependency

Allowed `ViewPath` usage:

- view-settings get/set only;
- explicit narrow input to helpers that update expansion/type filter/view persistence;
- temporary focus/view-state preservation only when no graph identity is chosen from it.

Forbidden `ViewPath` usage:

- determining current node;
- determining parent node;
- determining child index;
- determining row/node id;
- delete/move/copy/paste/link/open/fullscreen/split-pane graph identity;
- DnD source/target graph identity;
- resolving selected view keys to graph identity;
- deriving sourceId;
- recovering `NodeRef`;
- reference display identity;
- editable-node mutation target.

In row-rendered components, use `Row` directly:

```ts
row.node
row.ref
row.rowID
row.view
row.viewKey
row.depth
row.index
row.parentNode
row.parentRef
row.childIndex
row.virtualType
row.versionMeta
```

For pane/root UI, do not call row hooks. Use explicit pane/document/root helpers.

For selection, `viewKey` may remain UI occurrence state only. Filter current rows by selected view keys, then operate from those rows.

For focus/DOM ordering, prefer `row.index`, `row.depth`, and `row.viewKey`. Do not parse `ViewPath`.

## Planner/action boundary rule

`Row` is an editor/rendering model only. Planner/core mutation functions must **not** accept `Row`.

The editor layer consumes `Row`, then extracts explicit row-derived graph/edit inputs and passes those inputs to planner/core mutation functions.

Allowed planner inputs:

- `NodeRef`: `{ sourceId, id }`;
- parent `NodeRef`;
- child index / insert index;
- concrete node id only when source is already explicit;
- node text / metadata;
- explicit document/pane target data when acting on pane/root/document state;
- view-setting target only for view-state updates, never graph mutation identity.

Forbidden planner inputs:

- `Row`;
- `ViewPath` as graph identity;
- `viewKey` as graph identity;
- parsed `viewKey`;
- optional row fallback;
- all-DB lookup fallback.

Bad:

```ts
planDeleteRow(plan, row);
planDeleteNodeFromView(plan, row.viewPath);
planUpdateNodeText(plan, viewPath, text);
planMoveNodeWithView(plan, sourceRow.viewPath, targetParentPath, index);
```

Good:

```ts
planDeleteNode(plan, {
  node: row.ref,
  parent: row.parentRef,
  childIndex: row.childIndex,
  isRoot: row.parentRef === undefined,
});

planUpdateNodeText(plan, row.ref, text);

planMoveNode(plan, {
  source: sourceRow.ref,
  sourceParent: sourceRow.parentRef,
  sourceChildIndex: sourceRow.childIndex,
  targetParent: targetParentRef,
  insertAtIndex,
});
```

Target flow:

```text
treeTraversal -> Row for editor/rendering -> editor extracts explicit graph inputs -> planner mutates by NodeRef/source/id/index
```

Not:

```text
treeTraversal -> Row -> planner accepts Row
```

## Forcing-function checkpoint 2

Once the code is green with row-only `useViewPath()`, delete:

- `useViewPath()`;
- `useViewKey()`;
- `<ViewContext.Provider>`;
- `ViewContext` as a React context.

Replace remaining valid view-setting calls with explicit `row.viewPath` passed directly at the narrow get/set boundary. Any other remaining `ViewPath` use is a bug.

Pure `ViewPath` utility functions may remain only if they take explicit inputs and are strictly for view settings / UI occurrence state. They must not recover graph identity.

## Prohibited compatibility moves

Do not introduce:

- optional row hooks;
- RowContext fallback hooks;
- `ViewContext` fallback;
- `rowByViewKey` / `nodeByViewKey` / `NodeRef` maps keyed by view key;
- parsing view keys back to graph identity;
- all-DB or all-node fallback scans;
- projection/parallel identity types;
- new casts/type assertions.

## Verification after each checkpoint

Run the full gate after every narrow checkpoint:

```sh
npm run typescript && npm run lint && npm test
```

Do not continue with red checks.

Before reporting done, run the hard greps from `row-model-plan.md`. Remaining `ViewPath` / `viewKey` hits must be only view-settings or UI occurrence state. No graph identity recovery is allowed.
