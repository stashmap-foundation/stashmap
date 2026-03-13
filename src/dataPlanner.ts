import { Set } from "immutable";
import {
  deleteRelations,
  getRelationContext,
  getRelationSemanticID,
  getRelationsNoReferencedBy,
  isRefNode,
  isSearchId,
  moveRelations,
  shortID,
} from "./connections";
import { MarkdownTreeNode } from "./markdownTree";
import { planInsertMarkdownTreesByParentId } from "./markdownPlan";
import {
  GraphPlan,
  planCopyDescendantRelations,
  planDeleteDescendantRelations,
  planDeleteRelations,
  planMoveDescendantRelations,
  planUpsertRelations,
} from "./planner";
import { newRefNode } from "./relationFactory";
import {
  RelationItemMetadata,
  updateRelationItemMetadata,
} from "./relationItemMetadata";
import { withUsersEntryPublicKey } from "./userEntry";

export type RelationItemPosition = {
  beforeItemId?: ID;
  afterItemId?: ID;
};

function getWritableRelation(
  plan: GraphPlan,
  relationId: LongID
): GraphNode | undefined {
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
): GraphNode {
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
): GraphNode {
  const relation = requireRelationById(plan, relationId);
  if (relation.author !== plan.user.publicKey) {
    throw new Error(`Relation is not writable: ${relationId}`);
  }
  return relation;
}

function getRelationItemIndex(
  relation: GraphNode,
  itemId: ID
): number | undefined {
  const index = relation.children.findIndex((item) => item.id === itemId);
  return index >= 0 ? index : undefined;
}

function requireRelationItem(
  relation: GraphNode,
  itemId: ID
): GraphNode | undefined {
  const index = getRelationItemIndex(relation, itemId);
  return index === undefined ? undefined : relation.children.get(index);
}

export function requireRelationItemIndexById(
  plan: GraphPlan,
  parentRelationId: LongID,
  itemId: ID
): number {
  const relationIndex = requireWritableRelationById(
    plan,
    parentRelationId
  ).children.findIndex((item) => item.id === itemId);
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
    const index = parentRelation.children.findIndex(
      (item) => item.id === position.beforeItemId
    );
    if (index < 0) {
      throw new Error(`Sibling item not found: ${position.beforeItemId}`);
    }
    return index;
  }
  if (position.afterItemId) {
    const index = parentRelation.children.findIndex(
      (item) => item.id === position.afterItemId
    );
    if (index < 0) {
      throw new Error(`Sibling item not found: ${position.afterItemId}`);
    }
    return index + 1;
  }
  return parentRelation.children.size;
}

function insertRelationItem(
  relation: GraphNode,
  item: GraphNode,
  insertAtIndex?: number
): GraphNode {
  const defaultIndex = relation.children.size;
  const updatedWithPush = {
    ...relation,
    children: relation.children.push(item),
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
      updated: Date.now(),
    })
  );
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
): { plan: T; itemId: ID } {
  const parentRelation = getWritableRelation(plan, parentRelationId);
  const targetRelation = getRelationsNoReferencedBy(
    plan.knowledgeDBs,
    targetRelationId,
    plan.user.publicKey
  );
  if (!parentRelation || !targetRelation) {
    return {
      plan,
      itemId: targetRelationId,
    };
  }
  const refNode = newRefNode(
    plan.user.publicKey,
    parentRelation.root,
    targetRelation.id,
    parentRelation.id,
    relevance,
    argument,
    "",
    targetRelation.text
  );
  const nextPlan = planUpsertRelations(
    plan,
    insertRelationItem(parentRelation, refNode, insertAtIndex)
  );
  return {
    plan: nextPlan,
    itemId: refNode.id,
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

export function planCopyRootById<T extends GraphPlan>(
  plan: T,
  sourceRelationId: LongID
): { plan: T; relationId?: LongID } {
  const sourceRelation = requireRelationById(plan, sourceRelationId);
  if (sourceRelation.parent) {
    throw new Error(`Relation is not a root: ${sourceRelationId}`);
  }
  const [copiedPlan, mapping] = planCopyDescendantRelations(
    plan,
    sourceRelation,
    (relation) => getRelationContext(plan.knowledgeDBs, relation),
    (relation) => relation.author === sourceRelation.author
  );

  return {
    plan: copiedPlan as T,
    relationId: mapping.get(sourceRelation.id),
  };
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
  const item = requireRelationItem(parentRelation, itemId);
  const withoutItem = planUpsertRelations(
    plan,
    deleteRelations(parentRelation, Set([relationIndex]))
  );
  if (!item || isRefNode(item)) {
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
  itemId: ID,
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
        insertAtIndex ?? sourceParentRelation.children.size
      )
    );
  }

  const sourceItem = requireRelationItem(sourceParentRelation, itemId);
  if (!sourceItem) {
    return plan;
  }
  if (
    !isRefNode(sourceItem) &&
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

  if (isRefNode(sourceItem) || isSearchId(sourceItem.id as ID)) {
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
