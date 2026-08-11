import { Set } from "immutable";
import { getWorkspaceNode } from "./core/knowledge";
import { deleteNodes } from "./core/connections";
import { placementTarget } from "./core/nodeSpans";
import {
  GraphPlan,
  clearPosition,
  nextUpdated,
  planDeleteDescendantNodes,
  planDeleteNodes,
  planMoveDescendantNodes,
  planUpsertNodes,
} from "./planner";

function getWritableNode(plan: GraphPlan, nodeId: ID): GraphNode | undefined {
  return getWorkspaceNode(plan.knowledgeDBs, nodeId);
}

function getNodeItemIndex(node: GraphNode, itemId: ID): number | undefined {
  const index = node.children.findIndex((childID) => childID === itemId);
  return index >= 0 ? index : undefined;
}

function requireNodeItem(
  plan: GraphPlan,
  node: GraphNode,
  itemId: ID
): GraphNode | undefined {
  const index = getNodeItemIndex(node, itemId);
  const childID = index === undefined ? undefined : node.children.get(index);
  return childID ? getWorkspaceNode(plan.knowledgeDBs, childID) : undefined;
}

// A deleted row takes its anchor seat with it. Dependents re-aim to the
// row the seat stands for — the claim's target that resurfaces as a base
// row, the deleted row's own anchor, or its file predecessor — so a
// deletion never moves the rows anchored behind it.
function reAnchorForRemoved(
  parentNode: GraphNode,
  item: GraphNode,
  index: number
): Record<string, string> {
  const target = placementTarget(item);
  if (target !== undefined) {
    return { after: target };
  }
  if (item.extraAttrs?.after !== undefined) {
    return { after: item.extraAttrs.after };
  }
  if (item.extraAttrs?.front === "true") {
    return { front: "true" };
  }
  const predecessor =
    index > 0 ? parentNode.children.get(index - 1) : undefined;
  return predecessor !== undefined ? { after: predecessor } : { front: "true" };
}

function repairDependentAnchors<T extends GraphPlan>(
  plan: T,
  parentNode: GraphNode,
  item: GraphNode,
  index: number
): T {
  const position = reAnchorForRemoved(parentNode, item, index);
  return parentNode.children.reduce((current, siblingId) => {
    const sibling = getWritableNode(current, siblingId);
    if (!sibling || sibling.extraAttrs?.after !== item.id) {
      return current;
    }
    return planUpsertNodes(current, {
      ...sibling,
      extraAttrs: { ...clearPosition(sibling.extraAttrs), ...position },
      updated: nextUpdated(sibling),
    });
  }, plan);
}

export function planRemoveNodeItemById<T extends GraphPlan>(
  plan: T,
  parentNodeId: ID,
  itemId: ID,
  preserveDescendants = false
): T {
  const parentNode = getWritableNode(plan, parentNodeId);
  if (!parentNode) {
    return plan;
  }
  const nodeIndex = getNodeItemIndex(parentNode, itemId);
  if (nodeIndex === undefined) {
    return plan;
  }
  const item = requireNodeItem(plan, parentNode, itemId);
  const repaired =
    item && !preserveDescendants
      ? repairDependentAnchors(plan, parentNode, item, nodeIndex)
      : plan;
  const withoutItem = planUpsertNodes(
    repaired,
    deleteNodes(parentNode, Set([nodeIndex]))
  );
  if (!item) {
    return withoutItem;
  }
  const sourceNode = getWorkspaceNode(withoutItem.knowledgeDBs, item.id);
  if (!sourceNode) {
    return withoutItem;
  }
  if (preserveDescendants) {
    return planMoveDescendantNodes(
      withoutItem,
      sourceNode,
      undefined,
      sourceNode.id
    );
  }
  return planDeleteNodes(
    planDeleteDescendantNodes(withoutItem, sourceNode),
    sourceNode.id
  );
}
