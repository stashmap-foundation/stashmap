import { List, OrderedSet } from "immutable";
import { LOCAL } from "../core/nodeRef";
import { addNodeToPathWithNodes, viewPathToString } from "../rowModel";
import { Plan, planExpandNode, planUpdateNodeText } from "../planner";
import {
  planUpdateViewItemMetadata,
  NodeItemMetadata,
} from "../nodeItemMutations";
import { planMoveNode } from "../treeMutations";
import { getNode } from "../core/connections";
import { planMaterializeComputedRow } from "../core/plan";
import { isBlockLinkAny, nodeText } from "../core/nodeSpans";

export type EditorInfo = {
  text: string;
  viewKey: string;
};

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

function getEditorTextForRow(
  editorInfo: EditorInfo | undefined,
  row: Row
): string {
  if (!editorInfo) return "";
  if (editorInfo.viewKey !== row.viewKey) return "";
  return editorInfo.text;
}

function getNodeText(row: Row): string {
  return nodeText(row.node);
}

function planUpdateOneMetadata(
  acc: Plan,
  row: Row,
  metadata: NodeItemMetadata,
  editorText: string
): Plan {
  // Write gestures take first: a computed row materializes with the
  // judgment applied at creation — one plan, one save.
  const [materializedPlan, , materializedNow] = planMaterializeComputedRow(
    acc,
    row,
    { relevance: metadata.relevance, argument: metadata.argument }
  );
  if (materializedNow) {
    return materializedPlan;
  }
  const paneIndex = row.viewPath[0];
  const pane = acc.panes[paneIndex];
  return planUpdateViewItemMetadata(
    acc,
    {
      node: row.node,
      rowID: row.rowID,
      sourceId: row.sourceId,
      viewPath: row.viewPath,
      parentNode: row.parentNode,
      parentViewPath: row.parentViewPath,
      childIndex: row.childIndex,
      virtualType: row.virtualType,
      paneIndex,
      paneAuthor: pane.sourceId,
      documentId: pane.documentId,
      isDocumentTopLevel: pane.documentId !== undefined && !row.parentViewPath,
    },
    metadata,
    editorText
  );
}

export function planBatchRelevance(
  plan: Plan,
  rows: Row[],
  relevance: Relevance,
  editorInfo?: EditorInfo
): Plan {
  const updated = rows.reduce(
    (acc, row) =>
      planUpdateOneMetadata(
        acc,
        row,
        { relevance },
        getEditorTextForRow(editorInfo, row)
      ),
    plan
  );
  return planClearSelection(updated);
}

export function planBatchArgument(
  plan: Plan,
  rows: Row[],
  argument: Argument,
  editorInfo?: EditorInfo
): Plan {
  const updated = rows.reduce(
    (acc, row) =>
      planUpdateOneMetadata(
        acc,
        row,
        { argument },
        getEditorTextForRow(editorInfo, row)
      ),
    plan
  );
  return planClearSelection(updated);
}

function refsEqual(
  left: NodeRef | undefined,
  right: NodeRef | undefined
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.sourceId === right.sourceId && left.id === right.id;
}

function allSameParent(rows: Row[]): boolean {
  if (rows.length === 0) return false;
  const firstParent = rows[0].parentRef;
  return rows.every((row) => refsEqual(row.parentRef, firstParent));
}

function remapSelectionForMovedKeys(
  originalPlan: Plan,
  updatedPlan: Plan,
  keyRemap: { fromKey: string; toKey: string }[]
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

function sortByNodeIndex(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => (a.childIndex ?? 0) - (b.childIndex ?? 0));
}

export function getVisibleParentRow(
  rows: List<Row>,
  row: Row
): Row | undefined {
  if (!row.parentRef) {
    return undefined;
  }
  return rows
    .slice(0, row.index)
    .reverse()
    .find(
      (candidate) =>
        candidate.depth < row.depth && refsEqual(candidate.ref, row.parentRef)
    );
}

function getPreviousSiblingFromRows(
  rows: List<Row>,
  row: Row
): Row | undefined {
  const { childIndex } = row;
  if (childIndex === undefined || childIndex === 0) {
    return undefined;
  }
  return rows
    .slice(0, row.index)
    .reverse()
    .find(
      (candidate) =>
        candidate.childIndex !== undefined &&
        candidate.parentRef?.sourceId === row.parentRef?.sourceId &&
        candidate.parentRef?.id === row.parentRef?.id &&
        candidate.childIndex < childIndex
    );
}

function getCurrentPlanNode(plan: Plan, node: GraphNode): GraphNode {
  return getNode(plan.knowledgeDBs, node.id, LOCAL) ?? node;
}

export function planBatchIndent(
  plan: Plan,
  rows: Row[],
  orderedRows: List<Row>,
  editorInfo?: EditorInfo
): Plan | undefined {
  if (!allSameParent(rows)) return undefined;

  const sortedRows = sortByNodeIndex(rows);
  const firstRow = sortedRows[0];

  const prevSibling = getPreviousSiblingFromRows(orderedRows, firstRow);
  if (!prevSibling) return undefined;
  if (isBlockLinkAny(prevSibling.node)) return undefined;

  // Indenting onto a computed row takes it first.
  const [planMaterialized] = planMaterializeComputedRow(plan, prevSibling);

  const planWithExpand = planExpandNode(
    planMaterialized,
    prevSibling.view,
    prevSibling.viewPath
  );

  const { plan: updated, remappedKeys } = sortedRows.reduce<{
    plan: Plan;
    remappedKeys: { fromKey: string; toKey: string }[];
  }>(
    (state, row) => {
      const { viewPath } = row;
      const fromKey = row.viewKey;
      if (!row.parentNode) {
        return state;
      }
      const targetNodeBefore = getCurrentPlanNode(state.plan, prevSibling.node);
      const insertAt = targetNodeBefore.children.size;
      const moved = planMoveNode(
        state.plan,
        row.node.id,
        row.node.id,
        row.parentNode.id,
        viewPath,
        targetNodeBefore.id,
        prevSibling.viewPath,
        insertAt
      );
      const targetNodeAfter = getCurrentPlanNode(moved, prevSibling.node);
      const updatedViewPath =
        targetNodeAfter && insertAt < targetNodeAfter.children.size
          ? addNodeToPathWithNodes(
              prevSibling.viewPath,
              targetNodeAfter,
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
      const editorText = getEditorTextForRow(editorInfo, row);
      if (!editorText) {
        return { plan: moved, remappedKeys: nextRemappedKeys };
      }
      const currentText = getNodeText(row);
      if (editorText === currentText) {
        return { plan: moved, remappedKeys: nextRemappedKeys };
      }
      return {
        plan: updatedViewPath
          ? planUpdateNodeText(moved, row.node.id, editorText)
          : moved,
        remappedKeys: nextRemappedKeys,
      };
    },
    { plan: planWithExpand, remappedKeys: [] }
  );

  return remapSelectionForMovedKeys(plan, updated, remappedKeys);
}

export function planBatchOutdent(
  plan: Plan,
  rows: Row[],
  orderedRows: List<Row>,
  editorInfo?: EditorInfo
): Plan | undefined {
  if (!allSameParent(rows)) return undefined;

  const sortedRows = sortByNodeIndex(rows);
  const firstRow = sortedRows[0];
  const parentRow = getVisibleParentRow(orderedRows, firstRow);
  if (!parentRow?.parentNode) return undefined;
  const grandParentRow = getVisibleParentRow(orderedRows, parentRow);
  if (!grandParentRow) return undefined;

  const grandParentNode = parentRow.parentNode;
  const grandParentPath = grandParentRow.viewPath;

  const parentNodeIndex = firstRow.parentChildIndex;
  if (parentNodeIndex === undefined) return undefined;

  const { plan: updated, remappedKeys } = sortedRows.reduce<{
    plan: Plan;
    remappedKeys: { fromKey: string; toKey: string }[];
  }>(
    (state, row, idx) => {
      const { viewPath } = row;
      const fromKey = row.viewKey;
      if (!row.parentNode) {
        return state;
      }
      const insertAt = parentNodeIndex + 1 + idx;
      const moved = planMoveNode(
        state.plan,
        row.node.id,
        row.node.id,
        row.parentNode.id,
        viewPath,
        grandParentNode.id,
        grandParentPath,
        insertAt
      );
      const targetNodeAfter = getCurrentPlanNode(moved, grandParentNode);
      const updatedViewPath =
        targetNodeAfter && insertAt < targetNodeAfter.children.size
          ? addNodeToPathWithNodes(grandParentPath, targetNodeAfter, insertAt)
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
      const editorText = getEditorTextForRow(editorInfo, row);
      if (!editorText) {
        return { plan: moved, remappedKeys: nextRemappedKeys };
      }
      const currentText = getNodeText(row);
      if (editorText === currentText) {
        return { plan: moved, remappedKeys: nextRemappedKeys };
      }
      return {
        plan: updatedViewPath
          ? planUpdateNodeText(moved, row.node.id, editorText)
          : moved,
        remappedKeys: nextRemappedKeys,
      };
    },
    { plan, remappedKeys: [] }
  );

  return remapSelectionForMovedKeys(plan, updated, remappedKeys);
}
