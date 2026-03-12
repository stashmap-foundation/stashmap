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
  shortID,
} from "./connections";
import { MarkdownTreeNode } from "./markdownTree";
import { planInsertMarkdownTreesByParentId } from "./markdownPlan";
import {
  GraphPlan,
  planAddTargetsToRelation,
  planDeleteDescendantRelations,
  planDeleteRelations,
  planMoveDescendantRelations,
  planUpsertRelations,
} from "./planner";
import {
  RelationItemMetadata,
  updateRelationItemMetadata,
} from "./relationItemMetadata";
import { withUsersEntryPublicKey } from "./userEntry";

export type RelationItemPosition = {
  beforeItemId?: LongID | ID;
  afterItemId?: LongID | ID;
};

function getWritableRelation(
  plan: GraphPlan,
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

export function requireRelationById(
  plan: GraphPlan,
  relationId: LongID
): Relations {
  const relation = getRelationsNoReferencedBy(
    plan.knowledgeDBs,
    relationId,
    plan.user.publicKey
  );
  if (!relation) {
    throw new Error(`Relation not found: ${relationId}`);
  }
  return relation;
}

export function requireWritableRelationById(
  plan: GraphPlan,
  relationId: LongID
): Relations {
  const relation = requireRelationById(plan, relationId);
  if (relation.author !== plan.user.publicKey) {
    throw new Error(`Relation is not writable: ${relationId}`);
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

export function requireRelationItemIndexById(
  plan: GraphPlan,
  parentRelationId: LongID,
  itemId: LongID | ID
): number {
  const relationIndex = requireWritableRelationById(
    plan,
    parentRelationId
  ).items.findIndex((item) => item.id === itemId);
  if (relationIndex < 0) {
    throw new Error(`Item not found: ${itemId}`);
  }
  return relationIndex;
}

export function normalizeRelevanceInput(
  value: "contains" | Relevance
): Relevance {
  return value === "contains" ? undefined : value;
}

export function normalizeArgumentInput(value: "none" | Argument): Argument {
  return value === "none" ? undefined : value;
}

export function resolveInsertAtIndexById(
  plan: GraphPlan,
  parentRelationId: LongID,
  position: RelationItemPosition
): number {
  if (position.beforeItemId && position.afterItemId) {
    throw new Error("Provide only one of --before or --after");
  }
  const parentRelation = requireWritableRelationById(plan, parentRelationId);
  if (position.beforeItemId) {
    const index = parentRelation.items.findIndex(
      (item) => item.id === position.beforeItemId
    );
    if (index < 0) {
      throw new Error(`Sibling item not found: ${position.beforeItemId}`);
    }
    return index;
  }
  if (position.afterItemId) {
    const index = parentRelation.items.findIndex(
      (item) => item.id === position.afterItemId
    );
    if (index < 0) {
      throw new Error(`Sibling item not found: ${position.afterItemId}`);
    }
    return index + 1;
  }
  return parentRelation.items.size;
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

export function planSetRelationTextById<T extends GraphPlan>(
  plan: T,
  relationId: LongID,
  text: string
): T {
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

export function planUpdateRelationItemMetadataById<T extends GraphPlan>(
  plan: T,
  parentRelationId: LongID,
  itemId: LongID | ID,
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
  return planUpsertRelations(
    plan,
    updateRelationItemMetadata(parentRelation, relationIndex, metadata)
  );
}

export function planLinkRelationById<T extends GraphPlan>(
  plan: T,
  parentRelationId: LongID,
  targetRelationId: LongID,
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): { plan: T; itemId: LongID | ID } {
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

export function planInsertMarkdownUnderRelationById<T extends GraphPlan>(
  plan: T,
  parentRelationId: LongID,
  trees: MarkdownTreeNode[],
  insertAtIndex?: number,
  relevance?: Relevance,
  argument?: Argument
): { plan: T; relationId?: LongID } {
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

export function planRemoveRelationItemById<T extends GraphPlan>(
  plan: T,
  parentRelationId: LongID,
  itemId: LongID | ID,
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
  if (preserveDescendants) {
    return planMoveDescendantRelations(
      withoutItem,
      sourceRelation,
      getRelationContext(withoutItem.knowledgeDBs, sourceRelation),
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

function wouldCreateDescendantCycle(
  plan: GraphPlan,
  sourceRelationId: LongID,
  targetParentRelationId: LongID,
  seen: ReadonlySet<LongID> = new globalThis.Set<LongID>()
): boolean {
  if (sourceRelationId === targetParentRelationId) {
    return true;
  }

  const currentRelation = getRelationsNoReferencedBy(
    plan.knowledgeDBs,
    targetParentRelationId,
    plan.user.publicKey
  );
  if (!currentRelation || seen.has(currentRelation.id)) {
    return false;
  }
  if (currentRelation.id === sourceRelationId) {
    return true;
  }
  if (!currentRelation.parent) {
    return false;
  }
  const nextSeen = new globalThis.Set<LongID>(seen);
  nextSeen.add(currentRelation.id);
  return wouldCreateDescendantCycle(
    plan,
    sourceRelationId,
    currentRelation.parent,
    nextSeen
  );
}

export function planMoveRelationItemById<T extends GraphPlan>(
  plan: T,
  sourceParentRelationId: LongID,
  itemId: LongID | ID,
  targetParentRelationId: LongID,
  insertAtIndex?: number
): T {
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
  if (
    !isRefId(sourceItem.id) &&
    !isSearchId(sourceItem.id as ID) &&
    wouldCreateDescendantCycle(
      plan,
      sourceItem.id as LongID,
      targetParentRelationId
    )
  ) {
    throw new Error(
      `Cannot move relation ${sourceItem.id} under its own descendant ${targetParentRelationId}`
    );
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
