import React from "react";
import { List, OrderedSet } from "immutable";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { getSelectedInView } from "./components/TemporaryViewContext";
import { bulkAddRelations, getRelations, moveRelations } from "./connections";
import {
  parseViewPath,
  upsertRelations,
  getParentKey,
  ViewPath,
  getParentView,
  bulkUpdateViewPathsAfterAddRelation,
  updateViewPathsAfterMoveRelations,
  getRelationIndex,
  getNodeIDFromView,
  getParentNodeID,
} from "./ViewContext";
import { getNodesInTree } from "./components/Node";
import { Plan, planUpdateViews } from "./planner";

function getDropDestinationEndOfRoot(
  data: Data,
  root: ViewPath
): [ViewPath, number] {
  // TODO: Replace everything here with getRelationsFromView
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
  destinationIndex: number
): [ViewPath, number] {
  const nodes = getNodesInTree(data, root, List<ViewPath>());
  const dropBefore = nodes.get(destinationIndex);
  if (!dropBefore) {
    return getDropDestinationEndOfRoot(data, root);
  }
  const parentView = getParentView(dropBefore);
  if (!parentView) {
    return getDropDestinationEndOfRoot(data, root);
  }
  // new index is the current index of the sibling
  const index = getRelationIndex(data, dropBefore);
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
      : getDropDestinationFromTreeView(plan, rootView, indexTo);

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
      sources.map((n) => getRelationIndex(plan, parseViewPath(n)))
    ).filter((n) => n !== undefined) as List<number>;
    const updatedRelationsPlan = upsertRelations(
      plan,
      toView,
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
    (relations: Relations) => {
      return bulkAddRelations(
        relations,
        sourceNodes.toArray(),
        List([""]), // Default to "relevant" type
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

export function DND({ children }: { children: React.ReactNode }): JSX.Element {
  return <DndProvider backend={HTML5Backend}>{children}</DndProvider>;
}
