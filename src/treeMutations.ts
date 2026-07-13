import { getNode, isSearchId } from "./core/connections";
import { getWorkspaceNode } from "./core/knowledge";
import { planRemoveNodeItemById } from "./dataPlanner";
import {
  ViewPath,
  updateViewPathsAfterDisconnect,
  addNodeToPathWithNodes,
  viewPathToString,
  copyViewsWithNewPrefix,
} from "./rowModel";
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
    return getNode(plan.knowledgeDBs, p.rootNodeId, p.sourceId) === undefined;
  };

  const newPanes = plan.panes.map((p, i) =>
    shouldResetPane(p, i) ? { ...p, rootNodeId: undefined } : p
  );
  return planUpdatePanes(plan, newPanes);
}

export function planDisconnectFromParent(
  plan: Plan,
  parentID: ID,
  childID: ID,
  preserveDescendants?: boolean
): Plan {
  const updatedNodesPlan = planRemoveNodeItemById(
    plan,
    parentID,
    childID,
    preserveDescendants === undefined ? false : !!preserveDescendants
  );

  const updatedViews = updateViewPathsAfterDisconnect(
    updatedNodesPlan.views,
    childID,
    parentID
  );

  const planWithViews = planUpdateViews(updatedNodesPlan, updatedViews);

  return resetInvalidPanes(planWithViews);
}

export function planDeleteNode(
  plan: Plan,
  nodeID: ID,
  parentID: ID | undefined,
  paneIndex: number
): Plan {
  if (parentID) {
    return planDisconnectFromParent(plan, parentID, nodeID);
  }

  if (isSearchId(nodeID)) {
    return plan;
  }

  const node = getWorkspaceNode(plan.knowledgeDBs, nodeID);
  if (!node) {
    return plan;
  }

  const planAfterDescendants = planDeleteDescendantNodes(plan, node);
  const planAfterDelete = planDeleteNodes(planAfterDescendants, node.id);
  return resetInvalidPanes(planAfterDelete, paneIndex);
}

export function planMoveNode(
  plan: Plan,
  sourceNodeID: ID,
  sourceChildID: ID,
  sourceParentID: ID,
  sourceViewPath: ViewPath,
  targetParentID: ID,
  targetParentViewPath: ViewPath,
  insertAtIndex?: number
): Plan {
  const sourceNode = getWorkspaceNode(plan.knowledgeDBs, sourceNodeID);
  if (!sourceNode) {
    return plan;
  }

  const [planWithAdd] = planAddToParent(
    plan,
    sourceNodeID,
    targetParentID,
    insertAtIndex
  );

  const actualTargetParentNode = getWorkspaceNode(
    planWithAdd.knowledgeDBs,
    targetParentID
  );

  if (!actualTargetParentNode || actualTargetParentNode.children.size === 0) {
    return planDisconnectFromParent(
      planWithAdd,
      sourceParentID,
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
    sourceParentID,
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
    actualTargetParentNode.id,
    actualTargetParentNode.root
  );
}
