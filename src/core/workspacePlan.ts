import { UnsignedEvent } from "nostr-tools";
import { createConcreteRefId, joinID } from "../connections";
import {
  buildKnowledgeDocumentEvents,
  createHeadlessPlan,
} from "./headlessPlan";
import { planInsertMarkdownTrees } from "../markdownPlan";
import {
  planDisconnectFromParent,
  planMoveNodeWithView,
} from "../treeMutations";
import { planUpdateExistingItemMetadata } from "../relationItemMutations";
import { Plan, planAddToParent, planUpdateRelationText } from "../planner";
import { requireSingleRootMarkdownTree } from "../standaloneDocumentEvent";
import { getRelationForView, getRelationIndex, ViewPath } from "../ViewContext";
import { WorkspaceGraph } from "./workspaceGraph";

type PositionOptions = {
  beforeItemId?: LongID | ID;
  afterItemId?: LongID | ID;
};

const CLI_PANE_INDEX = 0;
const CLI_STACK: ID[] = [];

function relationViewPath(relationId: LongID): ViewPath {
  return [CLI_PANE_INDEX, relationId];
}

function itemViewPath(parentRelationId: LongID, itemId: LongID | ID): ViewPath {
  return [CLI_PANE_INDEX, parentRelationId, itemId];
}

function requireRelation(plan: Plan, relationId: LongID): Relations {
  const relation = getRelationForView(
    plan,
    relationViewPath(relationId),
    CLI_STACK
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
  const relationIndex = getRelationIndex(
    plan,
    itemViewPath(parentRelationId, itemId)
  );
  if (relationIndex === undefined) {
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
    plan: planUpdateRelationText(
      plan,
      relationViewPath(relationId),
      CLI_STACK,
      text
    ),
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
  const inserted = planInsertMarkdownTrees(
    plan,
    [rootTree],
    relationViewPath(parentRelationId),
    CLI_STACK,
    resolveInsertAtIndex(plan, parentRelationId, position),
    normalizeRelevance(relevance),
    normalizeArgument(argument)
  );
  const relationId = inserted.topRelationIDs[0];
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
): { plan: Plan; itemId: LongID } {
  requireOwnedRelation(plan, parentRelationId);
  requireRelation(plan, targetRelationId);
  const itemId = createConcreteRefId(targetRelationId);
  const insertAtIndex = resolveInsertAtIndex(plan, parentRelationId, position);
  const [updatedPlan] = planAddToParent(
    plan,
    itemId,
    relationViewPath(parentRelationId),
    CLI_STACK,
    insertAtIndex,
    normalizeRelevance(relevance),
    normalizeArgument(argument)
  );
  return {
    plan: updatedPlan,
    itemId,
  };
}

export function applyWorkspaceSetRelevance(
  plan: Plan,
  parentRelationId: LongID,
  itemId: LongID | ID,
  relevance: "contains" | Relevance
): { plan: Plan } {
  requireOwnedRelation(plan, parentRelationId);
  const relationIndex = requireItemIndex(plan, parentRelationId, itemId);
  return {
    plan: planUpdateExistingItemMetadata(
      plan,
      relationViewPath(parentRelationId),
      CLI_STACK,
      relationIndex,
      {
        relevance: normalizeRelevance(relevance),
      }
    ),
  };
}

export function applyWorkspaceSetArgument(
  plan: Plan,
  parentRelationId: LongID,
  itemId: LongID | ID,
  argument: "none" | Argument
): { plan: Plan } {
  requireOwnedRelation(plan, parentRelationId);
  const relationIndex = requireItemIndex(plan, parentRelationId, itemId);
  return {
    plan: planUpdateExistingItemMetadata(
      plan,
      relationViewPath(parentRelationId),
      CLI_STACK,
      relationIndex,
      {
        argument: normalizeArgument(argument),
      }
    ),
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
    plan: planDisconnectFromParent(
      plan,
      itemViewPath(parentRelationId, itemId),
      CLI_STACK
    ),
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
    plan: planMoveNodeWithView(
      plan,
      itemViewPath(sourceParentRelationId, itemId),
      relationViewPath(targetParentRelationId),
      CLI_STACK,
      insertAtIndex
    ),
  };
}
