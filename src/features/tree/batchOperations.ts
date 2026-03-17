import { OrderedSet } from "immutable";
import type { Data } from "../app-shell/types";
import type { GraphNode } from "../../graph/types";
import type { VirtualRowsMap } from "../../rows/types";
import {
  addNodeToPathWithNodes,
  getCurrentEdgeForView,
  getPreviousSibling,
  getNodeForView,
  getNodeIndexForView,
} from "../../rows/resolveRow";
import {
  getParentRowPath,
  parseRowPath,
  type RowPath,
  rowPathToString,
} from "../../rows/rowPaths";
import { getParentKey, planExpandNode } from "../../session/views";
import type { Plan } from "../../app/types";
import {
  planUpdateNodeText,
  planUpdateRowNodeMetadata,
  type ChildNodeMetadata,
} from "../../app/editorActions";
import { planMoveNodeWithView } from "../../app/treeActions";

export type EditorInfo = {
  text: string;
  rowPath: RowPath;
};

export function getCurrentRow(
  data: Data,
  rowPath: RowPath,
  virtualRowsMap: VirtualRowsMap
): GraphNode | undefined {
  return (
    getCurrentEdgeForView(data, rowPath) ||
    virtualRowsMap.get(rowPathToString(rowPath))
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
  rowPath: RowPath
): string {
  if (!editorInfo) return "";
  if (rowPathToString(editorInfo.rowPath) !== rowPathToString(rowPath)) {
    return "";
  }
  return editorInfo.text;
}

function getNodeText(plan: Plan, rowPath: RowPath, stack: ID[]): string {
  return getNodeForView(plan, rowPath, stack)?.text ?? "";
}

function planUpdateOneMetadata(
  acc: Plan,
  rowPath: RowPath,
  stack: ID[],
  metadata: ChildNodeMetadata,
  editorText: string,
  virtualRowsMap: VirtualRowsMap
): Plan {
  return planUpdateRowNodeMetadata(
    acc,
    rowPath,
    stack,
    metadata,
    editorText,
    virtualRowsMap
  );
}

export function planBatchRelevance(
  plan: Plan,
  rowPaths: RowPath[],
  stack: ID[],
  relevance: Relevance,
  virtualRowsMap: VirtualRowsMap,
  editorInfo?: EditorInfo
): Plan {
  const updated = rowPaths.reduce(
    (acc, rowPath) =>
      planUpdateOneMetadata(
        acc,
        rowPath,
        stack,
        { relevance },
        getEditorTextForPath(editorInfo, rowPath),
        virtualRowsMap
      ),
    plan
  );
  return planClearSelection(updated);
}

export function planBatchArgument(
  plan: Plan,
  rowPaths: RowPath[],
  stack: ID[],
  argument: Argument,
  virtualRowsMap: VirtualRowsMap,
  editorInfo?: EditorInfo
): Plan {
  const updated = rowPaths.reduce(
    (acc, rowPath) =>
      planUpdateOneMetadata(
        acc,
        rowPath,
        stack,
        { argument },
        getEditorTextForPath(editorInfo, rowPath),
        virtualRowsMap
      ),
    plan
  );
  return planClearSelection(updated);
}

function allSameParent(viewKeys: string[]): boolean {
  if (viewKeys.length === 0) return false;
  const firstParent = getParentKey(viewKeys[0]);
  return viewKeys.every((key) => getParentKey(key) === firstParent);
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

function sortByNodeIndex(plan: Plan, rowPaths: RowPath[]): RowPath[] {
  return [...rowPaths].sort((left, right) => {
    const leftIndex = getNodeIndexForView(plan, left) ?? 0;
    const rightIndex = getNodeIndexForView(plan, right) ?? 0;
    return leftIndex - rightIndex;
  });
}

export function planBatchIndent(
  plan: Plan,
  viewKeys: string[],
  stack: ID[],
  editorInfo?: EditorInfo
): Plan | undefined {
  if (!allSameParent(viewKeys)) return undefined;

  const rowPaths = sortByNodeIndex(plan, viewKeys.map(parseRowPath));
  const firstPath = rowPaths[0];

  const previousSibling = getPreviousSibling(plan, firstPath, stack);
  if (!previousSibling) return undefined;

  const planWithExpand = planExpandNode(
    plan,
    previousSibling.view,
    previousSibling.rowPath
  );

  const { plan: updated, remappedKeys } = rowPaths.reduce(
    (state, rowPath) => {
      const fromKey = rowPathToString(rowPath);
      const targetNodeBefore = getNodeForView(
        state.plan,
        previousSibling.rowPath,
        stack
      );
      const insertAt = targetNodeBefore?.children.size ?? 0;
      const moved = planMoveNodeWithView(
        state.plan,
        rowPath,
        previousSibling.rowPath,
        stack,
        insertAt
      );
      const targetNodeAfter = getNodeForView(
        moved,
        previousSibling.rowPath,
        stack
      );
      const updatedRowPath =
        targetNodeAfter && insertAt < targetNodeAfter.children.size
          ? addNodeToPathWithNodes(
              previousSibling.rowPath,
              targetNodeAfter,
              insertAt
            )
          : undefined;
      const nextRemappedKeys = updatedRowPath
        ? [
            ...state.remappedKeys,
            {
              fromKey,
              toKey: rowPathToString(updatedRowPath),
            },
          ]
        : state.remappedKeys;
      const editorText = getEditorTextForPath(editorInfo, rowPath);
      if (!editorText) {
        return { plan: moved, remappedKeys: nextRemappedKeys };
      }
      const nodeText = getNodeText(state.plan, rowPath, stack);
      if (editorText === nodeText) {
        return { plan: moved, remappedKeys: nextRemappedKeys };
      }
      return {
        plan: updatedRowPath
          ? planUpdateNodeText(moved, updatedRowPath, stack, editorText)
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

  const rowPaths = sortByNodeIndex(plan, viewKeys.map(parseRowPath));
  const firstPath = rowPaths[0];
  const parentPath = getParentRowPath(firstPath);
  if (!parentPath) return undefined;

  const grandParentPath = getParentRowPath(parentPath);
  if (!grandParentPath) return undefined;

  const parentNodeIndex = getNodeIndexForView(plan, parentPath);
  if (parentNodeIndex === undefined) return undefined;

  const { plan: updated, remappedKeys } = rowPaths.reduce(
    (state, rowPath, index) => {
      const fromKey = rowPathToString(rowPath);
      const insertAt = parentNodeIndex + 1 + index;
      const moved = planMoveNodeWithView(
        state.plan,
        rowPath,
        grandParentPath,
        stack,
        insertAt
      );
      const targetNodeAfter = getNodeForView(moved, grandParentPath, stack);
      const updatedRowPath =
        targetNodeAfter && insertAt < targetNodeAfter.children.size
          ? addNodeToPathWithNodes(grandParentPath, targetNodeAfter, insertAt)
          : undefined;
      const nextRemappedKeys = updatedRowPath
        ? [
            ...state.remappedKeys,
            {
              fromKey,
              toKey: rowPathToString(updatedRowPath),
            },
          ]
        : state.remappedKeys;
      const editorText = getEditorTextForPath(editorInfo, rowPath);
      if (!editorText) {
        return { plan: moved, remappedKeys: nextRemappedKeys };
      }
      const nodeText = getNodeText(state.plan, rowPath, stack);
      if (editorText === nodeText) {
        return { plan: moved, remappedKeys: nextRemappedKeys };
      }
      return {
        plan: updatedRowPath
          ? planUpdateNodeText(moved, updatedRowPath, stack, editorText)
          : moved,
        remappedKeys: nextRemappedKeys,
      };
    },
    { plan, remappedKeys: [] as SelectionRemap[] }
  );

  return remapSelectionForMovedKeys(plan, updated, remappedKeys);
}
