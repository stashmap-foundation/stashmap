import React from "react";
import { List, OrderedSet, Set } from "immutable";
import { DndProvider, useDragLayer, XYCoord } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { moveNodes, createRefTarget, isRefNode } from "./connections";
import {
  parseRowPath,
  RowPath,
  getParentRowPath,
  getPaneIndex,
  rowPathToString,
} from "./rows/rowPaths";
import {
  getNodeIndexForView,
  getRowIDFromView,
  getNodeForView,
  getCurrentEdgeForView,
} from "./rows/resolveRow";
import { upsertNodes } from "./app/actions";
import {
  getParentKey,
  planExpandNode,
  planUpdateViews,
  updateRowPathsAfterMoveNodes,
} from "./session/views";
import { getNodesInTree } from "./components/Node";
import {
  Plan,
  planDeepCopyNodeWithView,
  planAddToParent,
  getPane,
} from "./planner";
import { planMoveNodeWithView } from "./treeMutations";

type DragSource = {
  path: RowPath;
  nodeId?: LongID;
  targetId?: LongID;
};

function getDropDestinationEndOfRoot(
  data: Data,
  root: RowPath,
  stack: ID[]
): [RowPath, number] {
  const nodes = getNodeForView(data, root, stack);
  return [root, nodes?.children.size || 0];
}

function getInsertAfterNode(
  data: Data,
  node: RowPath
): [RowPath, number] | undefined {
  const parentView = getParentRowPath(node);
  if (!parentView) {
    return undefined;
  }
  const index = getNodeIndexForView(data, node);
  if (index === undefined) {
    return undefined;
  }
  return [parentView, index + 1];
}

function getAncestorAtDepth(path: RowPath, depth: number): RowPath | undefined {
  if (path.length - 1 <= depth) {
    return path;
  }
  const parent = getParentRowPath(path);
  if (!parent) {
    return undefined;
  }
  return getAncestorAtDepth(parent, depth);
}

function resolveDropByDepth(
  data: Data,
  root: RowPath,
  stack: ID[],
  prevNode: RowPath | undefined,
  dropBefore: RowPath | undefined,
  targetDepth: number
): [RowPath, number] {
  const rootDepth = root.length - 1;
  const maxDepth = prevNode ? prevNode.length - 1 + 1 : rootDepth + 1;
  const minDepth = dropBefore ? dropBefore.length - 1 : rootDepth + 1;
  const clampedDepth = Math.max(minDepth, Math.min(maxDepth, targetDepth));

  if (!prevNode) {
    if (!dropBefore) {
      return getDropDestinationEndOfRoot(data, root, stack);
    }
    const parentView = getParentRowPath(dropBefore);
    if (!parentView) {
      return getDropDestinationEndOfRoot(data, root, stack);
    }
    const idx = getNodeIndexForView(data, dropBefore);
    return [parentView, idx || 0];
  }

  const prevDepth = prevNode.length - 1;
  if (clampedDepth === prevDepth + 1) {
    if (dropBefore && dropBefore.length - 1 === clampedDepth) {
      const idx = getNodeIndexForView(data, dropBefore);
      return [prevNode, idx ?? 0];
    }
    const node = getNodeForView(data, prevNode, stack);
    return [prevNode, node?.children.size || 0];
  }

  const ancestor = getAncestorAtDepth(prevNode, clampedDepth);
  if (ancestor) {
    const afterAncestor = getInsertAfterNode(data, ancestor);
    if (afterAncestor) {
      return afterAncestor;
    }
  }

  return getDropDestinationEndOfRoot(data, root, stack);
}

function findNextNonSource(
  nodes: List<RowPath>,
  startIndex: number,
  sourceKeys: Set<string>,
  skipDepth?: number
): RowPath | undefined {
  const node = nodes.get(startIndex);
  if (!node) {
    return undefined;
  }
  const depth = node.length - 1;
  if (skipDepth !== undefined && depth > skipDepth) {
    return findNextNonSource(nodes, startIndex + 1, sourceKeys, skipDepth);
  }
  if (sourceKeys.has(rowPathToString(node))) {
    return findNextNonSource(nodes, startIndex + 1, sourceKeys, depth);
  }
  return node;
}

export function getDropDestinationFromTreeView(
  data: Data,
  root: RowPath,
  stack: ID[],
  destinationIndex: number,
  rootNode: LongID | undefined,
  targetDepth?: number,
  sourceKeys?: Set<string>
): [RowPath, number] {
  const pane = getPane(data, root);
  const { paths: nodes } = getNodesInTree(
    data,
    root,
    stack,
    List<RowPath>(),
    rootNode,
    pane.author,
    pane.typeFilters
  );
  const adjustedIndex = destinationIndex - 1;
  const dropBefore = nodes.get(adjustedIndex);
  const prevNode = adjustedIndex > 0 ? nodes.get(adjustedIndex - 1) : undefined;

  if (targetDepth !== undefined) {
    const realDropBefore = sourceKeys
      ? findNextNonSource(nodes, adjustedIndex, sourceKeys)
      : dropBefore;
    return resolveDropByDepth(
      data,
      root,
      stack,
      prevNode,
      realDropBefore,
      targetDepth
    );
  }

  if (!dropBefore) {
    const lastNode = nodes.last();
    if (lastNode) {
      const afterLast = getInsertAfterNode(data, lastNode);
      if (afterLast) {
        return afterLast;
      }
    }
    return getDropDestinationEndOfRoot(data, root, stack);
  }
  if (prevNode && prevNode.length > dropBefore.length) {
    const afterPrev = getInsertAfterNode(data, prevNode);
    if (afterPrev) {
      return afterPrev;
    }
  }
  const parentView = getParentRowPath(dropBefore);
  if (!parentView) {
    return getDropDestinationEndOfRoot(data, root, stack);
  }
  const index = getNodeIndexForView(data, dropBefore);
  return [parentView, index || 0];
}

export function dnd(
  plan: Plan,
  selection: OrderedSet<string>,
  sourceDrag: DragSource,
  to: RowPath,
  stack: ID[],
  indexTo: number | undefined,
  rootNode: LongID | undefined,
  isSuggestion?: boolean,
  invertCopyMode?: boolean,
  targetDepth?: number,
  isCopyDrag?: boolean
): Plan {
  const rootView = to;

  const source = rowPathToString(sourceDrag.path);
  const sourceRowPath = sourceDrag.path;
  const sources = selection.contains(source) ? selection : OrderedSet([source]);

  const independentSources = sources.filterNot((s) =>
    sources.some((other) => s !== other && s.startsWith(`${other}:`))
  );

  const sourceParentPath = getParentRowPath(sourceRowPath);
  const sourceKeys = Set(sources.map((s) => s));
  const [toView, dropIndex] =
    indexTo === undefined
      ? [rootView, undefined]
      : getDropDestinationFromTreeView(
          plan,
          rootView,
          stack,
          indexTo,
          rootNode,
          targetDepth,
          sourceKeys
        );

  const fromNode = sourceParentPath
    ? getNodeForView(plan, sourceParentPath, stack)
    : undefined;
  const toNode = getNodeForView(plan, toView, stack);

  const sourcePaneIndex = getPaneIndex(sourceRowPath);
  const targetPaneIndex = getPaneIndex(rootView);
  const isSamePane = sourcePaneIndex === targetPaneIndex;

  const sourceParentKey = getParentKey(source);
  const allSourcesSameParent =
    !selection.contains(source) ||
    independentSources.every((s) => getParentKey(s) === sourceParentKey);
  const sameNode =
    allSourcesSameParent &&
    fromNode !== undefined &&
    toNode !== undefined &&
    fromNode.id === toNode.id;

  const skipMoveLogic = isSuggestion || isCopyDrag;
  const reorder =
    isSamePane && !skipMoveLogic && sameNode && dropIndex !== undefined;

  const addProjectedSourceAsReference = (
    accPlan: Plan,
    sourcePath: RowPath,
    insertAt: number
  ): Plan => {
    const [sourceItemID] = getRowIDFromView(accPlan, sourcePath);
    const sourceStack = getPane(accPlan, sourcePath).stack;
    const sourceNode = getNodeForView(accPlan, sourcePath, sourceStack);
    return planAddToParent(
      accPlan,
      createRefTarget(
        sourceNode?.id || (sourceItemID as LongID),
        sourceNode?.linkText
      ),
      toView,
      stack,
      insertAt
    )[0];
  };

  if (reorder) {
    const realSources = independentSources.filter(
      (n) => getNodeIndexForView(plan, parseRowPath(n)) !== undefined
    );
    const virtualSources = independentSources.filter(
      (n) => getNodeIndexForView(plan, parseRowPath(n)) === undefined
    );
    const sourceIndices = List(
      realSources.map((n) => getNodeIndexForView(plan, parseRowPath(n)))
    ).filter((n) => n !== undefined) as List<number>;
    const updatedNodesPlan = upsertNodes(
      plan,
      toView,
      stack,
      (nodes: GraphNode) => {
        return moveNodes(nodes, sourceIndices.toArray(), dropIndex);
      }
    );
    const updatedViews = updateRowPathsAfterMoveNodes(updatedNodesPlan);
    const reorderedPlan = planUpdateViews(updatedNodesPlan, updatedViews);
    return virtualSources
      .toList()
      .reduce((accPlan: Plan, s: string, idx: number) => {
        const sourcePath = parseRowPath(s);
        const insertAt = dropIndex + sourceIndices.size + idx;
        return addProjectedSourceAsReference(accPlan, sourcePath, insertAt);
      }, reorderedPlan);
  }

  const samePaneMove =
    isSamePane &&
    !skipMoveLogic &&
    !invertCopyMode &&
    !sameNode &&
    dropIndex !== undefined;

  if (samePaneMove) {
    const toViewStr = rowPathToString(toView);
    const isDropIntoOwnDescendant = independentSources.some(
      (s) => toViewStr === s || toViewStr.startsWith(`${s}:`)
    );
    if (isDropIntoOwnDescendant) {
      return plan;
    }
    const realSources = independentSources.filter(
      (n) => getNodeIndexForView(plan, parseRowPath(n)) !== undefined
    );
    const virtualSources = independentSources.filter(
      (n) => getNodeIndexForView(plan, parseRowPath(n)) === undefined
    );
    const movedPlan = realSources
      .toList()
      .reduce((accPlan: Plan, s: string, idx: number) => {
        const sourcePath = parseRowPath(s);
        const insertAt = dropIndex + idx;
        return planMoveNodeWithView(
          accPlan,
          sourcePath,
          toView,
          stack,
          insertAt
        );
      }, plan);
    return virtualSources
      .toList()
      .reduce((accPlan: Plan, s: string, idx: number) => {
        const sourcePath = parseRowPath(s);
        const insertAt = dropIndex + realSources.size + idx;
        return addProjectedSourceAsReference(accPlan, sourcePath, insertAt);
      }, movedPlan);
  }

  const [, toViewData] = getRowIDFromView(plan, toView);

  const expandedPlan = toViewData.expanded
    ? plan
    : planExpandNode(plan, toViewData, toView);

  const shouldCreateReference = (
    sourceItemID: ID,
    sourceNode?: GraphNode
  ): boolean => {
    if (isSuggestion) {
      return !!invertCopyMode;
    }
    if (isCopyDrag) {
      return true;
    }
    const sourceIsReference = isRefNode(sourceNode);
    if (sourceIsReference) {
      return true;
    }
    return !!invertCopyMode;
  };

  const toReferenceTarget = (
    sourceNode: GraphNode
  ): ReturnType<typeof createRefTarget> =>
    createRefTarget(sourceNode.targetID || sourceNode.id, sourceNode.linkText);

  const getSuggestionTargetID = (
    isPrimarySource: boolean,
    sourceNode?: GraphNode
  ): LongID | undefined => {
    if (isPrimarySource) {
      return sourceDrag.targetId || sourceDrag.nodeId;
    }
    if (sourceNode) {
      return sourceNode.targetID || sourceNode.id;
    }
    return undefined;
  };

  return independentSources
    .toList()
    .reduce((accPlan: Plan, s: string, idx: number) => {
      const sourcePath = parseRowPath(s);
      const [sourceItemID] = getRowIDFromView(accPlan, sourcePath);
      const sourceStack = getPane(accPlan, sourcePath).stack;
      const sourceEdge = getCurrentEdgeForView(accPlan, sourcePath);
      const sourceEdgeRelevance = sourceEdge?.relevance;
      const sourceEdgeArgument = sourceEdge?.argument;
      const sourceNode =
        getNodeForView(accPlan, sourcePath, sourceStack) || sourceEdge;
      const insertAt = dropIndex !== undefined ? dropIndex + idx : undefined;

      if (shouldCreateReference(sourceItemID, sourceNode)) {
        if (isSuggestion) {
          const sourceTargetID = getSuggestionTargetID(
            s === source,
            sourceNode
          );
          if (sourceTargetID) {
            return planAddToParent(
              accPlan,
              createRefTarget(sourceTargetID),
              toView,
              stack,
              insertAt
            )[0];
          }
        }
        if (sourceNode) {
          return planAddToParent(
            accPlan,
            toReferenceTarget(sourceNode),
            toView,
            stack,
            insertAt,
            sourceEdgeRelevance,
            sourceEdgeArgument
          )[0];
        }
        const planWithNode = upsertNodes(
          accPlan,
          sourcePath,
          sourceStack,
          (r) => r
        );
        const sourceNodeWithUpsert = getNodeForView(
          planWithNode,
          sourcePath,
          sourceStack
        )!;
        return planAddToParent(
          planWithNode,
          toReferenceTarget(sourceNodeWithUpsert),
          toView,
          stack,
          insertAt,
          sourceEdgeRelevance,
          sourceEdgeArgument
        )[0];
      }

      return planDeepCopyNodeWithView(
        accPlan,
        sourcePath,
        toView,
        stack,
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
