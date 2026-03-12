import { isSearchId } from "./connections";
import {
  planMoveRelationItemById,
  planRemoveRelationItemById,
} from "./dataPlanner";
import {
  ViewPath,
  getParentView,
  updateViewPathsAfterDisconnect,
  getRelationIndex,
  getRowIDFromView,
  getLast,
  getRelationForView,
  getPaneIndex,
  isRoot,
  addNodeToPathWithRelations,
  viewPathToString,
  copyViewsWithNewPrefix,
} from "./ViewContext";
import {
  Plan,
  planExpandNode,
  planUpdateViews,
  planUpdatePanes,
  planDeleteRelations,
  planDeleteDescendantRelations,
} from "./planner";

function resetInvalidPanes(plan: Plan, paneIndexToReset?: number): Plan {
  const shouldResetPane = (p: Pane, i: number): boolean => {
    if (paneIndexToReset !== undefined && i === paneIndexToReset) {
      return true;
    }
    if (p.rootRelation !== undefined) {
      return (
        getRelationForView(plan, [i, p.rootRelation] as ViewPath, p.stack) ===
        undefined
      );
    }
    if (p.stack.length === 0) {
      return false;
    }
    const rootViewPath: ViewPath = [
      i,
      p.rootRelation || p.stack[p.stack.length - 1],
    ];
    return getRelationForView(plan, rootViewPath, p.stack) === undefined;
  };

  const newPanes = plan.panes.map((p, i) =>
    shouldResetPane(p, i) ? { ...p, stack: [], rootRelation: undefined } : p
  );
  return planUpdatePanes(plan, newPanes);
}

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

  const disconnectID = getLast(viewPath);
  const parentRelation = getRelationForView(plan, parentPath, stack);
  if (!parentRelation) {
    return plan;
  }
  if (parentRelation.author !== plan.user.publicKey) {
    return plan;
  }

  const updatedRelationsPlan = planRemoveRelationItemById(
    plan,
    parentRelation.id,
    getLast(viewPath),
    !!preserveDescendants
  );

  const updatedViews = updateViewPathsAfterDisconnect(
    updatedRelationsPlan.views,
    disconnectID,
    parentRelation.id
  );

  const planWithViews = planUpdateViews(updatedRelationsPlan, updatedViews);

  return resetInvalidPanes(planWithViews);
}

export function planDeleteNodeFromView(
  plan: Plan,
  viewPath: ViewPath,
  stack: ID[]
): Plan {
  if (!isRoot(viewPath)) {
    return planDisconnectFromParent(plan, viewPath, stack);
  }

  const [itemID] = getRowIDFromView(plan, viewPath);
  if (isSearchId(itemID as ID)) {
    return plan;
  }

  const relation = getRelationForView(plan, viewPath, stack);
  if (!relation || relation.author !== plan.user.publicKey) {
    return plan;
  }

  const planAfterDescendants = planDeleteDescendantRelations(plan, relation);
  const planAfterDelete = planDeleteRelations(
    planAfterDescendants,
    relation.id
  );
  return resetInvalidPanes(planAfterDelete, getPaneIndex(viewPath));
}

export function planMoveNodeWithView(
  plan: Plan,
  sourceViewPath: ViewPath,
  targetParentViewPath: ViewPath,
  stack: ID[],
  insertAtIndex?: number
): Plan {
  const sourceParentViewPath = getParentView(sourceViewPath);
  if (!sourceParentViewPath) {
    return plan;
  }

  const [, targetParentView] = getRowIDFromView(plan, targetParentViewPath);
  const expandedPlan = planExpandNode(
    plan,
    targetParentView,
    targetParentViewPath
  );

  const sourceParentRelation = getRelationForView(
    expandedPlan,
    sourceParentViewPath,
    stack
  );
  const targetParentRelation = getRelationForView(
    expandedPlan,
    targetParentViewPath,
    stack
  );
  if (
    !sourceParentRelation ||
    !targetParentRelation ||
    sourceParentRelation.author !== plan.user.publicKey ||
    targetParentRelation.author !== plan.user.publicKey
  ) {
    return plan;
  }
  if (sourceParentRelation.id === targetParentRelation.id) {
    return resetInvalidPanes(expandedPlan);
  }

  const sourceItemID = getLast(sourceViewPath);
  const movedPlan = planMoveRelationItemById(
    expandedPlan,
    sourceParentRelation.id,
    sourceItemID,
    targetParentRelation.id,
    insertAtIndex
  );
  const relations = getRelationForView(movedPlan, targetParentViewPath, stack);
  const targetIndex = relations?.items.findIndex(
    (item) => item.id === sourceItemID
  );
  if (!relations || targetIndex === undefined || targetIndex < 0) {
    return resetInvalidPanes(movedPlan);
  }

  const targetViewPath = addNodeToPathWithRelations(
    targetParentViewPath,
    relations,
    targetIndex
  );

  const sourceKey = viewPathToString(sourceViewPath);
  const targetKey = viewPathToString(targetViewPath);
  if (sourceKey === targetKey) {
    return resetInvalidPanes(movedPlan);
  }

  const updatedViews = copyViewsWithNewPrefix(
    movedPlan.views,
    sourceKey,
    targetKey
  );
  return resetInvalidPanes(
    planUpdateViews(
      movedPlan,
      updateViewPathsAfterDisconnect(
        updatedViews,
        sourceItemID,
        sourceParentRelation.id
      )
    )
  );
}
