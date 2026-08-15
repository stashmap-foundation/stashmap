import { List, OrderedSet } from "immutable";
import { getPreviousSiblingFromRows, getVisibleParentRow } from "../rowModel";
import {
  Plan,
  applyGesture,
  moveGestureRows,
  placeGestureTarget,
  planExpandRow,
  planSaveVirtualNode,
  planUpdateEmptyNodeMetadata,
  composedWriteKind,
  writableLine,
} from "../planner";
import { NodeItemMetadata } from "../nodeItemMetadata";
import { createReferenceTarget, isEmptyNodeID } from "../core/connections";
import { spansText, spansToMarkdown } from "../core/nodeSpans";
import { ComposedRow, CompositionResult } from "../core/composition";

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
  composition: CompositionResult,
  occurrence: ComposedRow,
  metadata: NodeItemMetadata,
  editorSpans: InlineSpan[] | undefined
): Plan {
  const kind = composedWriteKind(occurrence);
  const changed =
    editorSpans !== undefined &&
    spansText(editorSpans).trim() !== "" &&
    (kind === "placement" || kind === "speaking"
      ? spansText(editorSpans).trim() !== occurrence.text.trim()
      : spansToMarkdown(editorSpans) !== spansToMarkdown(occurrence.spans));
  const edited = changed
    ? applyGesture(plan, composition, {
        kind: "reword",
        row: occurrence.key,
        spans: editorSpans,
      })
    : plan;
  return applyGesture(edited, composition, {
    kind: "judge",
    row: occurrence.key,
    relevance:
      "relevance" in metadata ? metadata.relevance : occurrence.relevance,
    argument: "argument" in metadata ? metadata.argument : occurrence.argument,
  });
}

export function planUpdateOneMetadata(
  acc: Plan,
  row: Row,
  metadata: NodeItemMetadata,
  editorSpans: InlineSpan[] | undefined
): Plan {
  if (row.rowType === "occurrence") {
    return planJudgeComposedRow(
      acc,
      row.composition,
      row.occurrence,
      metadata,
      editorSpans
    );
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
    return row.incomingParent &&
      row.composition &&
      typeof target !== "string" &&
      "targetID" in target
      ? applyGesture(acc, row.composition, {
          kind: "place",
          parent: row.incomingParent.key,
          targets: [
            placeGestureTarget(
              target,
              target.targetID,
              target.linkText ?? "",
              row.sourceId,
              target.reference === true,
              metadata.relevance ?? row.node.relevance,
              metadata.argument ?? row.node.argument
            ),
          ],
          after: row.incomingParent.children.at(-1)?.key,
        })
      : acc;
  }
  if (isEmptyNodeID(row.node.id)) {
    if (!row.parentViewPath) {
      return acc;
    }
    if (
      row.rowType === "empty" &&
      editorSpans &&
      spansText(editorSpans).trim() !== ""
    ) {
      return planSaveVirtualNode(
        acc,
        editorSpans,
        row,
        row.viewPath[0],
        metadata.relevance,
        metadata.argument
      ).plan;
    }
    return row.parentKey
      ? planUpdateEmptyNodeMetadata(acc, row.parentKey, metadata)
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

function allSameParent(rows: Row[], orderedRows: List<Row>): boolean {
  if (rows.length === 0) return false;
  const firstParent = getVisibleParentRow(orderedRows, rows[0]);
  return rows.every(
    (row) =>
      getVisibleParentRow(orderedRows, row)?.viewKey === firstParent?.viewKey
  );
}

function sortByNodeIndex(rows: Row[]): Row[] {
  return [...rows].sort((left, right) => left.index - right.index);
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
      spansToMarkdown(editorSpans) === spansToMarkdown(row.occurrence.spans)
      ? acc
      : applyGesture(acc, row.composition, {
          kind: "reword",
          row: row.occurrence.key,
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
  if (!allSameParent(rows, orderedRows)) return undefined;
  const sortedRows = sortByNodeIndex(rows);
  const firstRow = sortedRows[0];
  const prevSibling = getPreviousSiblingFromRows(orderedRows, firstRow);
  if (prevSibling?.rowType !== "occurrence") return undefined;
  const parent = prevSibling.occurrence;
  const gestureRows = moveGestureRows(sortedRows);
  if (gestureRows.length !== sortedRows.length) return undefined;
  const movedPlan = applyGesture(
    planExpandRow(plan, prevSibling),
    prevSibling.composition,
    {
      kind: "move",
      rows: gestureRows,
      parent: parent.key,
      after: parent.children[parent.children.length - 1]?.key,
    }
  );
  return planBatchMove(sortedRows, movedPlan, editorInfo);
}

export function planBatchOutdent(
  plan: Plan,
  rows: Row[],
  orderedRows: List<Row>,
  editorInfo?: EditorInfo
): Plan | undefined {
  if (!allSameParent(rows, orderedRows)) return undefined;
  const sortedRows = sortByNodeIndex(rows);
  const firstRow = sortedRows[0];
  const parentRow = getVisibleParentRow(orderedRows, firstRow);
  if (parentRow?.rowType !== "occurrence") return undefined;
  const grandParentRow = getVisibleParentRow(orderedRows, parentRow);
  if (grandParentRow?.rowType !== "occurrence") return undefined;
  const parent = grandParentRow.occurrence;
  const gestureRows = moveGestureRows(sortedRows);
  if (gestureRows.length !== sortedRows.length) return undefined;
  const movedPlan = applyGesture(plan, grandParentRow.composition, {
    kind: "move",
    rows: gestureRows,
    parent: parent.key,
    after: parentRow.occurrence.key,
  });
  return planBatchMove(sortedRows, movedPlan, editorInfo);
}
