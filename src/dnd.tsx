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

export function getDropDestinationFromTreeView(
  data: Data,
  root: ViewPath,
  stack: ID[],
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
    return getDropDestinationEndOfRoot(data, root, stack);
  }
  const parentView = getParentView(dropBefore);
  if (!parentView) {
    return getDropDestinationEndOfRoot(data, root, stack);
  }
  // new index is the current index of the sibling
  const index = getRelationIndex(data, dropBefore);
  return [parentView, index || 0];
}

// Pane Root
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
  stack: ID[],
  indexTo: number | undefined,
  rootRelation: LongID | undefined,
  isSuggestion?: boolean,
  invertCopyMode = false
): Plan {
  const rootView = to;

  const sourceViewPath = parseViewPath(source);
  const selectedSources = getSelectedInView(selection, getParentKey(source));
  const sources = selection.contains(source) ? selectedSources : List([source]);

  const sourceParentPath = getParentView(sourceViewPath);
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
    isSamePane &&
    !isSuggestion &&
    sameRelation &&
    dropIndex !== undefined;

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
    return sources
      .toList()
      .reduce((accPlan: Plan, s: string, idx: number) => {
        const sourcePath = parseViewPath(s);
        const [sourceNodeID] = getNodeIDFromView(accPlan, sourcePath);
        const sourceStack = getPane(accPlan, sourcePath).stack;
        const sourceContext = getContext(accPlan, sourcePath, sourceStack);
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
      return invertCopyMode;
    }
    const sourceIsReference = isRefId(sourceNodeID);
    if (sourceIsReference) {
      return true;
    }
    return invertCopyMode;
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

/**
 * Disconnect a node from its current parent.
 * Returns the updated plan with the node removed from its parent's relations and views updated.
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
    parentRelation.id,
    nodeIndex
  );

  return planUpdateViews(updatedRelationsPlan, updatedViews);
}

export function DND({ children }: { children: React.ReactNode }): JSX.Element {
  return <DndProvider backend={HTML5Backend}>{children}</DndProvider>;
}
