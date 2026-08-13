import { getNode, isSearchId } from "./core/connections";
import { getWorkspaceNode } from "./core/knowledge";
import { planRemoveNodeItemById } from "./dataPlanner";
import { updateViewPathsAfterDisconnect } from "./rowModel";
import {
  Plan,
  planDeleteNodes,
  planDeleteDescendantNodes,
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
