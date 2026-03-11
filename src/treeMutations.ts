import { Set } from "immutable";
import {
  deleteRelations,
  isRefId,
  isSearchId,
  getRelationSemanticID,
  shortID,
} from "./connections";
import {
  upsertRelations,
  ViewPath,
  getParentView,
  updateViewPathsAfterDisconnect,
  getRelationIndex,
  getRowIDFromView,
  getLast,
  getContext,
  getRelationForView,
  getPaneIndex,
  isRoot,
  addNodeToPathWithRelations,
  viewPathToString,
  copyViewsWithNewPrefix,
  getCurrentEdgeForView,
} from "./ViewContext";
import {
  Plan,
  planUpdateViews,
  planUpdatePanes,
  planAddToParent,
  planDeleteRelations,
  planDeleteDescendantRelations,
  planMoveDescendantRelations,
  getPane,
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
  const [itemID] = getRowIDFromView(plan, viewPath);
  const sourceRelation = getRelationForView(plan, viewPath, stack);
  const parentRelation = getRelationForView(plan, parentPath, stack);
  if (!parentRelation) {
    return plan;
  }
  if (parentRelation.author !== plan.user.publicKey) {
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
    disconnectID,
    parentRelation.id
  );

  const planWithViews = planUpdateViews(updatedRelationsPlan, updatedViews);

  const skipCleanup = preserveDescendants || isRefId(itemID);
  if (skipCleanup) {
    return resetInvalidPanes(planWithViews);
  }

  if (sourceRelation) {
    return resetInvalidPanes(
      planDeleteDescendantRelations(planWithViews, sourceRelation)
    );
  }
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
  const [sourceItemID] = getRowIDFromView(plan, sourceViewPath);
  const sourceEdge = getCurrentEdgeForView(plan, sourceViewPath);
  const sourceStack = getPane(plan, sourceViewPath).stack;
  const sourceRelation = getRelationForView(plan, sourceViewPath, sourceStack);
  const sourceAddID = sourceRelation?.id ?? sourceItemID;

  const [planWithAdd, [actualItemID]] = planAddToParent(
    plan,
    sourceAddID,
    targetParentViewPath,
    stack,
    insertAtIndex,
    sourceEdge?.relevance,
    sourceEdge?.argument
  );

  const moveItemID = actualItemID ?? sourceItemID;

  const targetParentContext = getContext(
    planWithAdd,
    targetParentViewPath,
    stack
  );
  const [targetParentRowID] = getRowIDFromView(
    planWithAdd,
    targetParentViewPath
  );
  const actualTargetParentRelation = getRelationForView(
    planWithAdd,
    targetParentViewPath,
    stack
  );
  const targetContext = targetParentContext.push(
    shortID(
      (actualTargetParentRelation
        ? getRelationSemanticID(actualTargetParentRelation)
        : targetParentRowID) as ID
    )
  );

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
  const preservedSourceViews =
    sourceKey === targetKey
      ? planWithAdd.views.filter(
          (_view, key) => key === sourceKey || key.startsWith(`${sourceKey}:`)
        )
      : undefined;
  const updatedViews = copyViewsWithNewPrefix(
    planWithAdd.views,
    sourceKey,
    targetKey
  );
  const planWithViews = planUpdateViews(planWithAdd, updatedViews);

  const disconnectedPlan = planDisconnectFromParent(
    planWithViews,
    sourceViewPath,
    stack,
    true
  );
  const planWithDisconnect =
    preservedSourceViews && preservedSourceViews.size > 0
      ? planUpdateViews(
          disconnectedPlan,
          disconnectedPlan.views.merge(preservedSourceViews)
        )
      : disconnectedPlan;

  if (!sourceRelation) {
    return planWithDisconnect;
  }

  return planMoveDescendantRelations(
    planWithDisconnect,
    sourceRelation,
    targetContext,
    actualTargetParentRelation?.id,
    moveItemID !== sourceItemID ? moveItemID : undefined,
    actualTargetParentRelation?.root
  );
}
