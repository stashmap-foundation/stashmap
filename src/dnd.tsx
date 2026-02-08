import React from "react";
import { List, OrderedSet, Set } from "immutable";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { getSelectedInView } from "./components/TemporaryViewContext";
import {
  moveRelations,
  deleteRelations,
  createAbstractRefId,
  isRefId,
  shortID,
  VERSIONS_NODE_ID,
} from "./connections";
import {
  parseViewPath,
  upsertRelations,
  getParentKey,
  ViewPath,
  getParentView,
  updateViewPathsAfterMoveRelations,
  updateViewPathsAfterDisconnect,
  getRelationIndex,
  getNodeIDFromView,
  getLast,
  getContext,
  getRelationForView,
  getPaneIndex,
  addNodeToPathWithRelations,
  viewPathToString,
  copyViewsWithNewPrefix,
} from "./ViewContext";
import { getNodesInTree } from "./components/Node";
import {
  Plan,
  planUpdateViews,
  planDeepCopyNodeWithView,
  planExpandNode,
  planAddToParent,
  planDeleteDescendantRelations,
  getPane,
} from "./planner";

function getDropDestinationEndOfRoot(
  data: Data,
  root: ViewPath,
  stack: ID[]
): [ViewPath, number] {
  const relations = getRelationForView(data, root, stack);
  return [root, relations?.items.size || 0];
}

function getInsertAfterNode(
  data: Data,
  node: ViewPath
): [ViewPath, number] | undefined {
  const parentView = getParentView(node);
  if (!parentView) {
    return undefined;
  }
  const index = getRelationIndex(data, node);
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
  stack: ID[],
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
      return getDropDestinationEndOfRoot(data, root, stack);
    }
    const parentView = getParentView(dropBefore);
    if (!parentView) {
      return getDropDestinationEndOfRoot(data, root, stack);
    }
    const idx = getRelationIndex(data, dropBefore);
    return [parentView, idx || 0];
  }

  const prevDepth = prevNode.length - 1;
  if (clampedDepth === prevDepth + 1) {
    if (dropBefore && dropBefore.length - 1 === clampedDepth) {
      const idx = getRelationIndex(data, dropBefore);
      return [prevNode, idx ?? 0];
    }
    const relation = getRelationForView(data, prevNode, stack);
    return [prevNode, relation?.items.size || 0];
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
  nodes: List<ViewPath>,
  startIndex: number,
  sourceKeys: Set<string>
): ViewPath | undefined {
  let skipDepth: number | undefined;
  for (let i = startIndex; i < nodes.size; i++) {
    const node = nodes.get(i);
    if (!node) {
      continue;
    }
    const depth = node.length - 1;
    if (skipDepth !== undefined && depth > skipDepth) {
      continue;
    }
    skipDepth = undefined;
    if (sourceKeys.has(viewPathToString(node))) {
      skipDepth = depth;
      continue;
    }
    return node;
  }
  return undefined;
}

export function getDropDestinationFromTreeView(
  data: Data,
  root: ViewPath,
  stack: ID[],
  destinationIndex: number,
  rootRelation: LongID | undefined,
  targetDepth?: number,
  sourceKeys?: Set<string>
): [ViewPath, number] {
  const nodes = getNodesInTree(
    data,
    root,
    stack,
    List<ViewPath>(),
    rootRelation
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
  const parentView = getParentView(dropBefore);
  if (!parentView) {
    return getDropDestinationEndOfRoot(data, root, stack);
  }
  const index = getRelationIndex(data, dropBefore);
  return [parentView, index || 0];
}

/**
 * Disconnect a node from its current parent.
 * Also cleans up orphaned descendant relations, unless the node is a
 * reference (refs don't own descendants) or ~Versions (version history
 * should survive temporary removal).
 */
export function planDisconnectFromParent(
  plan: Plan,
  viewPath: ViewPath,
  stack: ID[]
): Plan {
  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    return plan;
  }

  const relationIndex = getRelationIndex(plan, viewPath);
  if (relationIndex === undefined) {
    return plan;
  }

  const { nodeID, nodeIndex } = getLast(viewPath);
  const parentRelation = getRelationForView(plan, parentPath, stack);
  if (!parentRelation) {
    return plan;
  }

  const updatedRelationsPlan = upsertRelations(
    plan,
    parentPath,
    stack,
    (relations) => deleteRelations(relations, Set([relationIndex]))
  );

  const updatedViews = updateViewPathsAfterDisconnect(
    updatedRelationsPlan.views,
    nodeID,
    parentRelation.id,
    nodeIndex
  );

  const planWithViews = planUpdateViews(updatedRelationsPlan, updatedViews);

  const skipCleanup = isRefId(nodeID) || shortID(nodeID) === VERSIONS_NODE_ID;
  if (skipCleanup) {
    return planWithViews;
  }

  const context = getContext(plan, viewPath, stack);
  return planDeleteDescendantRelations(planWithViews, nodeID, context);
}

export function dnd(
  plan: Plan,
  selection: OrderedSet<string>,
  source: string,
  to: ViewPath,
  stack: ID[],
  indexTo: number | undefined,
  rootRelation: LongID | undefined,
  isSuggestion?: boolean,
  invertCopyMode?: boolean,
  targetDepth?: number
): Plan {
  const rootView = to;

  const sourceViewPath = parseViewPath(source);
  const selectedSources = getSelectedInView(selection, getParentKey(source));
  const sources = selection.contains(source) ? selectedSources : List([source]);

  const sourceParentPath = getParentView(sourceViewPath);
  const sourceKeys = Set(sources.map((s) => s));
  const [toView, dropIndex] =
    indexTo === undefined
      ? [rootView, undefined]
      : getDropDestinationFromTreeView(
          plan,
          rootView,
          stack,
          indexTo,
          rootRelation,
          targetDepth,
          sourceKeys
        );

  const fromRelation = sourceParentPath
    ? getRelationForView(plan, sourceParentPath, stack)
    : undefined;
  const toRelation = getRelationForView(plan, toView, stack);

  const sourcePaneIndex = getPaneIndex(sourceViewPath);
  const targetPaneIndex = getPaneIndex(rootView);
  const isSamePane = sourcePaneIndex === targetPaneIndex;

  const sameRelation =
    fromRelation !== undefined &&
    toRelation !== undefined &&
    fromRelation.id === toRelation.id;

  const reorder =
    isSamePane && !isSuggestion && sameRelation && dropIndex !== undefined;

  if (reorder) {
    const sourceIndices = List(
      sources.map((n) => getRelationIndex(plan, parseViewPath(n)))
    ).filter((n) => n !== undefined) as List<number>;
    const updatedRelationsPlan = upsertRelations(
      plan,
      toView,
      stack,
      (relations: Relations) => {
        return moveRelations(relations, sourceIndices.toArray(), dropIndex);
      }
    );
    const updatedViews = updateViewPathsAfterMoveRelations(
      updatedRelationsPlan,
      toRelation.id,
      toRelation.items,
      sourceIndices.toArray(),
      dropIndex
    );
    return planUpdateViews(updatedRelationsPlan, updatedViews);
  }

  const samePaneMove =
    isSamePane &&
    !isSuggestion &&
    !invertCopyMode &&
    !sameRelation &&
    dropIndex !== undefined;

  if (samePaneMove) {
    return sources.toList().reduce((accPlan: Plan, s: string, idx: number) => {
      const sourcePath = parseViewPath(s);
      const [sourceNodeID] = getNodeIDFromView(accPlan, sourcePath);
      const insertAt = dropIndex + idx;

      if (isRefId(sourceNodeID)) {
        const planWithAdd = planAddToParent(
          accPlan,
          sourceNodeID,
          toView,
          stack,
          insertAt
        );
        const relations = getRelationForView(planWithAdd, toView, stack);
        if (relations) {
          const targetIndex = insertAt ?? relations.items.size - 1;
          const targetViewPath = addNodeToPathWithRelations(
            toView,
            relations,
            targetIndex
          );
          const sourceKey = viewPathToString(sourcePath);
          const targetKey = viewPathToString(targetViewPath);
          const updatedViews = copyViewsWithNewPrefix(
            planWithAdd.views,
            sourceKey,
            targetKey
          );
          const planWithViews = planUpdateViews(planWithAdd, updatedViews);
          return planDisconnectFromParent(planWithViews, sourcePath, stack);
        }
        return planDisconnectFromParent(planWithAdd, sourcePath, stack);
      }

      const planWithCopy = planDeepCopyNodeWithView(
        accPlan,
        sourcePath,
        toView,
        stack,
        insertAt
      );
      return planDisconnectFromParent(planWithCopy, sourcePath, stack);
    }, plan);
  }

  const [, toViewData] = getNodeIDFromView(plan, toView);

  const expandedPlan = toViewData.expanded
    ? plan
    : planExpandNode(plan, toViewData, toView);

  const shouldCreateReference = (sourceNodeID: LongID | ID): boolean => {
    if (isSuggestion) {
      return !!invertCopyMode;
    }
    const sourceIsReference = isRefId(sourceNodeID);
    if (sourceIsReference) {
      return true;
    }
    return !!invertCopyMode;
  };

  const toReferenceNodeID = (
    sourceNodeID: LongID | ID,
    sourceContext: Context
  ): LongID | ID => {
    if (isRefId(sourceNodeID)) {
      return sourceNodeID;
    }
    return createAbstractRefId(
      sourceContext,
      shortID(sourceNodeID as ID) as ID
    );
  };

  return sources.toList().reduce((accPlan: Plan, s: string, idx: number) => {
    const sourcePath = parseViewPath(s);
    const [sourceNodeID] = getNodeIDFromView(accPlan, sourcePath);
    const sourceStack = getPane(accPlan, sourcePath).stack;
    const sourceContext = getContext(accPlan, sourcePath, sourceStack);
    const insertAt = dropIndex !== undefined ? dropIndex + idx : undefined;

    if (shouldCreateReference(sourceNodeID)) {
      return planAddToParent(
        accPlan,
        toReferenceNodeID(sourceNodeID, sourceContext),
        toView,
        stack,
        insertAt
      );
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

export function DND({ children }: { children: React.ReactNode }): JSX.Element {
  return <DndProvider backend={HTML5Backend}>{children}</DndProvider>;
}
