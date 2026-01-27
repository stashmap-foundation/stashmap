import React from "react";
import { List, OrderedSet, Set } from "immutable";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { getSelectedInView } from "./components/TemporaryViewContext";
import { getRelations, moveRelations, deleteRelations } from "./connections";
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
  getParentNodeID,
  getLast,
  getContextFromStackAndViewPath,
} from "./ViewContext";
import { getNodesInTree } from "./components/Node";
import {
  Plan,
  planUpdateViews,
  planDeepCopyNodeWithView,
  planExpandNode,
} from "./planner";

function getDropDestinationEndOfRoot(
  data: Data,
  root: ViewPath
): [ViewPath, number] {
  const [rootNodeID, rootView] = getNodeIDFromView(data, root);
  const relations = getRelations(
    data.knowledgeDBs,
    rootView.relations,
    data.user.publicKey,
    rootNodeID
  );
  return [root, relations?.items.size || 0];
}

export function getDropDestinationFromTreeView(
  data: Data,
  root: ViewPath,
  stack: (LongID | ID)[],
  destinationIndex: number,
  rootRelation: LongID | undefined
): [ViewPath, number] {
  const nodes = getNodesInTree(
    data,
    root,
    stack,
    List<ViewPath>(),
    rootRelation
  );
  // Subtract 1 because the visual list includes root at index 0,
  // but getNodesInTree doesn't include the root
  const adjustedIndex = destinationIndex - 1;
  const dropBefore = nodes.get(adjustedIndex);
  if (!dropBefore) {
    return getDropDestinationEndOfRoot(data, root);
  }
  const parentView = getParentView(dropBefore);
  if (!parentView) {
    return getDropDestinationEndOfRoot(data, root);
  }
  // new index is the current index of the sibling
  const index = getRelationIndex(data, dropBefore, stack);
  return [parentView, index || 0];
}

// Workspace
// drag 18fbe5b5-6516-4cdb-adde-860bf47c9eb0:0:0 to 18fbe5b5-6516-4cdb-adde-860bf47c9eb0 [new] [0]
//
// Inner Node
// drag 18fbe5b5-6516-4cdb-adde-860bf47c9eb0:0:0 to 18fbe5b5-6516-4cdb-adde-860bf47c9eb0:1 [inner] [0]
//
// drop on Outer Node
// drag 18fbe5b5-6516-4cdb-adde-860bf47c9eb0:0 to 18fbe5b5-6516-4cdb-adde-860bf47c9eb0:1 [bottom] [0]

export function dnd(
  plan: Plan,
  selection: OrderedSet<string>,
  source: string,
  to: ViewPath,
  stack: (LongID | ID)[],
  indexTo: number | undefined,
  rootRelation: LongID | undefined,
  isDiffItem?: boolean
): Plan {
  const rootView = to;

  const sourceViewPath = parseViewPath(source);
  const selectedSources = getSelectedInView(selection, getParentKey(source));
  const sources = selection.contains(source) ? selectedSources : List([source]);

  const [fromRepoID, fromView] = getParentNodeID(plan, sourceViewPath);
  const [toView, dropIndex] =
    indexTo === undefined
      ? [rootView, undefined]
      : getDropDestinationFromTreeView(
          plan,
          rootView,
          stack,
          indexTo,
          rootRelation
        );

  const [toNodeID, toV] = getNodeIDFromView(plan, toView);

  // Diff items are always added, never moved (they're from other users)
  const move =
    !isDiffItem &&
    dropIndex !== undefined &&
    fromRepoID !== undefined &&
    toNodeID === fromRepoID &&
    fromView.relations === toV.relations;

  if (move) {
    const sourceIndices = List(
      sources.map((n) => getRelationIndex(plan, parseViewPath(n), stack))
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
      toView,
      sourceIndices.toArray(),
      dropIndex
    );
    return planUpdateViews(updatedRelationsPlan, updatedViews);
  }
  // Deep copy each source node to target (copies node + all descendants + views)
  const [, toViewData] = getNodeIDFromView(plan, toView);
  const toContext = getContextFromStackAndViewPath(stack, toView);

  // Ensure target is expanded
  const expandedPlan = toViewData.expanded
    ? plan
    : planExpandNode(plan, toNodeID, toContext, toViewData, toView);

  // Deep copy each source
  return sources.toList().reduce((accPlan: Plan, s: string, idx: number) => {
    const sourcePath = parseViewPath(s);
    const [sourceNodeID] = getNodeIDFromView(accPlan, sourcePath);
    const sourceContext = getContextFromStackAndViewPath(stack, sourcePath);
    const insertAt = dropIndex !== undefined ? dropIndex + idx : undefined;

    return planDeepCopyNodeWithView(
      accPlan,
      sourceNodeID,
      sourceContext,
      sourcePath,
      toView,
      stack,
      insertAt
    );
  }, expandedPlan);
}

/**
 * Disconnect a node from its current parent.
 * Returns the updated plan with the node removed from its parent's relations and views updated.
 */
export function planDisconnectFromParent(
  plan: Plan,
  viewPath: ViewPath,
  stack: (LongID | ID)[]
): Plan {
  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    return plan;
  }

  const relationIndex = getRelationIndex(plan, viewPath, stack);
  if (relationIndex === undefined) {
    return plan;
  }

  const { nodeID, nodeIndex } = getLast(viewPath);
  const [, parentView] = getNodeIDFromView(plan, parentPath);

  // Remove from parent's relations
  const updatedRelationsPlan = upsertRelations(
    plan,
    parentPath,
    stack,
    (relations) => deleteRelations(relations, Set([relationIndex]))
  );

  // Update view paths
  const updatedViews = updateViewPathsAfterDisconnect(
    updatedRelationsPlan.views,
    nodeID,
    parentView.relations || ("" as LongID),
    nodeIndex
  );

  return planUpdateViews(updatedRelationsPlan, updatedViews);
}

export function DND({ children }: { children: React.ReactNode }): JSX.Element {
  return <DndProvider backend={HTML5Backend}>{children}</DndProvider>;
}
