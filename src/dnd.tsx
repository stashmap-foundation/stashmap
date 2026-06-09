import React from "react";
import { List } from "immutable";
import { DndProvider, useDragLayer, XYCoord } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import {
  moveNodes,
  createRefTarget,
  getNode,
  getNodeContext,
  getSemanticID,
  isRefNode,
  resolveNode,
} from "./core/connections";
import {
  getBlockLinkTarget,
  getBlockLinkText,
  isBlockLinkAny,
} from "./core/nodeSpans";
import {
  getIndependentRows,
  updateViewPathsAfterMoveNodes,
} from "./ViewContext";
import { getDocumentByIdOrFilePath } from "./core/Document";
import {
  Plan,
  planUpdateViews,
  planDeepCopyNode,
  planExpandNode,
  planAddToParent,
  planUpsertNodes,
  AddToParentTarget,
} from "./planner";
import { planMoveNode } from "./treeMutations";

type DragSource = {
  row: Row;
  draggedRows: Row[];
  sourcePaneIndex: number;
  text?: string;
  isSuggestion?: boolean;
  isCopyDrag?: boolean;
  virtualType: Row["virtualType"];
  nodeId?: LongID;
  targetId?: LongID;
  linkText?: string;
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
  return getNode(plan.knowledgeDBs, node.id, plan.user.publicKey) ?? node;
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

function getInsertAfterRow(
  rows: List<Row>,
  row: Row
): { parentRow: Row; insertAtIndex: number } | undefined {
  if (!row.parentRef) {
    return {
      parentRow: row,
      insertAtIndex: row.node.children.size || 0,
    };
  }
  if (row.childIndex === undefined) {
    return undefined;
  }
  const parentRow = getVisibleParentRow(rows, row);
  return parentRow
    ? {
        parentRow,
        insertAtIndex: row.childIndex + 1,
      }
    : undefined;
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
): { parentRow: Row; insertAtIndex: number } | undefined {
  const parentRow = getVisibleParentRow(rows, dropBefore);
  if (!parentRow) {
    return getDropDestinationEndOfVisibleRoot(rows);
  }
  return {
    parentRow,
    insertAtIndex: dropBefore.childIndex ?? parentRow.node.children.size,
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
): { parentRow: Row; insertAtIndex: number } | undefined {
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

function resolveDeepCopySource(
  plan: Plan,
  row: Row
): { itemID: ID; semanticContext: Context; node: GraphNode } {
  if (isRefNode(row.node)) {
    const resolved = resolveNode(plan.knowledgeDBs, row.node);
    if (resolved) {
      return {
        itemID: getSemanticID(plan.knowledgeDBs, resolved),
        semanticContext: getNodeContext(plan.knowledgeDBs, resolved),
        node: resolved,
      };
    }
  }
  return {
    itemID: row.rowID,
    semanticContext: getNodeContext(plan.knowledgeDBs, row.node),
    node: row.node,
  };
}

export function dnd(
  plan: Plan,
  sourceDrag: DragSource,
  targetPaneIndex: number,
  targetParentRow: Row,
  dropIndex: number,
  invertCopyMode: boolean
): Plan {
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
  const isSamePane = sourcePane.id === targetPane.id;
  const sourceDocument = sourcePane.documentId
    ? getDocumentByIdOrFilePath(
        plan.documents,
        plan.documentByFilePath,
        sourcePane.author,
        sourcePane.documentId
      )
    : undefined;
  const sourceDocumentNode = sourceDrag.row.node;
  const isDocumentTopLevelSource =
    sourceDocument !== undefined &&
    sourceDocument.author === sourceDocumentNode.author &&
    sourceDocument.topNodeShortIds.includes(sourceDocumentNode.id);

  if (
    isDocumentTopLevelSource &&
    isSamePane &&
    !invertCopyMode &&
    !sourceDrag.isCopyDrag
  ) {
    return plan;
  }

  const sourceParentRef = sourceDrag.row.parentRef;
  const allSourcesSameParent =
    sourceParentRef !== undefined &&
    independentRows.every((row) => refsEqual(row.parentRef, sourceParentRef));
  const sameNode =
    allSourcesSameParent && refsEqual(sourceParentRef, targetParentRow.ref);

  const skipMoveLogic = sourceDrag.isSuggestion || sourceDrag.isCopyDrag;
  const reorder = isSamePane && !skipMoveLogic && sameNode;

  const addProjectedSourceAsReference = (
    accPlan: Plan,
    sourceRow: Row,
    insertAt: number
  ): Plan => {
    return planAddToParent(
      accPlan,
      createRefTarget(
        getBlockLinkTarget(sourceRow.node) || sourceRow.rowID,
        getBlockLinkText(sourceRow.node)
      ),
      getCurrentPlanNode(accPlan, targetParentRow.node),
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
    const targetNode = getCurrentPlanNode(plan, targetParentRow.node);
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

  const samePaneMove =
    isSamePane && !skipMoveLogic && !invertCopyMode && !sameNode;

  if (samePaneMove) {
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
        sourceRow.node,
        sourceRow.rowID,
        sourceRow.node.id,
        getCurrentPlanNode(accPlan, sourceRow.parentNode),
        sourceRow.viewPath,
        getCurrentPlanNode(accPlan, targetParentRow.node),
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

  const shouldCreateReference = (sourceNode: GraphNode): boolean => {
    if (sourceDrag.isSuggestion) {
      return invertCopyMode;
    }
    if (sourceDrag.isCopyDrag) {
      return true;
    }
    const sourceIsReference = isBlockLinkAny(sourceNode);
    if (sourceIsReference) {
      return true;
    }
    return invertCopyMode;
  };

  const toReferenceTarget = (
    sourceNode: GraphNode
  ): ReturnType<typeof createRefTarget> =>
    createRefTarget(
      getBlockLinkTarget(sourceNode) || sourceNode.id,
      getBlockLinkText(sourceNode)
    );

  const getSuggestionTargetID = (
    isPrimarySource: boolean,
    sourceNode: GraphNode
  ): LongID | undefined => {
    if (isPrimarySource) {
      return sourceDrag.targetId || sourceDrag.nodeId;
    }
    return getBlockLinkTarget(sourceNode) || sourceNode.id;
  };

  return independentRows.reduce((accPlan: Plan, sourceRow, idx) => {
    const sourceNode = sourceRow.node;
    const sourceEdgeRelevance = sourceNode.relevance;
    const sourceEdgeArgument = sourceNode.argument;
    const insertAt = dropIndex + idx;
    const isPrimarySource = sourceRow.viewKey === source;
    const targetNode = getCurrentPlanNode(accPlan, targetParentRow.node);
    if (shouldCreateReference(sourceNode)) {
      if (sourceDrag.isSuggestion) {
        const insertTarget = isPrimarySource
          ? sourceDrag.insertTarget
          : undefined;
        if (insertTarget) {
          return planAddToParent(
            accPlan,
            addFallbackLinkText(insertTarget, sourceDrag.text),
            targetNode,
            insertAt,
            sourceEdgeRelevance,
            sourceEdgeArgument
          )[0];
        }
        const sourceTargetID = getSuggestionTargetID(
          isPrimarySource,
          sourceNode
        );
        if (sourceTargetID) {
          return planAddToParent(
            accPlan,
            createRefTarget(sourceTargetID, sourceDrag.text),
            targetNode,
            insertAt
          )[0];
        }
      }
      const insertTarget = isPrimarySource
        ? sourceDrag.insertTarget
        : undefined;
      const dragTargetID = isPrimarySource
        ? sourceDrag.targetId || sourceDrag.nodeId
        : undefined;
      if (insertTarget) {
        return planAddToParent(
          accPlan,
          addFallbackLinkText(insertTarget, sourceDrag.text),
          targetNode,
          insertAt,
          sourceEdgeRelevance,
          sourceEdgeArgument
        )[0];
      }
      if (dragTargetID) {
        return planAddToParent(
          accPlan,
          createRefTarget(dragTargetID, sourceDrag.linkText ?? sourceDrag.text),
          targetNode,
          insertAt,
          sourceEdgeRelevance,
          sourceEdgeArgument
        )[0];
      }
      return planAddToParent(
        accPlan,
        toReferenceTarget(sourceNode),
        targetNode,
        insertAt,
        sourceEdgeRelevance,
        sourceEdgeArgument
      )[0];
    }

    const deepCopySource = resolveDeepCopySource(accPlan, sourceRow);
    return planDeepCopyNode(
      accPlan,
      deepCopySource.itemID,
      deepCopySource.semanticContext,
      deepCopySource.node,
      targetNode,
      sourceRow.viewPath,
      targetParentRow.viewPath,
      insertAt
    );
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
