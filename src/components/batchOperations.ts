import { OrderedSet } from "immutable";
import {
  ViewPath,
  VirtualItemsMap,
  addNodeToPathWithRelations,
  getCurrentEdgeForView,
  getParentKey,
  getParentView,
  getPreviousSibling,
  getRelationForView,
  getRelationIndex,
  parseViewPath,
  viewPathToString,
} from "../ViewContext";
import { Plan, planExpandNode, planUpdateRelationText } from "../planner";
import {
  planUpdateViewItemMetadata,
  RelationItemMetadata,
} from "../relationItemMutations";
import { planMoveNodeWithView } from "../treeMutations";

export type EditorInfo = {
  text: string;
  viewPath: ViewPath;
};

export function getCurrentItem(
  data: Data,
  viewPath: ViewPath,
  virtualItemsMap: VirtualItemsMap
): GraphNode | undefined {
  return (
    getCurrentEdgeForView(data, viewPath) ||
    virtualItemsMap.get(viewPathToString(viewPath))
  );
}

function planClearSelection(plan: Plan): Plan {
  return {
    ...plan,
    temporaryView: {
      ...plan.temporaryView,
      baseSelection: OrderedSet<string>(),
      shiftSelection: OrderedSet<string>(),
    },
  };
}

function getEditorTextForPath(
  editorInfo: EditorInfo | undefined,
  viewPath: ViewPath
): string {
  if (!editorInfo) return "";
  if (viewPathToString(editorInfo.viewPath) !== viewPathToString(viewPath))
    return "";
  return editorInfo.text;
}

function getNodeText(plan: Plan, viewPath: ViewPath, stack: ID[]): string {
  return getRelationForView(plan, viewPath, stack)?.text ?? "";
}

function planUpdateOneMetadata(
  acc: Plan,
  viewPath: ViewPath,
  stack: ID[],
  metadata: RelationItemMetadata,
  editorText: string,
  virtualItemsMap: VirtualItemsMap
): Plan {
  return planUpdateViewItemMetadata(
    acc,
    viewPath,
    stack,
    metadata,
    editorText,
    virtualItemsMap
  );
}

export function planBatchRelevance(
  plan: Plan,
  viewPaths: ViewPath[],
  stack: ID[],
  relevance: Relevance,
  virtualItemsMap: VirtualItemsMap,
  editorInfo?: EditorInfo
): Plan {
  const updated = viewPaths.reduce(
    (acc, viewPath) =>
      planUpdateOneMetadata(
        acc,
        viewPath,
        stack,
        { relevance },
        getEditorTextForPath(editorInfo, viewPath),
        virtualItemsMap
      ),
    plan
  );
  return planClearSelection(updated);
}

export function planBatchArgument(
  plan: Plan,
  viewPaths: ViewPath[],
  stack: ID[],
  argument: Argument,
  virtualItemsMap: VirtualItemsMap,
  editorInfo?: EditorInfo
): Plan {
  const updated = viewPaths.reduce(
    (acc, viewPath) =>
      planUpdateOneMetadata(
        acc,
        viewPath,
        stack,
        { argument },
        getEditorTextForPath(editorInfo, viewPath),
        virtualItemsMap
      ),
    plan
  );
  return planClearSelection(updated);
}

function allSameParent(viewKeys: string[]): boolean {
  if (viewKeys.length === 0) return false;
  const firstParent = getParentKey(viewKeys[0]);
  return viewKeys.every((k) => getParentKey(k) === firstParent);
}

type SelectionRemap = {
  fromKey: string;
  toKey: string;
};

function remapSelectionForMovedKeys(
  originalPlan: Plan,
  updatedPlan: Plan,
  keyRemap: SelectionRemap[]
): Plan {
  if (keyRemap.length === 0) {
    return updatedPlan;
  }
  const keyMap = keyRemap.reduce(
    (acc, { fromKey, toKey }) => acc.set(fromKey, toKey),
    new Map<string, string>()
  );
  const remapSelectionSet = (
    selection: OrderedSet<string>
  ): OrderedSet<string> =>
    OrderedSet<string>(
      selection.toArray().map((key) => keyMap.get(key) || key)
    );
  const remappedAnchor =
    keyMap.get(originalPlan.temporaryView.anchor) ||
    originalPlan.temporaryView.anchor;
  return {
    ...updatedPlan,
    temporaryView: {
      ...updatedPlan.temporaryView,
      baseSelection: remapSelectionSet(
        originalPlan.temporaryView.baseSelection
      ),
      shiftSelection: remapSelectionSet(
        originalPlan.temporaryView.shiftSelection
      ),
      anchor: remappedAnchor,
    },
  };
}

function sortByRelationIndex(plan: Plan, viewPaths: ViewPath[]): ViewPath[] {
  return [...viewPaths].sort((a, b) => {
    const idxA = getRelationIndex(plan, a) ?? 0;
    const idxB = getRelationIndex(plan, b) ?? 0;
    return idxA - idxB;
  });
}

export function planBatchIndent(
  plan: Plan,
  viewKeys: string[],
  stack: ID[],
  editorInfo?: EditorInfo
): Plan | undefined {
  if (!allSameParent(viewKeys)) return undefined;

  const viewPaths = sortByRelationIndex(plan, viewKeys.map(parseViewPath));
  const firstPath = viewPaths[0];

  const prevSibling = getPreviousSibling(plan, firstPath, stack);
  if (!prevSibling) return undefined;

  const planWithExpand = planExpandNode(
    plan,
    prevSibling.view,
    prevSibling.viewPath
  );

  const { plan: updated, remappedKeys } = viewPaths.reduce(
    (state, viewPath) => {
      const fromKey = viewPathToString(viewPath);
      const targetRelationBefore = getRelationForView(
        state.plan,
        prevSibling.viewPath,
        stack
      );
      const insertAt = targetRelationBefore?.children.size ?? 0;
      const moved = planMoveNodeWithView(
        state.plan,
        viewPath,
        prevSibling.viewPath,
        stack,
        insertAt
      );
      const targetRelationAfter = getRelationForView(
        moved,
        prevSibling.viewPath,
        stack
      );
      const updatedViewPath =
        targetRelationAfter && insertAt < targetRelationAfter.children.size
          ? addNodeToPathWithRelations(
              prevSibling.viewPath,
              targetRelationAfter,
              insertAt
            )
          : undefined;
      const nextRemappedKeys = updatedViewPath
        ? [
            ...state.remappedKeys,
            {
              fromKey,
              toKey: viewPathToString(updatedViewPath),
            },
          ]
        : state.remappedKeys;
      const editorText = getEditorTextForPath(editorInfo, viewPath);
      if (!editorText) {
        return { plan: moved, remappedKeys: nextRemappedKeys };
      }
      const nodeText = getNodeText(state.plan, viewPath, stack);
      if (editorText === nodeText) {
        return { plan: moved, remappedKeys: nextRemappedKeys };
      }
      return {
        plan: updatedViewPath
          ? planUpdateRelationText(moved, updatedViewPath, stack, editorText)
          : moved,
        remappedKeys: nextRemappedKeys,
      };
    },
    { plan: planWithExpand, remappedKeys: [] as SelectionRemap[] }
  );

  return remapSelectionForMovedKeys(plan, updated, remappedKeys);
}

export function planBatchOutdent(
  plan: Plan,
  viewKeys: string[],
  stack: ID[],
  editorInfo?: EditorInfo
): Plan | undefined {
  if (!allSameParent(viewKeys)) return undefined;

  const viewPaths = sortByRelationIndex(plan, viewKeys.map(parseViewPath));
  const firstPath = viewPaths[0];
  const parentPath = getParentView(firstPath);
  if (!parentPath) return undefined;

  const grandParentPath = getParentView(parentPath);
  if (!grandParentPath) return undefined;

  const parentRelationIndex = getRelationIndex(plan, parentPath);
  if (parentRelationIndex === undefined) return undefined;

  const { plan: updated, remappedKeys } = viewPaths.reduce(
    (state, viewPath, idx) => {
      const fromKey = viewPathToString(viewPath);
      const insertAt = parentRelationIndex + 1 + idx;
      const moved = planMoveNodeWithView(
        state.plan,
        viewPath,
        grandParentPath,
        stack,
        insertAt
      );
      const targetRelationAfter = getRelationForView(
        moved,
        grandParentPath,
        stack
      );
      const updatedViewPath =
        targetRelationAfter && insertAt < targetRelationAfter.children.size
          ? addNodeToPathWithRelations(
              grandParentPath,
              targetRelationAfter,
              insertAt
            )
          : undefined;
      const nextRemappedKeys = updatedViewPath
        ? [
            ...state.remappedKeys,
            {
              fromKey,
              toKey: viewPathToString(updatedViewPath),
            },
          ]
        : state.remappedKeys;
      const editorText = getEditorTextForPath(editorInfo, viewPath);
      if (!editorText) {
        return { plan: moved, remappedKeys: nextRemappedKeys };
      }
      const nodeText = getNodeText(state.plan, viewPath, stack);
      if (editorText === nodeText) {
        return { plan: moved, remappedKeys: nextRemappedKeys };
      }
      return {
        plan: updatedViewPath
          ? planUpdateRelationText(moved, updatedViewPath, stack, editorText)
          : moved,
        remappedKeys: nextRemappedKeys,
      };
    },
    { plan, remappedKeys: [] as SelectionRemap[] }
  );

  return remapSelectionForMovedKeys(plan, updated, remappedKeys);
}
