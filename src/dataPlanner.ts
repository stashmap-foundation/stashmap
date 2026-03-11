import { Set } from "immutable";
import {
  createConcreteRefId,
  deleteRelations,
  getRelationContext,
  getRelationSemanticID,
  getRelationsNoReferencedBy,
  hashText,
  isRefId,
  isSearchId,
  moveRelations,
} from "./connections";
import { MarkdownTreeNode } from "./markdownTree";
import { planInsertMarkdownTreesByParentId } from "./markdownPlan";
import {
  Plan,
  planAddTargetsToRelation,
  planDeleteDescendantRelations,
  planDeleteRelations,
  planMoveDescendantRelations,
  planUpsertRelations,
} from "./planner";
import {
  RelationItemMetadata,
  updateRelationItemMetadata,
} from "./relationItemMutations";
import { withUsersEntryPublicKey } from "./userEntry";

function getWritableRelation(
  plan: Plan,
  relationId: LongID
): Relations | undefined {
  const relation = getRelationsNoReferencedBy(
    plan.knowledgeDBs,
    relationId,
    plan.user.publicKey
  );
  if (!relation || relation.author !== plan.user.publicKey) {
    return undefined;
  }
  return relation;
}

function getRelationItemIndex(
  relation: Relations,
  itemId: LongID | ID
): number | undefined {
  const index = relation.items.findIndex((item) => item.id === itemId);
  return index >= 0 ? index : undefined;
}

function requireRelationItem(
  relation: Relations,
  itemId: LongID | ID
): RelationItem | undefined {
  const index = getRelationItemIndex(relation, itemId);
  return index === undefined ? undefined : relation.items.get(index);
}

function insertRelationItem(
  relation: Relations,
  item: RelationItem,
  insertAtIndex?: number
): Relations {
  const defaultIndex = relation.items.size;
  const updatedWithPush = {
    ...relation,
    items: relation.items.push(item),
  };
  return insertAtIndex === undefined || insertAtIndex === defaultIndex
    ? updatedWithPush
    : moveRelations(updatedWithPush, [defaultIndex], insertAtIndex);
}

export function planSetRelationTextById(
  plan: Plan,
  relationId: LongID,
  text: string
): Plan {
  const currentRelation = getWritableRelation(plan, relationId);
  if (!currentRelation || currentRelation.text === text) {
    return plan;
  }
  return planUpsertRelations(
    plan,
    withUsersEntryPublicKey({
      ...currentRelation,
      text,
      textHash: hashText(text),
      updated: Date.now(),
    })
  );
}

export function planUpdateRelationItemMetadataById(
  plan: Plan,
  parentRelationId: LongID,
  itemId: LongID | ID,
  metadata: RelationItemMetadata
): Plan {
  const parentRelation = getWritableRelation(plan, parentRelationId);
  if (!parentRelation) {
    return plan;
  }
  const relationIndex = getRelationItemIndex(parentRelation, itemId);
  if (relationIndex === undefined) {
    return plan;
  }
  return planUpsertRelations(
    plan,
    updateRelationItemMetadata(parentRelation, relationIndex, metadata)
  );
}

export function planLinkRelationById(
  plan: Plan,
  parentRelationId: LongID,
  targetRelationId: LongID,
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): { plan: Plan; itemId: LongID | ID } {
  const parentRelation = getWritableRelation(plan, parentRelationId);
  const targetRelation = getRelationsNoReferencedBy(
    plan.knowledgeDBs,
    targetRelationId,
    plan.user.publicKey
  );
  if (!parentRelation || !targetRelation) {
    return {
      plan,
      itemId: createConcreteRefId(targetRelationId),
    };
  }
  const itemId = createConcreteRefId(targetRelation.id);
  const [nextPlan] = planAddTargetsToRelation(
    plan,
    parentRelation,
    itemId,
    insertAtIndex,
    relevance,
    argument
  );
  return {
    plan: nextPlan,
    itemId,
  };
}

export function planInsertMarkdownUnderRelationById(
  plan: Plan,
  parentRelationId: LongID,
  trees: MarkdownTreeNode[],
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): { plan: Plan; relationId?: LongID } {
  const inserted = planInsertMarkdownTreesByParentId(
    plan,
    trees,
    parentRelationId,
    insertAtIndex,
    relevance,
    argument
  );
  return {
    plan: inserted.plan,
    relationId: inserted.topRelationIDs[0],
  };
}

export function planRemoveRelationItemById(
  plan: Plan,
  parentRelationId: LongID,
  itemId: LongID | ID
): Plan {
  const parentRelation = getWritableRelation(plan, parentRelationId);
  if (!parentRelation) {
    return plan;
  }
  const relationIndex = getRelationItemIndex(parentRelation, itemId);
  if (relationIndex === undefined) {
    return plan;
  }
  const item = requireRelationItem(parentRelation, itemId);
  const withoutItem = planUpsertRelations(
    plan,
    deleteRelations(parentRelation, Set([relationIndex]))
  );
  if (!item || isRefId(item.id)) {
    return withoutItem;
  }
  const sourceRelation = getRelationsNoReferencedBy(
    withoutItem.knowledgeDBs,
    item.id,
    withoutItem.user.publicKey
  );
  if (!sourceRelation) {
    return withoutItem;
  }
  return planDeleteRelations(
    planDeleteDescendantRelations(withoutItem, sourceRelation),
    sourceRelation.id
  );
}

export function planMoveRelationItemById(
  plan: Plan,
  sourceParentRelationId: LongID,
  itemId: LongID | ID,
  targetParentRelationId: LongID,
  insertAtIndex?: number
): Plan {
  const sourceParentRelation = getWritableRelation(
    plan,
    sourceParentRelationId
  );
  const targetParentRelation = getWritableRelation(
    plan,
    targetParentRelationId
  );
  if (!sourceParentRelation || !targetParentRelation) {
    return plan;
  }
  const sourceIndex = getRelationItemIndex(sourceParentRelation, itemId);
  if (sourceIndex === undefined) {
    return plan;
  }
  if (sourceParentRelation.id === targetParentRelation.id) {
    return planUpsertRelations(
      plan,
      moveRelations(
        sourceParentRelation,
        [sourceIndex],
        insertAtIndex ?? sourceParentRelation.items.size
      )
    );
  }

  const sourceItem = requireRelationItem(sourceParentRelation, itemId);
  if (!sourceItem) {
    return plan;
  }

  const withoutSource = planUpsertRelations(
    plan,
    deleteRelations(sourceParentRelation, Set([sourceIndex]))
  );
  const writableTargetParent = getWritableRelation(
    withoutSource,
    targetParentRelationId
  );
  if (!writableTargetParent) {
    return withoutSource;
  }
  const withMovedEdge = planUpsertRelations(
    withoutSource,
    insertRelationItem(writableTargetParent, sourceItem, insertAtIndex)
  );

  if (isRefId(sourceItem.id) || isSearchId(sourceItem.id as ID)) {
    return withMovedEdge;
  }

  const sourceRelation = getRelationsNoReferencedBy(
    withMovedEdge.knowledgeDBs,
    sourceItem.id,
    withMovedEdge.user.publicKey
  );
  if (!sourceRelation) {
    return withMovedEdge;
  }

  const targetSemanticContext = getRelationContext(
    withMovedEdge.knowledgeDBs,
    writableTargetParent
  ).push(getRelationSemanticID(writableTargetParent));
  return planMoveDescendantRelations(
    withMovedEdge,
    sourceRelation,
    targetSemanticContext,
    writableTargetParent.id,
    undefined,
    writableTargetParent.root
  );
}
