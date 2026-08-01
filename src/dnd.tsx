import React from "react";
import { List } from "immutable";
import { DndProvider, useDragLayer, XYCoord } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { LOCAL } from "./core/nodeRef";
import { moveNodes, createRefTarget, getNode } from "./core/connections";
import { nodeText } from "./core/nodeSpans";
import { calendarEntryTarget } from "./core/ical";
import { getIndependentRows, updateViewPathsAfterMoveNodes } from "./rowModel";
import { getDocumentForNode } from "./core/Document";
import {
  Plan,
  planUpdateViews,
  planExpandNode,
  planAddToParent,
  planUpsertNodes,
  AddToParentTarget,
} from "./planner";
import { planMoveNode } from "./treeMutations";
import { planMaterializeComputedRow } from "./core/plan";

type DragSource = {
  row: Row;
  draggedRows: Row[];
  sourcePaneIndex: number;
  text?: string;
  isCopyDrag?: boolean;
  nodeId?: ID;
  targetId?: ID;
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

export function dnd(
  basePlan: Plan,
  sourceDrag: DragSource,
  targetPaneIndex: number,
  targetParentRow: Row,
  dropIndex: number
): Plan {
  const [plan, targetParentNode] = planMaterializeComputedRow(
    basePlan,
    targetParentRow
  );
  const source = sourceDrag.row.viewKey;
  const sources = sourceDrag.draggedRows.length
    ? sourceDrag.draggedRows
    : [sourceDrag.row];
  const independentRows = getIndependentRows(sources);

  const sourcePane = plan.panes[sourceDrag.sourcePaneIndex];
  const targetPane = plan.panes[targetPaneIndex];
  if (!sourcePane || !targetPane) {
    return plan;
  }
  const sourceDocumentNode = sourceDrag.row.node;
  const sourceDocument = getDocumentForNode(
    plan.knowledgeDBs,
    plan.documents,
    sourceDocumentNode,
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
    sourceDocument.topNodeShortIds.includes(sourceDocumentNode.id);

  if (isDocumentTopLevelSource && isSameDocument && !sourceDrag.isCopyDrag) {
    return plan;
  }

  const sourceParentRef = sourceDrag.row.parentRef;
  const allSourcesSameParent =
    sourceParentRef !== undefined &&
    independentRows.every((row) => refsEqual(row.parentRef, sourceParentRef));
  const targetParentRef = { sourceId: targetSourceId, id: targetParentNode.id };
  const sameNode =
    allSourcesSameParent && refsEqual(sourceParentRef, targetParentRef);

  const skipMoveLogic = sourceDrag.isCopyDrag;
  const reorder = isSameDocument && !skipMoveLogic && sameNode;

  const addProjectedSourceAsReference = (
    accPlan: Plan,
    sourceRow: Row,
    insertAt: number
  ): Plan => {
    // A computed row with a materialization recipe drags as itself: it
    // materializes at the drop position (mint-or-link decides whether
    // that means the node or a link row to its home elsewhere). Already
    // materialized (a projection-reorder pre-step ran): ordinary move.
    if (sourceRow.materialize) {
      const [materializedPlan, materializedNode, materializedNow] =
        planMaterializeComputedRow(accPlan, sourceRow, undefined, {
          parentID: targetParentNode.id,
          insertIndex: insertAt,
        });
      if (materializedNow || !sourceRow.parentRef) {
        return materializedPlan;
      }
      // Same-parent: an in-place reorder (planMoveNode is add-then-
      // disconnect and not same-parent-safe). Cross-parent: a move.
      if (sourceRow.parentRef.id === targetParentNode.id) {
        const parentNode = getCurrentPlanNode(
          materializedPlan,
          targetParentNode
        );
        const fromIndex = parentNode.children.indexOf(materializedNode.id);
        if (fromIndex < 0) {
          return materializedPlan;
        }
        const reordered = planUpsertNodes(
          materializedPlan,
          moveNodes(parentNode, [fromIndex], insertAt)
        );
        return planUpdateViews(
          reordered,
          updateViewPathsAfterMoveNodes(reordered)
        );
      }
      return planMoveNode(
        materializedPlan,
        materializedNode.id,
        materializedNode.id,
        sourceRow.parentRef.id,
        sourceRow.viewPath,
        targetParentNode.id,
        targetParentRow.viewPath,
        insertAt
      );
    }
    return planAddToParent(
      accPlan,
      createRefTarget(
        calendarEntryTarget(sourceRow.node) ?? sourceRow.node.id,
        nodeText(sourceRow.node)
      ),
      targetParentNode.id,
      insertAt
    )[0];
  };

  if (reorder) {
    const realRows = independentRows.filter(
      (row) => row.childIndex !== undefined
    );
    const virtualRows = independentRows.filter(
      (row) => row.childIndex === undefined
    );
    const sourceIndices = realRows.flatMap((row) =>
      row.childIndex === undefined ? [] : [row.childIndex]
    );
    const targetNode = getCurrentPlanNode(plan, targetParentNode);
    const updatedNodesPlan = planUpsertNodes(
      plan,
      moveNodes(targetNode, sourceIndices, dropIndex)
    );
    const updatedViews = updateViewPathsAfterMoveNodes(updatedNodesPlan);
    const reorderedPlan = planUpdateViews(updatedNodesPlan, updatedViews);
    return virtualRows.reduce((accPlan: Plan, sourceRow, idx) => {
      const insertAt = dropIndex + sourceIndices.length + idx;
      return addProjectedSourceAsReference(accPlan, sourceRow, insertAt);
    }, reorderedPlan);
  }

  const sameDocumentMove = isSameDocument && !skipMoveLogic && !sameNode;

  if (sameDocumentMove) {
    const isDropIntoOwnDescendant = independentRows.some(
      (row) =>
        targetParentRow.viewKey === row.viewKey ||
        targetParentRow.viewKey.startsWith(`${row.viewKey}:`)
    );
    if (isDropIntoOwnDescendant) {
      return plan;
    }
    const realRows = independentRows.filter(
      (row) => row.childIndex !== undefined
    );
    const virtualRows = independentRows.filter(
      (row) => row.childIndex === undefined
    );
    const moveBasePlan = targetParentRow.view.expanded
      ? plan
      : planExpandNode(plan, targetParentRow.view, targetParentRow.viewPath);
    const movedPlan = realRows.reduce((accPlan: Plan, sourceRow, idx) => {
      if (!sourceRow.parentNode) {
        return accPlan;
      }
      const insertAt = dropIndex + idx;
      return planMoveNode(
        accPlan,
        sourceRow.node.id,
        sourceRow.node.id,
        sourceRow.parentNode.id,
        sourceRow.viewPath,
        targetParentNode.id,
        targetParentRow.viewPath,
        insertAt
      );
    }, moveBasePlan);
    return virtualRows.reduce((accPlan: Plan, sourceRow, idx) => {
      const insertAt = dropIndex + realRows.length + idx;
      return addProjectedSourceAsReference(accPlan, sourceRow, insertAt);
    }, movedPlan);
  }

  const expandedPlan = targetParentRow.view.expanded
    ? plan
    : planExpandNode(plan, targetParentRow.view, targetParentRow.viewPath);

  const toReferenceTarget = (sourceRow: Row): AddToParentTarget =>
    createRefTarget(
      calendarEntryTarget(sourceRow.node) ?? sourceRow.node.id,
      nodeText(sourceRow.node)
    );

  return independentRows.reduce((accPlan: Plan, sourceRow, idx) => {
    const sourceNode = sourceRow.node;
    const sourceEdgeRelevance = sourceNode.relevance;
    const sourceEdgeArgument = sourceNode.argument;
    const insertAt = dropIndex + idx;
    const isPrimarySource = sourceRow.viewKey === source;
    const targetNode = getCurrentPlanNode(accPlan, targetParentNode);
    const insertTarget =
      sourceRow.materialize?.take ??
      (isPrimarySource ? sourceDrag.insertTarget : undefined);
    const dragTargetID = isPrimarySource
      ? sourceDrag.targetId || sourceDrag.nodeId
      : undefined;
    if (insertTarget) {
      return planAddToParent(
        accPlan,
        addFallbackLinkText(insertTarget, sourceDrag.text),
        targetNode.id,
        insertAt,
        sourceEdgeRelevance,
        sourceEdgeArgument
      )[0];
    }
    if (dragTargetID) {
      return planAddToParent(
        accPlan,
        createRefTarget(dragTargetID, nodeText(sourceNode)),
        targetNode.id,
        insertAt,
        sourceEdgeRelevance,
        sourceEdgeArgument
      )[0];
    }
    return planAddToParent(
      accPlan,
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
