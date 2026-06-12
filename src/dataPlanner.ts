import { Set } from "immutable";
import { LOCAL } from "./core/nodeRef";
import { deleteNodes, getNode, isRefNode } from "./core/connections";
import {
  GraphPlan,
  planDeleteDescendantNodes,
  planDeleteNodes,
  planMoveDescendantNodes,
  planUpsertNodes,
} from "./planner";
import { NodeItemMetadata, updateNodeItemMetadata } from "./nodeItemMetadata";

function getWritableNode(plan: GraphPlan, nodeId: ID): GraphNode | undefined {
  return getNode(plan.knowledgeDBs, nodeId, LOCAL);
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
  return childID ? getNode(plan.knowledgeDBs, childID, LOCAL) : undefined;
}

export function planUpdateNodeItemMetadataById<T extends GraphPlan>(
  plan: T,
  parentNodeId: ID,
  itemId: ID,
  metadata: NodeItemMetadata
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
  return item
    ? planUpsertNodes(plan, updateNodeItemMetadata(item, metadata))
    : plan;
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
  const withoutItem = planUpsertNodes(
    plan,
    deleteNodes(parentNode, Set([nodeIndex]))
  );
  if (!item || isRefNode(item)) {
    return withoutItem;
  }
  const sourceNode = getNode(withoutItem.knowledgeDBs, item.id, LOCAL);
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
