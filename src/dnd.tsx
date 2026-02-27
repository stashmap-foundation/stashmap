import React from "react";
import { List, OrderedSet, Set } from "immutable";
import { DndProvider, useDragLayer, XYCoord } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import {
  moveRelations,
  deleteRelations,
  createConcreteRefId,
  isRefId,
  isSearchId,
  shortID,
  VERSIONS_NODE_ID,
} from "./connections";
import {
  parseViewPath,
  upsertRelations,
  getParentKey,
  ViewPath,
  NodeIndex,
  getParentView,
  updateViewPathsAfterMoveRelations,
  updateViewPathsAfterDisconnect,
  getRelationIndex,
  getNodeIDFromView,
  getLast,
  getContext,
  getRelationForView,
  getDescendantRelations,
  getPaneIndex,
  isRoot,
  addNodeToPathWithRelations,
  viewPathToString,
  copyViewsWithNewPrefix,
} from "./ViewContext";
import { getNodesInTree } from "./components/Node";
import {
  Plan,
  planUpdateViews,
  planUpdatePanes,
  planDeepCopyNodeWithView,
  planExpandNode,
  planAddToParent,
  planDeleteRelations,
  planDeleteDescendantRelations,
  planMoveDescendantRelations,
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
  stack: ID[],
  destinationIndex: number,
  rootRelation: LongID | undefined,
  targetDepth?: number,
  sourceKeys?: Set<string>
): [ViewPath, number] {
  const pane = getPane(data, root);
  const { paths: nodes } = getNodesInTree(
    data,
    root,
    stack,
    List<ViewPath>(),
    rootRelation,
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
 * reference (refs don't own descendants) or ~versions (version history
 * should survive temporary removal).
 */
export function planDisconnectFromParent(
  plan: Plan,
  viewPath: ViewPath,
  stack: ID[],
  preserveDescendants?: boolean
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

  const skipCleanup =
    preserveDescendants ||
    isRefId(nodeID) ||
    shortID(nodeID) === VERSIONS_NODE_ID;
  if (skipCleanup) {
    return planWithViews;
  }

  const context = getContext(plan, viewPath, stack);
  return planDeleteDescendantRelations(planWithViews, nodeID, context);
}

export function planDeleteNodeFromView(
  plan: Plan,
  viewPath: ViewPath,
  stack: ID[]
): Plan {
  if (!isRoot(viewPath)) {
    return planDisconnectFromParent(plan, viewPath, stack);
  }

  const [nodeID] = getNodeIDFromView(plan, viewPath);
  if (isSearchId(nodeID as ID)) {
    return plan;
  }

  const relation = getRelationForView(plan, viewPath, stack);
  if (!relation || relation.author !== plan.user.publicKey) {
    return plan;
  }

  const context = getContext(plan, viewPath, stack);

  const descendantRelationIds = getDescendantRelations(
    plan.knowledgeDBs,
    nodeID,
    context
  )
    .filter((r) => r.author === plan.user.publicKey)
    .map((r) => r.id)
    .toSet()
    .add(relation.id);

  const planAfterDescendants = planDeleteDescendantRelations(
    plan,
    nodeID,
    context
  );
  const planAfterDelete = planDeleteRelations(
    planAfterDescendants,
    relation.id
  );

  const paneIndex = getPaneIndex(viewPath);
  const shouldResetPane = (p: Pane, i: number): boolean => {
    if (i === paneIndex) {
      return true;
    }
    if (p.rootRelation !== undefined) {
      return descendantRelationIds.has(p.rootRelation);
    }
    if (p.stack.length === 0) {
      return false;
    }
    const rootViewPath: ViewPath = [
      i,
      { nodeID: p.stack[p.stack.length - 1], nodeIndex: 0 as NodeIndex },
    ];
    const paneRelation = getRelationForView(
      planAfterDelete,
      rootViewPath,
      p.stack
    );
    return paneRelation === undefined;
  };
  const newPanes = planAfterDelete.panes.map((p, i) =>
    shouldResetPane(p, i) ? { ...p, stack: [], rootRelation: undefined } : p
  );
  return planUpdatePanes(planAfterDelete, newPanes);
}

export function planMoveNodeWithView(
  plan: Plan,
  sourceViewPath: ViewPath,
  targetParentViewPath: ViewPath,
  stack: ID[],
  insertAtIndex?: number
): Plan {
  const [sourceNodeID] = getNodeIDFromView(plan, sourceViewPath);
  const sourceStack = getPane(plan, sourceViewPath).stack;
  const sourceContext = getContext(plan, sourceViewPath, sourceStack);
  const sourceRelation = getRelationForView(plan, sourceViewPath, sourceStack);

  const sourceParentPath = getParentView(sourceViewPath);
  const sourceParentRelation = sourceParentPath
    ? getRelationForView(plan, sourceParentPath, stack)
    : undefined;
  const targetParentRelation = getRelationForView(
    plan,
    targetParentViewPath,
    stack
  );
  const isSameParentRelation =
    sourceParentRelation !== undefined &&
    targetParentRelation !== undefined &&
    sourceParentRelation.id === targetParentRelation.id;

  const [planWithAdd, [actualNodeID]] = planAddToParent(
    plan,
    sourceNodeID,
    targetParentViewPath,
    stack,
    insertAtIndex,
    undefined,
    undefined,
    isSameParentRelation ? [shortID(sourceNodeID)] : undefined
  );

  const moveNodeID = actualNodeID ?? sourceNodeID;

  const targetParentContext = getContext(
    planWithAdd,
    targetParentViewPath,
    stack
  );
  const [targetParentNodeID] = getNodeIDFromView(
    planWithAdd,
    targetParentViewPath
  );
  const targetContext = targetParentContext.push(shortID(targetParentNodeID));

  const relations = getRelationForView(
    planWithAdd,
    targetParentViewPath,
    stack
  );
  if (!relations || relations.items.size === 0) {
    return planDisconnectFromParent(planWithAdd, sourceViewPath, stack, true);
  }

  const targetIndex = insertAtIndex ?? relations.items.size - 1;
  const targetViewPath = addNodeToPathWithRelations(
    targetParentViewPath,
    relations,
    targetIndex
  );

  const sourceKey = viewPathToString(sourceViewPath);
  const targetKey = viewPathToString(targetViewPath);
  const updatedViews = copyViewsWithNewPrefix(
    planWithAdd.views,
    sourceKey,
    targetKey
  );
  const planWithViews = planUpdateViews(planWithAdd, updatedViews);

  const planWithDisconnect = planDisconnectFromParent(
    planWithViews,
    sourceViewPath,
    stack,
    true
  );

  return planMoveDescendantRelations(
    planWithDisconnect,
    sourceNodeID,
    sourceContext,
    targetContext,
    sourceRelation,
    moveNodeID !== sourceNodeID ? moveNodeID : undefined,
    targetParentRelation?.root
  );
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
  targetDepth?: number,
  isCopyDrag?: boolean
): Plan {
  const rootView = to;

  const sourceViewPath = parseViewPath(source);
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

  const sourceParentKey = getParentKey(source);
  const allSourcesSameParent =
    !selection.contains(source) ||
    independentSources.every((s) => getParentKey(s) === sourceParentKey);
  const sameRelation =
    allSourcesSameParent &&
    fromRelation !== undefined &&
    toRelation !== undefined &&
    fromRelation.id === toRelation.id;

  const skipMoveLogic = isSuggestion || isCopyDrag;
  const reorder =
    isSamePane && !skipMoveLogic && sameRelation && dropIndex !== undefined;

  if (reorder) {
    const realSources = independentSources.filter(
      (n) => getRelationIndex(plan, parseViewPath(n)) !== undefined
    );
    const virtualSources = independentSources.filter(
      (n) => getRelationIndex(plan, parseViewPath(n)) === undefined
    );
    const sourceIndices = List(
      realSources.map((n) => getRelationIndex(plan, parseViewPath(n)))
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
    const reorderedPlan = planUpdateViews(updatedRelationsPlan, updatedViews);
    return virtualSources
      .toList()
      .reduce((accPlan: Plan, s: string, idx: number) => {
        const sourcePath = parseViewPath(s);
        const [sourceNodeID] = getNodeIDFromView(accPlan, sourcePath);
        const insertAt = dropIndex + sourceIndices.size + idx;
        return planAddToParent(
          accPlan,
          sourceNodeID,
          toView,
          stack,
          insertAt
        )[0];
      }, reorderedPlan);
  }

  const samePaneMove =
    isSamePane &&
    !skipMoveLogic &&
    !invertCopyMode &&
    !sameRelation &&
    dropIndex !== undefined;

  if (samePaneMove) {
    const toViewStr = viewPathToString(toView);
    const isDropIntoOwnDescendant = independentSources.some(
      (s) => toViewStr === s || toViewStr.startsWith(`${s}:`)
    );
    if (isDropIntoOwnDescendant) {
      return plan;
    }
    return independentSources
      .toList()
      .reduce((accPlan: Plan, s: string, idx: number) => {
        const sourcePath = parseViewPath(s);
        const [sourceNodeID] = getNodeIDFromView(accPlan, sourcePath);
        const insertAt = dropIndex + idx;

        if (isRefId(sourceNodeID)) {
          const [planWithAdd] = planAddToParent(
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

        return planMoveNodeWithView(
          accPlan,
          sourcePath,
          toView,
          stack,
          insertAt
        );
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
    sourceRelation: Relations
  ): LongID | ID => {
    if (isRefId(sourceNodeID)) {
      return sourceNodeID;
    }
    return createConcreteRefId(sourceRelation.id);
  };

  return independentSources
    .toList()
    .reduce((accPlan: Plan, s: string, idx: number) => {
      const sourcePath = parseViewPath(s);
      const [sourceNodeID] = getNodeIDFromView(accPlan, sourcePath);
      const sourceStack = getPane(accPlan, sourcePath).stack;
      const insertAt = dropIndex !== undefined ? dropIndex + idx : undefined;

      if (shouldCreateReference(sourceNodeID)) {
        if (isRefId(sourceNodeID)) {
          return planAddToParent(
            accPlan,
            sourceNodeID,
            toView,
            stack,
            insertAt
          )[0];
        }
        const planWithRelation = upsertRelations(
          accPlan,
          sourcePath,
          sourceStack,
          (r) => r
        );
        const sourceRelation = getRelationForView(
          planWithRelation,
          sourcePath,
          sourceStack
        )!;
        return planAddToParent(
          planWithRelation,
          toReferenceNodeID(sourceNodeID, sourceRelation),
          toView,
          stack,
          insertAt
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
