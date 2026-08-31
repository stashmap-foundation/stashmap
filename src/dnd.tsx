import React from "react";
import { List } from "immutable";
import { DndProvider, useDragLayer, XYCoord } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { nip19 } from "nostr-tools";
import { LOCAL } from "./core/nodeRef";
import { createRefTarget, getNode, isEmptyNodeID } from "./core/connections";
import { nodeText } from "./core/nodeSpans";
import { getIndependentRows } from "./rowModel";
import { getDocumentForNode } from "./core/Document";
import {
  Plan,
  planExpandNode,
  planAddToParent,
  AddToParentTarget,
} from "./planner";
import { planMoveRows } from "./treeMutations";
import {
  planMaterializeComputedRow,
  planRecordKnowstrSource,
} from "./core/plan";
import { sourceCoordinate } from "./navigationUrl";
import { decodePublicKeyInputSync } from "./infra/nostr/publicKeys";

type DragSource = {
  row: Row;
  draggedRows: Row[];
  sourcePaneIndex: number;
  text?: string;
  isCopyDrag?: boolean;
  nodeId?: ID;
  insertTarget?: AddToParentTarget;
};

function refsEqual(
  left: NodeRef | undefined,
  right: NodeRef | undefined
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.sourceId === right.sourceId &&
    left.id === right.id
  );
}

function getCurrentPlanNode(plan: Plan, node: GraphNode): GraphNode {
  return getNode(plan.knowledgeDBs, node.id, LOCAL) ?? node;
}

function addFallbackLinkText(
  target: AddToParentTarget,
  text: string | undefined
): AddToParentTarget {
  if (typeof target === "string" || !("targetID" in target)) {
    return target;
  }
  if (target.linkText || !text) {
    return target;
  }
  return createRefTarget(target.targetID, text);
}

// Dragging a row from another user's document records that document in
// knowstr_sources of ours — the one moment the source is known for
// certain, so foreign ids resolve on a future fetch.
function planRecordForeignSource(
  plan: Plan,
  sourcePane: Pane | undefined,
  sourceRow: Row,
  targetNode: GraphNode
): Plan {
  if (sourceRow.sourceId === LOCAL) {
    return plan;
  }
  const coordinate =
    sourcePane?.routeCoordinate ?? sourceCoordinate(sourceRow.sourceId);
  const pubkey =
    coordinate?.pubkey ?? decodePublicKeyInputSync(sourceRow.sourceId);
  if (!pubkey) {
    return plan;
  }
  const sourceDocument = getDocumentForNode(
    plan.knowledgeDBs,
    plan.documents,
    sourceRow.node,
    sourceRow.sourceId
  );
  const doc = sourceDocument?.docId ?? coordinate?.dTag;
  if (!doc) {
    return plan;
  }
  return planRecordKnowstrSource(plan, targetNode, {
    author: nip19.npubEncode(pubkey),
    doc,
    relays: coordinate?.relays ?? [],
  });
}

function isDraggedOccurrence(row: Row, sources: Row[]): boolean {
  return sources.some(
    (source) =>
      row.viewKey === source.viewKey ||
      row.viewKey.startsWith(`${source.viewKey}:`)
  );
}

function getVisibleParentRow(rows: List<Row>, row: Row): Row | undefined {
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

function getVisibleRootRow(rows: List<Row>): Row | undefined {
  const firstRow = rows.first();
  if (!firstRow || firstRow.parentRef) {
    return undefined;
  }
  return firstRow;
}

function getDropDestinationEndOfVisibleRoot(
  rows: List<Row>
): { parentRow: Row; insertAtIndex: number } | undefined {
  const rootRow = getVisibleRootRow(rows);
  return rootRow
    ? {
        parentRow: rootRow,
        insertAtIndex: rootRow.node.children.size || 0,
      }
    : undefined;
}

// A computed row has no childIndex; its drop position derives from the
// nearest preceding PLACED sibling in display order — your arrangement
// wins where displayed, the merge re-slots the projections around it.
function placedIndexAfter(rows: List<Row>, row: Row): number {
  const previousPlaced = rows
    .slice(0, row.index)
    .reverse()
    .find(
      (candidate) =>
        candidate.childIndex !== undefined &&
        candidate.parentRef?.sourceId === row.parentRef?.sourceId &&
        candidate.parentRef?.id === row.parentRef?.id
    );
  return previousPlaced?.childIndex !== undefined
    ? previousPlaced.childIndex + 1
    : 0;
}

type DropDestination = {
  parentRow: Row;
  insertAtIndex: number;
  // The display row the insertion conceptually follows. When it is a
  // computed row, the drop materializes it — arranging something
  // relative to an entry is touching it.
  anchorRow?: Row;
};

function getInsertAfterRow(
  rows: List<Row>,
  row: Row
): DropDestination | undefined {
  if (!row.parentRef) {
    return {
      parentRow: row,
      insertAtIndex: row.node.children.size || 0,
    };
  }
  const parentRow = getVisibleParentRow(rows, row);
  if (!parentRow) {
    return undefined;
  }
  return {
    parentRow,
    insertAtIndex:
      row.childIndex !== undefined
        ? row.childIndex + 1
        : placedIndexAfter(rows, row),
    anchorRow: row,
  };
}

function getAncestorAtDepth(
  rows: List<Row>,
  rowIndex: number,
  depth: number
): Row | undefined {
  const row = rows.get(rowIndex);
  if (!row) {
    return undefined;
  }
  if (row.depth <= depth) {
    return row;
  }
  return rows
    .slice(0, rowIndex)
    .reverse()
    .find((candidate) => candidate.depth === depth);
}

function getDropBeforeParentDestination(
  rows: List<Row>,
  dropBefore: Row
): DropDestination | undefined {
  const parentRow = getVisibleParentRow(rows, dropBefore);
  if (!parentRow) {
    return getDropDestinationEndOfVisibleRoot(rows);
  }
  // Inserting before a row = after its display predecessor under the
  // same parent, which may be a computed row.
  const displayPredecessor = rows.get(dropBefore.index - 1);
  const anchorRow =
    displayPredecessor &&
    displayPredecessor.parentRef?.sourceId === dropBefore.parentRef?.sourceId &&
    displayPredecessor.parentRef?.id === dropBefore.parentRef?.id
      ? displayPredecessor
      : undefined;
  return {
    parentRow,
    insertAtIndex: dropBefore.childIndex ?? placedIndexAfter(rows, dropBefore),
    anchorRow,
  };
}

function getRootDepth(rows: List<Row>): number {
  const firstRow = rows.first();
  if (!firstRow) {
    return 0;
  }
  return firstRow.parentRef ? firstRow.depth - 1 : firstRow.depth;
}

function findNextNonDraggedRow(
  rows: List<Row>,
  startIndex: number,
  sources: Row[]
): Row | undefined {
  return rows
    .slice(startIndex)
    .find((row) => !isDraggedOccurrence(row, sources));
}

function resolveDropByDepth(
  rows: List<Row>,
  prevRow: Row,
  dropBefore: Row | undefined,
  targetDepth: number
): { parentRow: Row; insertAtIndex: number } | undefined {
  const rootDepth = getRootDepth(rows);
  const maxDepth = prevRow.depth + 1;
  const minDepth = dropBefore ? dropBefore.depth : rootDepth + 1;
  const clampedDepth = Math.max(minDepth, Math.min(maxDepth, targetDepth));

  if (clampedDepth === prevRow.depth + 1) {
    if (dropBefore && dropBefore.depth === clampedDepth) {
      return {
        parentRow: prevRow,
        insertAtIndex: dropBefore.childIndex ?? prevRow.node.children.size,
      };
    }
    return {
      parentRow: prevRow,
      insertAtIndex: prevRow.node.children.size || 0,
    };
  }

  const ancestor = getAncestorAtDepth(rows, prevRow.index, clampedDepth);
  if (ancestor) {
    const afterAncestor = getInsertAfterRow(rows, ancestor);
    if (afterAncestor) {
      return afterAncestor;
    }
  }

  return getDropDestinationEndOfVisibleRoot(rows);
}

export function getDropDestinationFromRows(
  rows: List<Row>,
  targetRow: Row,
  targetDepth: number | undefined,
  sources: Row[]
): DropDestination | undefined {
  const dropBefore = findNextNonDraggedRow(rows, targetRow.index + 1, sources);

  if (targetDepth !== undefined) {
    return resolveDropByDepth(rows, targetRow, dropBefore, targetDepth);
  }

  if (!dropBefore) {
    return getInsertAfterRow(rows, targetRow);
  }
  if (targetRow.depth > dropBefore.depth) {
    const afterTarget = getInsertAfterRow(rows, targetRow);
    if (afterTarget) {
      return afterTarget;
    }
  }
  return getDropBeforeParentDestination(rows, dropBefore);
}

function panesShowSameView(
  source: Pane | undefined,
  target: Pane | undefined
): boolean {
  if (!source || !target || source.sourceId !== target.sourceId) {
    return false;
  }
  if (source.documentId !== undefined || target.documentId !== undefined) {
    return source.documentId === target.documentId;
  }
  return (
    source.rootNodeId !== undefined && source.rootNodeId === target.rootNodeId
  );
}

function nextMoveAnchor(
  rows: List<Row>,
  startIndex: number,
  sources: Row[]
): Row | undefined {
  return rows
    .slice(startIndex)
    .find(
      (row) =>
        !isDraggedOccurrence(row, sources) &&
        row.virtualType === undefined &&
        !isEmptyNodeID(row.node.id)
    );
}

function moveIndent(
  rows: List<Row>,
  targetRow: Row,
  insertBefore: Row | undefined,
  targetDepth: number | undefined
): number {
  const fallback = ((): number => {
    if (insertBefore === undefined) {
      return targetRow.parentRef === undefined
        ? targetRow.depth + 1
        : targetRow.depth;
    }
    return targetRow.depth > insertBefore.depth
      ? targetRow.depth
      : insertBefore.depth;
  })();
  const minDepth = insertBefore ? insertBefore.depth : getRootDepth(rows) + 1;
  const maxDepth = targetRow.depth + 1;
  return Math.max(minDepth, Math.min(maxDepth, targetDepth ?? fallback));
}

function remapPaneKey(viewKey: string, paneIndex: number): string {
  return viewKey.replace(/^p\d+:/u, `p${paneIndex}:`);
}

// The move gesture hands the writer exactly three things: the grabbed
// rows, the row to insert before, and the indent.
export function moveWithinView(
  basePlan: Plan,
  data: Data,
  targetPaneIndex: number,
  sourceDrag: DragSource,
  rows: List<Row>,
  targetRow: Row,
  targetDepth: number | undefined
): Plan | undefined {
  const sources = sourceDrag.draggedRows.length
    ? sourceDrag.draggedRows
    : [sourceDrag.row];
  const independent = getIndependentRows(sources);
  const sameView =
    sourceDrag.sourcePaneIndex === targetPaneIndex ||
    panesShowSameView(
      data.panes[sourceDrag.sourcePaneIndex],
      data.panes[targetPaneIndex]
    );
  if (
    !sameView ||
    sourceDrag.isCopyDrag ||
    sourceDrag.insertTarget !== undefined ||
    independent.some(
      (row) => row.virtualType !== undefined || row.materialize !== undefined
    )
  ) {
    return undefined;
  }
  const insertBefore = nextMoveAnchor(rows, targetRow.index + 1, sources);
  const indent = moveIndent(rows, targetRow, insertBefore, targetDepth);
  return planMoveRows(
    basePlan,
    data,
    targetPaneIndex,
    independent.map((row) => remapPaneKey(row.viewKey, targetPaneIndex)),
    insertBefore?.viewKey,
    indent
  );
}

export function dnd(
  basePlan: Plan,
  sourceDrag: DragSource,
  targetPaneIndex: number,
  targetParentRow: Row,
  dropIndex: number
): Plan {
  const source = sourceDrag.row.viewKey;
  const sources = sourceDrag.draggedRows.length
    ? sourceDrag.draggedRows
    : [sourceDrag.row];
  const independentRows = getIndependentRows(sources);
  // Projected embed content is readonly: nothing drops into it, and its
  // rows don't drag out yet — materializing from an embed is later work.
  if (
    targetParentRow.projected ||
    independentRows.some((row) => row.projected)
  ) {
    return basePlan;
  }
  const [plan, targetParentNode] = planMaterializeComputedRow(
    basePlan,
    targetParentRow
  );

  const sourcePane = plan.panes[sourceDrag.sourcePaneIndex];
  const targetPane = plan.panes[targetPaneIndex];
  if (!sourcePane || !targetPane) {
    return plan;
  }
  const sourceDocument = getDocumentForNode(
    plan.knowledgeDBs,
    plan.documents,
    sourceDrag.row.node,
    sourceDrag.row.sourceId
  );
  const targetSourceId = targetParentRow.materialize
    ? LOCAL
    : targetParentRow.sourceId;
  const targetDocument = getDocumentForNode(
    plan.knowledgeDBs,
    plan.documents,
    targetParentNode,
    targetSourceId
  );
  const isSameDocument =
    sourceDocument !== undefined &&
    targetDocument !== undefined &&
    sourceDocument.sourceId === targetDocument.sourceId &&
    sourceDocument.docId === targetDocument.docId;
  const isDocumentTopLevelSource =
    sourceDocument !== undefined &&
    sourceDocument.sourceId === sourceDrag.row.sourceId &&
    sourceDocument.topNodeShortIds.includes(sourceDrag.row.node.id);

  if (isDocumentTopLevelSource && isSameDocument && !sourceDrag.isCopyDrag) {
    return plan;
  }

  const expandedPlan = targetParentRow.view.expanded
    ? plan
    : planExpandNode(plan, targetParentRow.view, targetParentRow.viewPath);

  const toReferenceTarget = (sourceRow: Row): AddToParentTarget =>
    createRefTarget(sourceRow.node.id, nodeText(sourceRow.node));

  return independentRows.reduce((accPlan: Plan, sourceRow, idx) => {
    const sourceNode = sourceRow.node;
    const sourceEdgeRelevance = sourceNode.relevance;
    const sourceEdgeArgument = sourceNode.argument;
    const insertAt = dropIndex + idx;
    const isPrimarySource = sourceRow.viewKey === source;
    const targetNode = getCurrentPlanNode(accPlan, targetParentNode);
    const planWithSource =
      targetSourceId === LOCAL
        ? planRecordForeignSource(accPlan, sourcePane, sourceRow, targetNode)
        : accPlan;
    const insertTarget =
      sourceRow.materialize?.take ??
      (isPrimarySource ? sourceDrag.insertTarget : undefined);
    const dragTargetID = isPrimarySource ? sourceDrag.nodeId : undefined;
    if (insertTarget) {
      return planAddToParent(
        planWithSource,
        addFallbackLinkText(insertTarget, sourceDrag.text),
        targetNode.id,
        insertAt,
        sourceEdgeRelevance,
        sourceEdgeArgument
      )[0];
    }
    if (dragTargetID) {
      return planAddToParent(
        planWithSource,
        createRefTarget(dragTargetID, nodeText(sourceNode)),
        targetNode.id,
        insertAt,
        sourceEdgeRelevance,
        sourceEdgeArgument
      )[0];
    }
    return planAddToParent(
      planWithSource,
      toReferenceTarget(sourceRow),
      targetNode.id,
      insertAt,
      sourceEdgeRelevance,
      sourceEdgeArgument
    )[0];
  }, expandedPlan);
}

function CustomDragLayer(): JSX.Element | null {
  const { isDragging, item, currentOffset } = useDragLayer((monitor) => ({
    isDragging: monitor.isDragging(),
    item: monitor.getItem() as { text?: string } | null,
    currentOffset: monitor.getClientOffset() as XYCoord | null,
  }));

  if (!isDragging || !item?.text || !currentOffset) {
    return null;
  }

  const x = currentOffset.x || 0;
  const y = currentOffset.y || 0;

  return (
    <div
      style={{
        position: "fixed",
        pointerEvents: "none",
        zIndex: 1000,
        left: x + 12,
        top: y - 8,
        opacity: 0.6,
        fontSize: "14px",
        maxWidth: "200px",
      }}
    >
      {item.text}
    </div>
  );
}

export function DND({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <DndProvider backend={HTML5Backend}>
      <CustomDragLayer />
      {children}
    </DndProvider>
  );
}
