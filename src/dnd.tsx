import React from "react";
import { List, OrderedSet, Set } from "immutable";
import { DndProvider, useDragLayer, XYCoord } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { moveNodes, createRefTarget, shortID } from "./core/connections";
import {
  getBlockLinkTarget,
  getBlockLinkText,
  isBlockLinkAny,
} from "./core/nodeSpans";
import {
  parseViewPath,
  upsertNodes,
  getParentKey,
  ViewPath,
  getParentView,
  updateViewPathsAfterMoveNodes,
  getNodeIndexForView,
  getRowIDFromView,
  getNodeForView,
  viewPathToString,
  getCurrentEdgeForView,
  isRoot,
} from "./ViewContext";
import { getDocumentByIdOrFilePath } from "./core/Document";
import { getNodesInDocument, getNodesInTree } from "./treeTraversal";
import {
  Plan,
  planUpdateViews,
  planDeepCopyNodeWithView,
  planExpandNode,
  planAddToParent,
  getPane,
  AddToParentTarget,
} from "./planner";
import { planMoveNodeWithView } from "./treeMutations";
import { projectDocumentByFilePath } from "./core/graphData";

type DragSource = {
  path: ViewPath;
  nodeId?: LongID;
  targetId?: LongID;
  linkText?: string;
  insertTarget?: AddToParentTarget;
};

function getDropDestinationEndOfRoot(
  data: Data,
  root: ViewPath
): [ViewPath, number] {
  const nodes = getNodeForView(data, root);
  return [root, nodes?.children.size || 0];
}

function getInsertAfterNode(
  data: Data,
  node: ViewPath
): [ViewPath, number] | undefined {
  const parentView = getParentView(node);
  if (!parentView) {
    return undefined;
  }
  const index = getNodeIndexForView(data, node);
  if (index === undefined) {
    return undefined;
  }
  return [parentView, index + 1];
}

function getAncestorAtDepth(
  path: ViewPath,
  depth: number
): ViewPath | undefined {
  if (path.length - 1 <= depth) {
    return path;
  }
  const parent = getParentView(path);
  if (!parent) {
    return undefined;
  }
  return getAncestorAtDepth(parent, depth);
}

function resolveDropByDepth(
  data: Data,
  root: ViewPath,
  prevNode: ViewPath | undefined,
  dropBefore: ViewPath | undefined,
  targetDepth: number
): [ViewPath, number] {
  const rootDepth = root.length - 1;
  const maxDepth = prevNode ? prevNode.length - 1 + 1 : rootDepth + 1;
  const minDepth = dropBefore ? dropBefore.length - 1 : rootDepth + 1;
  const clampedDepth = Math.max(minDepth, Math.min(maxDepth, targetDepth));

  if (!prevNode) {
    if (!dropBefore) {
      return getDropDestinationEndOfRoot(data, root);
    }
    if (clampedDepth === dropBefore.length) {
      return getDropDestinationEndOfRoot(data, dropBefore);
    }
    const parentView = getParentView(dropBefore);
    if (!parentView) {
      return getDropDestinationEndOfRoot(data, root);
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
    const node = getNodeForView(data, prevNode);
    return [prevNode, node?.children.size || 0];
  }

  const ancestor = getAncestorAtDepth(prevNode, clampedDepth);
  if (ancestor) {
    const afterAncestor = getInsertAfterNode(data, ancestor);
    if (afterAncestor) {
      return afterAncestor;
    }
  }

  return getDropDestinationEndOfRoot(data, root);
}

function findNextNonSource(
  nodes: List<ViewPath>,
  startIndex: number,
  sourceKeys: Set<string>,
  skipDepth?: number
): ViewPath | undefined {
  const node = nodes.get(startIndex);
  if (!node) {
    return undefined;
  }
  const depth = node.length - 1;
  if (skipDepth !== undefined && depth > skipDepth) {
    return findNextNonSource(nodes, startIndex + 1, sourceKeys, skipDepth);
  }
  if (sourceKeys.has(viewPathToString(node))) {
    return findNextNonSource(nodes, startIndex + 1, sourceKeys, depth);
  }
  return node;
}

export function getDropDestinationFromTreeView(
  data: Data,
  root: ViewPath,
  destinationIndex: number,
  rootNode: LongID | undefined,
  targetDepth?: number,
  sourceKeys?: Set<string>
): [ViewPath, number] {
  const pane = getPane(data, root);
  const document = pane.documentId
    ? getDocumentByIdOrFilePath(
        data.documents,
        projectDocumentByFilePath(data),
        pane.author,
        pane.documentId
      )
    : undefined;
  const { paths: nodes } = document
    ? getNodesInDocument(data, root, document, pane.typeFilters)
    : getNodesInTree(
        data,
        List<ViewPath>([root]),
        List<ViewPath>(),
        rootNode,
        pane.author,
        pane.typeFilters
      );
  const adjustedIndex = destinationIndex;
  const dropBefore = nodes.get(adjustedIndex);
  const prevNode = adjustedIndex > 0 ? nodes.get(adjustedIndex - 1) : undefined;

  if (targetDepth !== undefined) {
    const realDropBefore = sourceKeys
      ? findNextNonSource(nodes, adjustedIndex, sourceKeys)
      : dropBefore;
    return resolveDropByDepth(
      data,
      root,
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
    return getDropDestinationEndOfRoot(data, root);
  }
  if (prevNode && prevNode.length > dropBefore.length) {
    const afterPrev = getInsertAfterNode(data, prevNode);
    if (afterPrev) {
      return afterPrev;
    }
  }
  const parentView = getParentView(dropBefore);
  if (!parentView) {
    return getDropDestinationEndOfRoot(data, root);
  }
  const index = getNodeIndexForView(data, dropBefore);
  return [parentView, index || 0];
}

export function dnd(
  plan: Plan,
  selection: OrderedSet<string>,
  sourceDrag: DragSource,
  to: ViewPath,
  indexTo: number | undefined,
  rootNode: LongID | undefined,
  isSuggestion?: boolean,
  invertCopyMode?: boolean,
  targetDepth?: number,
  isCopyDrag?: boolean
): Plan {
  const rootView = to;

  const source = viewPathToString(sourceDrag.path);
  const sourceViewPath = sourceDrag.path;
  const sources = selection.contains(source) ? selection : OrderedSet([source]);

  const independentSources = sources.filterNot((s) =>
    sources.some((other) => s !== other && s.startsWith(`${other}:`))
  );

  const sourceParentPath = getParentView(sourceViewPath);
  const sourceKeys = Set(sources.map((s) => s));
  const [toView, dropIndex] =
    indexTo === undefined
      ? [rootView, undefined]
      : getDropDestinationFromTreeView(
          plan,
          rootView,
          indexTo,
          rootNode,
          targetDepth,
          sourceKeys
        );

  const fromNode = sourceParentPath
    ? getNodeForView(plan, sourceParentPath)
    : undefined;
  const toNode = getNodeForView(plan, toView);

  const sourcePane = getPane(plan, sourceViewPath);
  const targetPane = getPane(plan, rootView);
  const isSamePane = sourcePane.id === targetPane.id;
  const sourceDocument = sourcePane.documentId
    ? getDocumentByIdOrFilePath(
        plan.documents,
        projectDocumentByFilePath(plan),
        sourcePane.author,
        sourcePane.documentId
      )
    : undefined;
  const targetDocument = targetPane.documentId
    ? getDocumentByIdOrFilePath(
        plan.documents,
        projectDocumentByFilePath(plan),
        targetPane.author,
        targetPane.documentId
      )
    : undefined;
  const sourceDocumentNode = getNodeForView(plan, sourceViewPath);
  const isDocumentTopLevelSource =
    sourceDocument !== undefined &&
    isRoot(sourceViewPath) &&
    sourceDocumentNode !== undefined &&
    sourceDocument.author === sourceDocumentNode.author &&
    sourceDocument.topNodeShortIds.includes(shortID(sourceDocumentNode.id));
  const isDocumentRootDropTarget =
    targetDocument !== undefined && isRoot(toView) && !toNode;

  if (
    isDocumentRootDropTarget ||
    (isDocumentTopLevelSource && isSamePane && !invertCopyMode && !isCopyDrag)
  ) {
    return plan;
  }

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
    sourcePath: ViewPath,
    insertAt: number
  ): Plan => {
    const [sourceItemID] = getRowIDFromView(accPlan, sourcePath);
    const sourceNode = getNodeForView(accPlan, sourcePath);
    return planAddToParent(
      accPlan,
      createRefTarget(
        sourceNode?.id || (sourceItemID as LongID),
        getBlockLinkText(sourceNode)
      ),
      toView,
      insertAt
    )[0];
  };

  if (reorder) {
    const realSources = independentSources.filter(
      (n) => getNodeIndexForView(plan, parseViewPath(n)) !== undefined
    );
    const virtualSources = independentSources.filter(
      (n) => getNodeIndexForView(plan, parseViewPath(n)) === undefined
    );
    const sourceIndices = List(
      realSources.map((n) => getNodeIndexForView(plan, parseViewPath(n)))
    ).filter((n) => n !== undefined) as List<number>;
    const updatedNodesPlan = upsertNodes(plan, toView, (nodes: GraphNode) => {
      return moveNodes(nodes, sourceIndices.toArray(), dropIndex);
    });
    const updatedViews = updateViewPathsAfterMoveNodes(updatedNodesPlan);
    const reorderedPlan = planUpdateViews(updatedNodesPlan, updatedViews);
    return virtualSources
      .toList()
      .reduce((accPlan: Plan, s: string, idx: number) => {
        const sourcePath = parseViewPath(s);
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
    const toViewStr = viewPathToString(toView);
    const isDropIntoOwnDescendant = independentSources.some(
      (s) => toViewStr === s || toViewStr.startsWith(`${s}:`)
    );
    if (isDropIntoOwnDescendant) {
      return plan;
    }
    const realSources = independentSources.filter(
      (n) => getNodeIndexForView(plan, parseViewPath(n)) !== undefined
    );
    const virtualSources = independentSources.filter(
      (n) => getNodeIndexForView(plan, parseViewPath(n)) === undefined
    );
    const movedPlan = realSources
      .toList()
      .reduce((accPlan: Plan, s: string, idx: number) => {
        const sourcePath = parseViewPath(s);
        const insertAt = dropIndex + idx;
        return planMoveNodeWithView(accPlan, sourcePath, toView, insertAt);
      }, plan);
    return virtualSources
      .toList()
      .reduce((accPlan: Plan, s: string, idx: number) => {
        const sourcePath = parseViewPath(s);
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
    const sourceIsReference = isBlockLinkAny(sourceNode);
    if (sourceIsReference) {
      return true;
    }
    return !!invertCopyMode;
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
    sourceNode?: GraphNode
  ): LongID | undefined => {
    if (isPrimarySource) {
      return (
        sourceDrag.targetId ||
        sourceDrag.nodeId ||
        (sourceNode
          ? getBlockLinkTarget(sourceNode) || sourceNode.id
          : undefined)
      );
    }
    if (sourceNode) {
      return getBlockLinkTarget(sourceNode) || sourceNode.id;
    }
    return undefined;
  };

  return independentSources
    .toList()
    .reduce((accPlan: Plan, s: string, idx: number) => {
      const sourcePath = parseViewPath(s);
      const [sourceItemID] = getRowIDFromView(accPlan, sourcePath);
      const sourceEdge = getCurrentEdgeForView(accPlan, sourcePath);
      const sourceEdgeRelevance = sourceEdge?.relevance;
      const sourceEdgeArgument = sourceEdge?.argument;
      const sourceNode = getNodeForView(accPlan, sourcePath) || sourceEdge;
      const insertAt = dropIndex !== undefined ? dropIndex + idx : undefined;
      if (shouldCreateReference(sourceItemID, sourceNode)) {
        if (isSuggestion) {
          const insertTarget =
            s === source ? sourceDrag.insertTarget : undefined;
          if (insertTarget) {
            return planAddToParent(
              accPlan,
              insertTarget,
              toView,
              insertAt,
              sourceEdgeRelevance,
              sourceEdgeArgument
            )[0];
          }
          const sourceTargetID = getSuggestionTargetID(
            s === source,
            sourceNode
          );
          if (sourceTargetID) {
            return planAddToParent(
              accPlan,
              createRefTarget(sourceTargetID),
              toView,
              insertAt
            )[0];
          }
        }
        const insertTarget = s === source ? sourceDrag.insertTarget : undefined;
        const dragTargetID =
          s === source ? sourceDrag.targetId || sourceDrag.nodeId : undefined;
        if (insertTarget) {
          return planAddToParent(
            accPlan,
            insertTarget,
            toView,
            insertAt,
            sourceEdgeRelevance,
            sourceEdgeArgument
          )[0];
        }
        if (dragTargetID) {
          return planAddToParent(
            accPlan,
            createRefTarget(dragTargetID, sourceDrag.linkText),
            toView,
            insertAt,
            sourceEdgeRelevance,
            sourceEdgeArgument
          )[0];
        }
        if (sourceNode) {
          return planAddToParent(
            accPlan,
            toReferenceTarget(sourceNode),
            toView,
            insertAt,
            sourceEdgeRelevance,
            sourceEdgeArgument
          )[0];
        }
        const planWithNode = upsertNodes(accPlan, sourcePath, (r) => r);
        const sourceNodeWithUpsert = getNodeForView(planWithNode, sourcePath)!;
        return planAddToParent(
          planWithNode,
          toReferenceTarget(sourceNodeWithUpsert),
          toView,
          insertAt,
          sourceEdgeRelevance,
          sourceEdgeArgument
        )[0];
      }

      return planDeepCopyNodeWithView(accPlan, sourcePath, toView, insertAt);
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
