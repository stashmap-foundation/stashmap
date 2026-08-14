import { List, OrderedSet } from "immutable";
import { getPreviousSiblingFromRows, getVisibleParentRow } from "../rowModel";
import {
  Plan,
  applyGesture,
  moveGestureRows,
  planExpandRow,
  planSaveVirtualNode,
  planUpdateEmptyNodeMetadata,
} from "../planner";
import { NodeItemMetadata } from "../nodeItemMetadata";
import { createReferenceTarget, isEmptyNodeID } from "../core/connections";
import { spansText, spansToMarkdown, plainSpans } from "../core/nodeSpans";
import {
  ComposedRow,
  composedContent,
  composedLine,
  writableLine,
} from "../core/composition";

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

export function planJudgeComposedRow(
  plan: Plan,
  occurrence: ComposedRow,
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
        : composedLine(occurrence).node.relevance,
    argument:
      "argument" in metadata
        ? metadata.argument
        : composedLine(occurrence).node.argument,
    spans,
  });
}

export function planUpdateOneMetadata(
  acc: Plan,
  row: Row,
  metadata: NodeItemMetadata,
  editorSpans: InlineSpan[] | undefined
): Plan {
  if (row.rowType === "occurrence") {
    return planJudgeComposedRow(acc, row.occurrence, metadata, editorSpans);
  }
  if (row.rowType === "incoming") {
    const target =
      row.incomingEmbed !== true &&
      row.reference?.displayAs === "incoming" &&
      typeof row.incomingTarget !== "string" &&
      "targetID" in row.incomingTarget
        ? createReferenceTarget(
            row.incomingTarget.targetID,
            row.incomingTarget.linkText
          )
        : row.incomingTarget;
    return row.incomingParent
      ? applyGesture(acc, {
          kind: "accept",
          parent: row.incomingParent,
          target,
          relevance: metadata.relevance ?? row.node.relevance,
          argument: metadata.argument ?? row.node.argument,
        })
      : acc;
  }
  if (isEmptyNodeID(row.node.id)) {
    if (!row.parentViewPath) {
      return acc;
    }
    if (editorSpans && spansText(editorSpans).trim() !== "") {
      return planSaveVirtualNode(
        acc,
        editorSpans,
        row.node.id,
        row.node,
        row.viewPath,
        row.rowType === "empty" ? row.emptyParent : undefined,
        row.parentNode?.id,
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
  return acc;
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
  const updated = rows.reduce(
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

function sortByNodeIndex(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => (a.childIndex ?? 0) - (b.childIndex ?? 0));
}

function planBatchMove(
  sortedRows: Row[],
  moved: Plan,
  editorInfo: EditorInfo | undefined
): Plan {
  const withEdits = sortedRows.reduce((acc, row) => {
    const editorSpans = getEditorSpansForRow(editorInfo, row);
    return !editorSpans ||
      row.rowType !== "occurrence" ||
      writableLine(row.occurrence) === undefined ||
      spansToMarkdown(editorSpans) ===
        spansToMarkdown(composedContent(row.occurrence).node.spans)
      ? acc
      : applyGesture(acc, {
          kind: "edit",
          row: row.occurrence,
          spans: editorSpans,
        });
  }, moved);
  return withEdits;
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
  const parent =
    prevSibling?.rowType === "occurrence" ? prevSibling.occurrence : undefined;
  if (!prevSibling || !parent) return undefined;
  const gestureRows = moveGestureRows(sortedRows, orderedRows);
  if (gestureRows.length !== sortedRows.length) return undefined;
  const movedPlan = applyGesture(planExpandRow(plan, prevSibling), {
    kind: "move",
    rows: gestureRows,
    parent,
    after: parent.children[parent.children.length - 1],
  });
  return planBatchMove(sortedRows, movedPlan, editorInfo);
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
  if (parentRow?.rowType !== "occurrence") return undefined;
  const grandParentRow = getVisibleParentRow(orderedRows, parentRow);
  const parent =
    grandParentRow?.rowType === "occurrence"
      ? grandParentRow.occurrence
      : undefined;
  if (!grandParentRow || !parent) return undefined;
  const gestureRows = moveGestureRows(sortedRows, orderedRows);
  if (gestureRows.length !== sortedRows.length) return undefined;
  const movedPlan = applyGesture(plan, {
    kind: "move",
    rows: gestureRows,
    parent,
    after: parentRow.occurrence,
  });
  return planBatchMove(sortedRows, movedPlan, editorInfo);
}
