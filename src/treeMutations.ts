import {
  getNode,
  getNodeContext,
  getSemanticID,
  isSearchId,
} from "./core/connections";
import { planRemoveNodeItemById } from "./dataPlanner";
import {
  ViewPath,
  updateViewPathsAfterDisconnect,
  addNodeToPathWithNodes,
  viewPathToString,
  copyViewsWithNewPrefix,
} from "./ViewContext";
import {
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
    if (!p.rootNodeId) {
      return false;
    }
    return getNode(plan.knowledgeDBs, p.rootNodeId, p.author) === undefined;
  };

  const newPanes = plan.panes.map((p, i) =>
    shouldResetPane(p, i) ? { ...p, rootNodeId: undefined } : p
  );
  return planUpdatePanes(plan, newPanes);
}

export function planDisconnectFromParent(
  plan: Plan,
  parentNode: GraphNode,
  childID: ID,
  preserveDescendants?: boolean
): Plan {
  if (parentNode.author !== plan.user.publicKey) {
    return plan;
  }

  const updatedNodesPlan = planRemoveNodeItemById(
    plan,
    parentNode.id,
    childID,
    preserveDescendants === undefined ? false : !!preserveDescendants
  );

  const updatedViews = updateViewPathsAfterDisconnect(
    updatedNodesPlan.views,
    childID,
    parentNode.id
  );

  const planWithViews = planUpdateViews(updatedNodesPlan, updatedViews);

  return resetInvalidPanes(planWithViews);
}

export function planDeleteNode(
  plan: Plan,
  node: GraphNode,
  rowID: ID,
  parentNode: GraphNode | undefined,
  childID: ID,
  paneIndex: number
): Plan {
  if (parentNode) {
    return planDisconnectFromParent(plan, parentNode, childID);
  }

  if (isSearchId(rowID)) {
    return plan;
  }

  if (node.author !== plan.user.publicKey) {
    return plan;
  }

  const planAfterDescendants = planDeleteDescendantNodes(plan, node);
  const planAfterDelete = planDeleteNodes(planAfterDescendants, node.id);
  return resetInvalidPanes(planAfterDelete, paneIndex);
}

export function planMoveNode(
  plan: Plan,
  sourceNode: GraphNode,
  sourceRowID: ID,
  sourceChildID: ID,
  sourceParentNode: GraphNode,
  sourceViewPath: ViewPath,
  targetParentNode: GraphNode,
  targetParentViewPath: ViewPath,
  insertAtIndex?: number
): Plan {
  const [planWithAdd, [actualItemID]] = planAddToParent(
    plan,
    sourceNode.id,
    targetParentNode,
    insertAtIndex
  );

  const moveItemID = actualItemID ?? sourceRowID;
  const actualTargetParentNode =
    getNode(
      planWithAdd.knowledgeDBs,
      targetParentNode.id,
      plan.user.publicKey
    ) ?? targetParentNode;
  const targetContext = getNodeContext(
    planWithAdd.knowledgeDBs,
    actualTargetParentNode
  ).push(getSemanticID(planWithAdd.knowledgeDBs, actualTargetParentNode));

  if (actualTargetParentNode.children.size === 0) {
    return planDisconnectFromParent(
      planWithAdd,
      sourceParentNode,
      sourceChildID,
      true
    );
  }

  const targetIndex = insertAtIndex ?? actualTargetParentNode.children.size - 1;
  const targetViewPath = addNodeToPathWithNodes(
    targetParentViewPath,
    actualTargetParentNode,
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
    sourceParentNode,
    sourceChildID,
    true
  );
  const planWithDisconnect =
    preservedSourceViews && preservedSourceViews.size > 0
      ? planUpdateViews(
          disconnectedPlan,
          disconnectedPlan.views.merge(preservedSourceViews)
        )
      : disconnectedPlan;

  return planMoveDescendantNodes(
    planWithDisconnect,
    sourceNode,
    targetContext,
    actualTargetParentNode.id,
    moveItemID !== sourceRowID ? moveItemID : undefined,
    actualTargetParentNode.root
  );
}
