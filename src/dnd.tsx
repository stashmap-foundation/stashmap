import React from "react";
import { List, OrderedSet, Set } from "immutable";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { getSelectedInView } from "./components/TemporaryViewContext";
import {
  bulkAddRelations,
  getRelations,
  moveRelations,
  deleteRelations,
  addRelationToRelations,
} from "./connections";
import {
  parseViewPath,
  upsertRelations,
  getParentKey,
  ViewPath,
  getParentView,
  bulkUpdateViewPathsAfterAddRelation,
  updateViewPathsAfterMoveRelations,
  updateViewPathsAfterDisconnect,
  updateViewPathsAfterAddRelation,
  getRelationIndex,
  getNodeIDFromView,
  getParentNodeID,
  getLast,
} from "./ViewContext";
import { getNodesInTree } from "./components/Node";
import { Plan, planUpdateViews } from "./planner";

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
  destinationIndex: number
): [ViewPath, number] {
  const nodes = getNodesInTree(data, root, stack, List<ViewPath>());
  const dropBefore = nodes.get(destinationIndex);
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
      : getDropDestinationFromTreeView(plan, rootView, stack, indexTo);

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
  const sourceNodes = List(
    sources.map((s) => {
      const path = parseViewPath(s);
      const [nodeID] = getNodeIDFromView(plan, path);
      return nodeID;
    })
  );
  const updatedRelationsPlan = upsertRelations(
    plan,
    toView,
    stack,
    (relations: Relations) => {
      return bulkAddRelations(
        relations,
        sourceNodes.toArray(),
        "", // Default to "relevant" relevance
        undefined, // No argument
        dropIndex
      );
    }
  );
  const updatedViews = bulkUpdateViewPathsAfterAddRelation(
    updatedRelationsPlan,
    toView,
    sourceNodes.size,
    dropIndex
  );
  return planUpdateViews(updatedRelationsPlan, updatedViews);
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

/**
 * Add a node to a parent at a specific index.
 * Returns the updated plan with the node added to the parent's relations and views updated.
 */
export function planAddToParent(
  plan: Plan,
  nodeID: LongID | ID,
  parentViewPath: ViewPath,
  stack: (LongID | ID)[],
  insertAtIndex: number
): Plan {
  const updatedRelationsPlan = upsertRelations(
    plan,
    parentViewPath,
    stack,
    (relations) => addRelationToRelations(relations, nodeID, "", undefined, insertAtIndex)
  );

  const updatedViews = updateViewPathsAfterAddRelation(
    updatedRelationsPlan,
    parentViewPath,
    insertAtIndex
  );

  return planUpdateViews(updatedRelationsPlan, updatedViews);
}

export function DND({ children }: { children: React.ReactNode }): JSX.Element {
  return <DndProvider backend={HTML5Backend}>{children}</DndProvider>;
}
