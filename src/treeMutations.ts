import { getSemanticID, isSearchId, shortID } from "./connections";
import { planRemoveNodeItemById } from "./dataPlanner";
import {
  ViewPath,
  getContext,
  getParentView,
  updateViewPathsAfterDisconnect,
  getNodeIndexForView,
  getRowIDFromView,
  getLast,
  getNodeForView,
  getPaneIndex,
  isRoot,
  addNodeToPathWithNodes,
  viewPathToString,
  copyViewsWithNewPrefix,
} from "./ViewContext";
import {
  getPane,
  Plan,
  planAddToParent,
  planDeleteNodes,
  planDeleteDescendantNodes,
  planMoveDescendantNodes,
  planUpdatePanes,
  planUpdateViews,
} from "./planner";

function resetInvalidPanes(plan: Plan, paneIndexToReset?: number): Plan {
  const shouldResetPane = (p: Pane, i: number): boolean => {
    if (paneIndexToReset !== undefined && i === paneIndexToReset) {
      return true;
    }
    if (p.rootNodeId !== undefined) {
      return (
        getNodeForView(plan, [i, p.rootNodeId] as ViewPath, p.stack) ===
        undefined
      );
    }
    if (p.stack.length === 0) {
      return false;
    }
    const rootViewPath: ViewPath = [
      i,
      p.rootNodeId || p.stack[p.stack.length - 1],
    ];
    return getNodeForView(plan, rootViewPath, p.stack) === undefined;
  };

  const newPanes = plan.panes.map((p, i) =>
    shouldResetPane(p, i) ? { ...p, stack: [], rootNodeId: undefined } : p
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

  const nodeIndex = getNodeIndexForView(plan, viewPath);
  if (nodeIndex === undefined) {
    return plan;
  }

  const disconnectID = getLast(viewPath);
  const parentNode = getNodeForView(plan, parentPath, stack);
  if (!parentNode) {
    return plan;
  }
  if (parentNode.author !== plan.user.publicKey) {
    return plan;
  }

  const updatedNodesPlan = planRemoveNodeItemById(
    plan,
    parentNode.id,
    getLast(viewPath),
    preserveDescendants === undefined ? false : !!preserveDescendants
  );

  const updatedViews = updateViewPathsAfterDisconnect(
    updatedNodesPlan.views,
    disconnectID,
    parentNode.id
  );

  const planWithViews = planUpdateViews(updatedNodesPlan, updatedViews);

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

  const node = getNodeForView(plan, viewPath, stack);
  if (!node || node.author !== plan.user.publicKey) {
    return plan;
  }

  const planAfterDescendants = planDeleteDescendantNodes(plan, node);
  const planAfterDelete = planDeleteNodes(planAfterDescendants, node.id);
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
  const sourceStack = getPane(plan, sourceViewPath).stack;
  const sourceNode = getNodeForView(plan, sourceViewPath, sourceStack);
  const sourceAddID = sourceNode?.id ?? sourceItemID;

  const [planWithAdd, [actualItemID]] = planAddToParent(
    plan,
    sourceAddID,
    targetParentViewPath,
    stack,
    insertAtIndex
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
  const actualTargetParentNode = getNodeForView(
    planWithAdd,
    targetParentViewPath,
    stack
  );
  const targetContext = targetParentContext.push(
    shortID(
      (actualTargetParentNode
        ? getSemanticID(planWithAdd.knowledgeDBs, actualTargetParentNode)
        : targetParentRowID) as ID
    )
  );

  const nodes = getNodeForView(planWithAdd, targetParentViewPath, stack);
  if (!nodes || nodes.children.size === 0) {
    return planDisconnectFromParent(planWithAdd, sourceViewPath, stack, true);
  }

  const targetIndex = insertAtIndex ?? nodes.children.size - 1;
  const targetViewPath = addNodeToPathWithNodes(
    targetParentViewPath,
    nodes,
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

  if (!sourceNode) {
    return planWithDisconnect;
  }

  return planMoveDescendantNodes(
    planWithDisconnect,
    sourceNode,
    targetContext,
    actualTargetParentNode?.id,
    moveItemID !== sourceItemID ? moveItemID : undefined,
    actualTargetParentNode?.root
  );
}
