import { Set } from "immutable";
import {
  deleteRelations,
  getNodeContext,
  getNode,
  isRefNode,
  shortID,
} from "./connections";
import {
  GraphPlan,
  planDeleteDescendantRelations,
  planDeleteRelations,
  planMoveDescendantRelations,
  planUpsertRelations,
} from "./planner";
import {
  RelationItemMetadata,
  updateRelationItemMetadata,
} from "./relationItemMetadata";

function getWritableRelation(
  plan: GraphPlan,
  relationId: LongID
): GraphNode | undefined {
  const relation = getNode(plan.knowledgeDBs, relationId, plan.user.publicKey);
  if (!relation || relation.author !== plan.user.publicKey) {
    return undefined;
  }
  return relation;
}

function getRelationItemIndex(
  relation: GraphNode,
  itemId: ID
): number | undefined {
  const index = relation.children.findIndex((childID) => childID === itemId);
  return index >= 0 ? index : undefined;
}

function requireRelationItem(
  plan: GraphPlan,
  relation: GraphNode,
  itemId: ID
): GraphNode | undefined {
  const index = getRelationItemIndex(relation, itemId);
  const childID =
    index === undefined ? undefined : relation.children.get(index);
  return childID
    ? getNode(plan.knowledgeDBs, childID, plan.user.publicKey)
    : undefined;
}

export function planUpdateRelationItemMetadataById<T extends GraphPlan>(
  plan: T,
  parentRelationId: LongID,
  itemId: ID,
  metadata: RelationItemMetadata
): T {
  const parentRelation = getWritableRelation(plan, parentRelationId);
  if (!parentRelation) {
    return plan;
  }
  const relationIndex = getRelationItemIndex(parentRelation, itemId);
  if (relationIndex === undefined) {
    return plan;
  }
  const item = requireRelationItem(plan, parentRelation, itemId);
  return item
    ? planUpsertRelations(plan, updateRelationItemMetadata(item, metadata))
    : plan;
}

export function planRemoveRelationItemById<T extends GraphPlan>(
  plan: T,
  parentRelationId: LongID,
  itemId: ID,
  preserveDescendants = false
): T {
  const parentRelation = getWritableRelation(plan, parentRelationId);
  if (!parentRelation) {
    return plan;
  }
  const relationIndex = getRelationItemIndex(parentRelation, itemId);
  if (relationIndex === undefined) {
    return plan;
  }
  const item = requireRelationItem(plan, parentRelation, itemId);
  const withoutItem = planUpsertRelations(
    plan,
    deleteRelations(parentRelation, Set([relationIndex]))
  );
  if (!item || isRefNode(item)) {
    return withoutItem;
  }
  const sourceRelation = getNode(
    withoutItem.knowledgeDBs,
    item.id,
    withoutItem.user.publicKey
  );
  if (!sourceRelation) {
    return withoutItem;
  }
  if (preserveDescendants) {
    return planMoveDescendantRelations(
      withoutItem,
      sourceRelation,
      getNodeContext(withoutItem.knowledgeDBs, sourceRelation),
      undefined,
      undefined,
      shortID(sourceRelation.id)
    );
  }
  return planDeleteRelations(
    planDeleteDescendantRelations(withoutItem, sourceRelation),
    sourceRelation.id
  );
}
