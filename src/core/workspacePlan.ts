import { UnsignedEvent } from "nostr-tools";
import { getRelationsNoReferencedBy, joinID } from "../connections";
import {
  planInsertMarkdownUnderRelationById,
  planLinkRelationById,
  planMoveRelationItemById,
  planRemoveRelationItemById,
  planSetRelationTextById,
  planUpdateRelationItemMetadataById,
} from "../dataPlanner";
import {
  buildKnowledgeDocumentEvents,
  createHeadlessPlan,
} from "./headlessPlan";
import { Plan } from "../planner";
import { requireSingleRootMarkdownTree } from "../standaloneDocumentEvent";
import { WorkspaceGraph } from "./workspaceGraph";

type PositionOptions = {
  beforeItemId?: LongID | ID;
  afterItemId?: LongID | ID;
};

function requireRelation(plan: Plan, relationId: LongID): Relations {
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

function requireOwnedRelation(plan: Plan, relationId: LongID): Relations {
  const relation = requireRelation(plan, relationId);
  if (relation.author !== plan.user.publicKey) {
    throw new Error(`Relation is not writable: ${relationId}`);
  }
  return relation;
}

function requireItemIndex(
  plan: Plan,
  parentRelationId: LongID,
  itemId: LongID | ID
): number {
  const relationIndex = requireOwnedRelation(
    plan,
    parentRelationId
  ).items.findIndex((item) => item.id === itemId);
  if (relationIndex < 0) {
    throw new Error(`Item not found: ${itemId}`);
  }
  return relationIndex;
}

function normalizeRelevance(value: "contains" | Relevance): Relevance {
  return value === "contains" ? undefined : value;
}

function normalizeArgument(value: "none" | Argument): Argument {
  return value === "none" ? undefined : value;
}

function resolveInsertAtIndex(
  plan: Plan,
  parentRelationId: LongID,
  position: PositionOptions
): number {
  if (position.beforeItemId && position.afterItemId) {
    throw new Error("Provide only one of --before or --after");
  }
  const parentRelation = requireOwnedRelation(plan, parentRelationId);
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

export function createWorkspacePlan(
  graph: WorkspaceGraph,
  viewer: PublicKey
): Plan {
  return createHeadlessPlan(viewer, graph.knowledgeDBs);
}

export function getAffectedRootRelationIds(plan: Plan): LongID[] {
  return plan.affectedRoots
    .toArray()
    .map((rootId) => joinID(plan.user.publicKey, rootId));
}

export function buildWorkspacePlanDocumentEvents(plan: Plan): UnsignedEvent[] {
  return buildKnowledgeDocumentEvents(plan);
}

export function applyWorkspaceSetText(
  plan: Plan,
  relationId: LongID,
  text: string
): { plan: Plan; relationId: LongID } {
  requireOwnedRelation(plan, relationId);
  return {
    plan: planSetRelationTextById(plan, relationId, text),
    relationId,
  };
}

export function applyWorkspaceCreateUnder(
  plan: Plan,
  parentRelationId: LongID,
  markdownText: string,
  position: PositionOptions,
  relevance: "contains" | Relevance = "contains",
  argument: "none" | Argument = "none"
): { plan: Plan; relationId: LongID } {
  requireOwnedRelation(plan, parentRelationId);
  const rootTree = requireSingleRootMarkdownTree(markdownText);
  const inserted = planInsertMarkdownUnderRelationById(
    plan,
    parentRelationId,
    [rootTree],
    resolveInsertAtIndex(plan, parentRelationId, position),
    normalizeRelevance(relevance),
    normalizeArgument(argument)
  );
  const { relationId } = inserted;
  if (!relationId) {
    throw new Error(
      "stdin markdown must resolve to exactly one top-level root"
    );
  }
  return {
    plan: inserted.plan,
    relationId,
  };
}

export function applyWorkspaceLink(
  plan: Plan,
  parentRelationId: LongID,
  targetRelationId: LongID,
  position: PositionOptions,
  relevance: "contains" | Relevance = "contains",
  argument: "none" | Argument = "none"
): { plan: Plan; itemId: LongID | ID } {
  requireOwnedRelation(plan, parentRelationId);
  requireRelation(plan, targetRelationId);
  const linked = planLinkRelationById(
    plan,
    parentRelationId,
    targetRelationId,
    resolveInsertAtIndex(plan, parentRelationId, position),
    normalizeRelevance(relevance),
    normalizeArgument(argument)
  );
  return {
    plan: linked.plan,
    itemId: linked.itemId,
  };
}

export function applyWorkspaceSetRelevance(
  plan: Plan,
  parentRelationId: LongID,
  itemId: LongID | ID,
  relevance: "contains" | Relevance
): { plan: Plan } {
  requireOwnedRelation(plan, parentRelationId);
  requireItemIndex(plan, parentRelationId, itemId);
  return {
    plan: planUpdateRelationItemMetadataById(plan, parentRelationId, itemId, {
      relevance: normalizeRelevance(relevance),
    }),
  };
}

export function applyWorkspaceSetArgument(
  plan: Plan,
  parentRelationId: LongID,
  itemId: LongID | ID,
  argument: "none" | Argument
): { plan: Plan } {
  requireOwnedRelation(plan, parentRelationId);
  requireItemIndex(plan, parentRelationId, itemId);
  return {
    plan: planUpdateRelationItemMetadataById(plan, parentRelationId, itemId, {
      argument: normalizeArgument(argument),
    }),
  };
}

export function applyWorkspaceRemoveItem(
  plan: Plan,
  parentRelationId: LongID,
  itemId: LongID | ID
): { plan: Plan } {
  requireOwnedRelation(plan, parentRelationId);
  requireItemIndex(plan, parentRelationId, itemId);
  return {
    plan: planRemoveRelationItemById(plan, parentRelationId, itemId),
  };
}

export function applyWorkspaceMoveItem(
  plan: Plan,
  sourceParentRelationId: LongID,
  itemId: LongID | ID,
  targetParentRelationId: LongID,
  position: PositionOptions
): { plan: Plan } {
  requireOwnedRelation(plan, sourceParentRelationId);
  requireOwnedRelation(plan, targetParentRelationId);
  requireItemIndex(plan, sourceParentRelationId, itemId);
  const insertAtIndex = resolveInsertAtIndex(
    plan,
    targetParentRelationId,
    position
  );
  return {
    plan: planMoveRelationItemById(
      plan,
      sourceParentRelationId,
      itemId,
      targetParentRelationId,
      insertAtIndex
    ),
  };
}
