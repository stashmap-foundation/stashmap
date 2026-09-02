import { List, OrderedSet } from "immutable";
import { childViewKey } from "../rowModel";
import { Plan, planUpdateNodeSpans } from "../planner";
import {
  planUpdateViewItemMetadata,
  NodeItemMetadata,
} from "../nodeItemMutations";
import {
  planMoveRows,
  planMoveRowsIntoMaterializedRow,
} from "../treeMutations";
import { isEmptyNodeID } from "../core/connections";
import {
  planAddTopTargetsToDocument,
  planMaterializeComputedRow,
} from "../core/plan";
import { getDocumentByIdOrFilePath } from "../core/Document";
import { spansToMarkdown } from "../core/nodeSpans";

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

function planUpdateOneMetadata(
  acc: Plan,
  row: Row,
  metadata: NodeItemMetadata,
  editorSpans: InlineSpan[] | undefined
): Plan {
  // Projected embed content is readonly: a judgment there must never
  // write through to the source node.
  if (row.projected) {
    return acc;
  }
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
  return planUpdateViewItemMetadata(
    acc,
    {
      node: row.node,
      nodeID: row.node.id,
      viewPath: row.viewPath,
      parentNode: row.parentNode,
      parentViewPath: row.parentViewPath,
      childIndex: row.childIndex,
      paneIndex,
      paneAuthor: pane.sourceId,
      documentId: pane.documentId,
      isDocumentTopLevel: pane.documentId !== undefined && !row.parentViewPath,
    },
    metadata,
    editorSpans
  );
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

export function getPreviousSiblingFromRows(
  rows: List<Row>,
  row: Row
): Row | undefined {
  const above = rows.slice(0, row.index).reverse();
  const blocked = above.findIndex((candidate) => candidate.depth < row.depth);
  return above
    .slice(0, blocked < 0 ? above.size : blocked)
    .find(
      (candidate) =>
        candidate.depth === row.depth && candidate.virtualType === undefined
    );
}

function nextRowAfter(
  orderedRows: List<Row>,
  fromIndex: number,
  grabbed: Row[]
): Row | undefined {
  return orderedRows
    .slice(fromIndex)
    .find(
      (row) =>
        row.virtualType === undefined &&
        !isEmptyNodeID(row.node.id) &&
        !grabbed.some(
          (source) =>
            row.viewKey === source.viewKey ||
            row.viewKey.startsWith(`${source.viewKey}:`)
        )
    );
}

function planRowMove(
  plan: Plan,
  data: Data,
  sortedRows: Row[],
  insertBefore: Row | undefined,
  indent: number,
  newParentKey: string,
  editorInfo: EditorInfo | undefined
): Plan | undefined {
  const paneIndex = sortedRows[0].viewPath[0];
  const moved = planMoveRows(
    plan,
    data,
    paneIndex,
    sortedRows,
    insertBefore,
    indent
  );
  if (!moved) {
    return undefined;
  }
  const withSpans = sortedRows.reduce((acc, row) => {
    const editorSpans = getEditorSpansForRow(editorInfo, row);
    if (
      !editorSpans ||
      spansToMarkdown(editorSpans) === spansToMarkdown(row.node.spans)
    ) {
      return acc;
    }
    return planUpdateNodeSpans(acc, row.node.id, editorSpans);
  }, moved);
  const remappedKeys = sortedRows.flatMap((row) => {
    const toKey = childViewKey(newParentKey, row.node.id);
    return toKey === row.viewKey ? [] : [{ fromKey: row.viewKey, toKey }];
  });
  return remapSelectionForMovedKeys(plan, withSpans, remappedKeys);
}

function planIndentIntoComputedRow(
  plan: Plan,
  sortedRows: Row[],
  prevSibling: Row,
  editorInfo: EditorInfo | undefined
): Plan {
  const { plan: moved, remappedKeys } = planMoveRowsIntoMaterializedRow(
    plan,
    sortedRows,
    prevSibling
  );
  const withSpans = sortedRows.reduce((acc, row) => {
    const editorSpans = getEditorSpansForRow(editorInfo, row);
    if (
      !editorSpans ||
      spansToMarkdown(editorSpans) === spansToMarkdown(row.node.spans) ||
      !remappedKeys.some(({ fromKey }) => fromKey === row.viewKey)
    ) {
      return acc;
    }
    return planUpdateNodeSpans(acc, row.node.id, editorSpans);
  }, moved);
  return remapSelectionForMovedKeys(plan, withSpans, remappedKeys);
}

export function planBatchIndent(
  plan: Plan,
  data: Data,
  rows: Row[],
  orderedRows: List<Row>,
  editorInfo?: EditorInfo
): Plan | undefined {
  if (!allSameParent(rows)) return undefined;

  const sortedRows = sortByNodeIndex(rows);
  const firstRow = sortedRows[0];

  const prevSibling = getPreviousSiblingFromRows(orderedRows, firstRow);
  if (!prevSibling) return undefined;

  if (prevSibling.materialize !== undefined) {
    return planIndentIntoComputedRow(plan, sortedRows, prevSibling, editorInfo);
  }
  const lastRow = sortedRows[sortedRows.length - 1];
  return planRowMove(
    plan,
    data,
    sortedRows,
    nextRowAfter(orderedRows, lastRow.index + 1, sortedRows),
    firstRow.depth + 1,
    prevSibling.viewKey,
    editorInfo
  );
}

export function planBatchOutdent(
  plan: Plan,
  data: Data,
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

  const afterParentBlock = orderedRows
    .slice(parentRow.index + 1)
    .find((row) => row.depth <= parentRow.depth);
  const insertBefore =
    afterParentBlock &&
    nextRowAfter(orderedRows, afterParentBlock.index, sortedRows);
  return planRowMove(
    plan,
    data,
    sortedRows,
    insertBefore,
    parentRow.depth,
    grandParentRow.viewKey,
    editorInfo
  );
}
