import { List, OrderedSet } from "immutable";
import {
  appendToPath,
  getPreviousSiblingFromRows,
  getVisibleParentRow,
  viewPathToString,
} from "../rowModel";
import {
  Plan,
  applyGesture,
  moveGestureRows,
  planExpandNode,
  planSaveNodeAndEnsureNodes,
  planUpdateEmptyNodeMetadata,
  planUpdateNodeSpans,
} from "../planner";
import { NodeItemMetadata } from "../nodeItemMetadata";
import { isEmptyNodeID } from "../core/connections";
import {
  planAddTopTargetsToDocument,
  planMaterializeComputedRow,
  planTakeOccurrence,
} from "../core/plan";
import { getDocumentByIdOrFilePath } from "../core/Document";
import { spansText, spansToMarkdown, plainSpans } from "../core/nodeSpans";
import type { Occurrence } from "../core/composition";

export type EditorInfo = {
  spans: InlineSpan[];
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

function getEditorSpansForRow(
  editorInfo: EditorInfo | undefined,
  row: Row
): InlineSpan[] | undefined {
  if (!editorInfo || editorInfo.viewKey !== row.viewKey) return undefined;
  return editorInfo.spans;
}

export function planJudgeOccurrence(
  plan: Plan,
  occurrence: Occurrence,
  metadata: NodeItemMetadata,
  editorSpans: InlineSpan[] | undefined
): Plan {
  const spans = editorSpans ?? plainSpans(occurrence.text);
  if (metadata.relevance === "not_relevant") {
    return applyGesture(plan, {
      kind: "dismiss",
      row: occurrence,
      spans,
    });
  }
  return applyGesture(plan, {
    kind: "judge",
    row: occurrence,
    relevance:
      "relevance" in metadata
        ? metadata.relevance
        : occurrence.line.node.relevance,
    argument:
      "argument" in metadata
        ? metadata.argument
        : occurrence.line.node.argument,
    spans,
  });
}

export function planUpdateOneMetadata(
  acc: Plan,
  row: Row,
  metadata: NodeItemMetadata,
  editorSpans: InlineSpan[] | undefined
): Plan {
  if (row.occurrence) {
    return planJudgeOccurrence(acc, row.occurrence, metadata, editorSpans);
  }
  if (isEmptyNodeID(row.node.id)) {
    if (!row.parentViewPath) {
      return acc;
    }
    if (editorSpans && spansText(editorSpans).trim() !== "") {
      return planSaveNodeAndEnsureNodes(
        acc,
        editorSpans,
        row.node.id,
        row.node,
        row.viewPath,
        row.parentNode,
        row.parentViewPath,
        row.viewPath[0],
        metadata.relevance,
        metadata.argument
      ).plan;
    }
    return row.parentNode
      ? planUpdateEmptyNodeMetadata(acc, row.parentNode.id, metadata)
      : acc;
  }
  const host = row.materialize?.host;
  const takenHost = host?.occurrence
    ? planTakeOccurrence(acc, host.occurrence)
    : undefined;
  const hostPlan = takenHost?.[0] ?? acc;
  const hostRow = takenHost?.[1]
    ? {
        ...row,
        parentRef: {
          sourceId: host?.occurrence?.line.ref.sourceId ?? row.sourceId,
          id: takenHost[1].id,
        },
      }
    : row;
  const [materializedPlan, , materializedNow] = planMaterializeComputedRow(
    hostPlan,
    hostRow,
    { relevance: metadata.relevance, argument: metadata.argument }
  );
  if (materializedNow) {
    return materializedPlan;
  }
  const pane = acc.panes[row.viewPath[0]];
  const document = pane.documentId
    ? getDocumentByIdOrFilePath(
        acc.documents,
        acc.documentByFilePath,
        pane.sourceId,
        pane.documentId
      )
    : undefined;
  if (row.materialize?.take && !row.parentRef && document) {
    return planAddTopTargetsToDocument(
      acc,
      document,
      row.materialize.take,
      metadata.relevance,
      metadata.argument
    )[0];
  }
  return acc;
}

function materializationFirst(rows: Row[]): Row[] {
  return [
    ...rows.filter((row) => row.materialize !== undefined),
    ...rows.filter((row) => row.materialize === undefined),
  ];
}

export function planBatchRelevance(
  plan: Plan,
  rows: Row[],
  relevance: Relevance,
  editorInfo?: EditorInfo
): Plan {
  const updated = materializationFirst(rows).reduce(
    (acc, row) =>
      planUpdateOneMetadata(
        acc,
        row,
        { relevance },
        getEditorSpansForRow(editorInfo, row)
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
  const updated = materializationFirst(rows).reduce(
    (acc, row) =>
      planUpdateOneMetadata(
        acc,
        row,
        { argument },
        getEditorSpansForRow(editorInfo, row)
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

function planBatchMove(
  plan: Plan,
  sortedRows: Row[],
  moved: Plan,
  parentPath: Row["viewPath"],
  editorInfo: EditorInfo | undefined
): Plan {
  const withEdits = sortedRows.reduce((acc, row) => {
    const editorSpans = getEditorSpansForRow(editorInfo, row);
    return !editorSpans ||
      row.occurrence?.persisted === undefined ||
      spansToMarkdown(editorSpans) === spansToMarkdown(row.node.spans)
      ? acc
      : planUpdateNodeSpans(acc, row.node.id, editorSpans);
  }, moved);
  const remappedKeys = sortedRows.flatMap((row) =>
    row.occurrence?.persisted !== undefined
      ? [
          {
            fromKey: row.viewKey,
            toKey: viewPathToString(appendToPath(parentPath, row.node.id)),
          },
        ]
      : []
  );
  return remapSelectionForMovedKeys(plan, withEdits, remappedKeys);
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
  const parent = prevSibling?.occurrence;
  if (!prevSibling || !parent) return undefined;
  const gestureRows = moveGestureRows(sortedRows, orderedRows);
  if (gestureRows.length !== sortedRows.length) return undefined;
  const movedPlan = applyGesture(
    planExpandNode(plan, prevSibling.view, prevSibling.viewPath),
    {
      kind: "move",
      rows: gestureRows,
      parent,
      parentPath: prevSibling.viewPath,
      after: parent.children[parent.children.length - 1],
    }
  );
  return planBatchMove(
    plan,
    sortedRows,
    movedPlan,
    prevSibling.viewPath,
    editorInfo
  );
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
  if (!parentRow?.occurrence) return undefined;
  const grandParentRow = getVisibleParentRow(orderedRows, parentRow);
  const parent = grandParentRow?.occurrence;
  if (!grandParentRow || !parent) return undefined;
  const gestureRows = moveGestureRows(sortedRows, orderedRows);
  if (gestureRows.length !== sortedRows.length) return undefined;
  const movedPlan = applyGesture(plan, {
    kind: "move",
    rows: gestureRows,
    parent,
    parentPath: grandParentRow.viewPath,
    after: parentRow.occurrence,
  });
  return planBatchMove(
    plan,
    sortedRows,
    movedPlan,
    grandParentRow.viewPath,
    editorInfo
  );
}
