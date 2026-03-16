import { Set } from "immutable";
import {
  deleteNodes,
  getNodeContext,
  getNode,
  isRefNode,
  shortID,
} from "./connections";
import {
  GraphPlan,
  planDeleteDescendantNodes,
  planDeleteNodes,
  planMoveDescendantNodes,
  planUpsertNodes,
} from "./planner";
import { NodeItemMetadata, updateNodeItemMetadata } from "./nodeItemMetadata";

function getWritableNode(
  plan: GraphPlan,
  nodeId: LongID
): GraphNode | undefined {
  const node = getNode(plan.knowledgeDBs, nodeId, plan.user.publicKey);
  if (!node || node.author !== plan.user.publicKey) {
    return undefined;
  }
  return node;
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
  return childID
    ? getNode(plan.knowledgeDBs, childID, plan.user.publicKey)
    : undefined;
}

export function planUpdateNodeItemMetadataById<T extends GraphPlan>(
  plan: T,
  parentNodeId: LongID,
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
  parentNodeId: LongID,
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
  const sourceNode = getNode(
    withoutItem.knowledgeDBs,
    item.id,
    withoutItem.user.publicKey
  );
  if (!sourceNode) {
    return withoutItem;
  }
  if (preserveDescendants) {
    return planMoveDescendantNodes(
      withoutItem,
      sourceNode,
      getNodeContext(withoutItem.knowledgeDBs, sourceNode),
      undefined,
      undefined,
      shortID(sourceNode.id)
    );
  }
  return planDeleteNodes(
    planDeleteDescendantNodes(withoutItem, sourceNode),
    sourceNode.id
  );
}
