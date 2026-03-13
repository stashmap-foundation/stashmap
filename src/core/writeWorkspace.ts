import { loadWorkspaceGraph } from "./workspaceGraph";
import {
  normalizeArgumentInput,
  normalizeRelevanceInput,
  planInsertMarkdownUnderRelationById,
  planLinkRelationById,
  planMoveRelationItemById,
  planRemoveRelationItemById,
  planSetRelationTextById,
  planUpdateRelationItemMetadataById,
  requireRelationById,
  requireRelationItemIndexById,
  requireWritableRelationById,
  resolveInsertAtIndexById,
} from "../dataPlanner";
import { requireSingleRootMarkdownTree } from "../standaloneDocumentEvent";
import {
  buildKnowledgeDocumentEvents,
  createHeadlessPlan,
  getAffectedRootRelationIds,
} from "./headlessPlan";
import { GraphPlan } from "../planner";
import {
  isConcreteRefId,
  isSearchId,
  isRefNode,
  joinID,
  getRefTargetID,
  shortID,
} from "../connections";
import {
  loadWriteSecretKey,
  signUnsignedEvents,
  WriteProfile,
} from "./writeSupport";
import {
  applyKnowledgeEventsToWorkspace,
  loadOrCreateWorkspaceManifest,
} from "./workspaceState";
import { enqueuePendingWriteEntries } from "./pendingWrites";
import { relaysFromUrls, uniqueRelayUrls } from "../relayUtils";

export type WorkspaceWriteProfile = WriteProfile & {
  workspaceDir: string;
  knowstrHome?: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveOwnWriteId(
  pubkey: PublicKey,
  id: ID | undefined
): ID | undefined {
  if (!id || isConcreteRefId(id) || isSearchId(id as ID) || id.includes("_")) {
    return id;
  }
  return UUID_RE.test(id) ? joinID(pubkey, id) : id;
}

function resolveParentItemId(
  plan: GraphPlan,
  parentRelationId: LongID,
  pubkey: PublicKey,
  itemId: ID | undefined
): ID | undefined {
  if (!itemId) {
    return undefined;
  }

  const parentRelation = requireRelationById(plan, parentRelationId);
  const ownResolvedItemId = resolveOwnWriteId(pubkey, itemId);
  const candidates = parentRelation.children.reduce((acc, item) => {
    if (item.id === itemId || item.id === ownResolvedItemId) {
      return acc.includes(item.id) ? acc : [...acc, item.id];
    }

    const targetRelationId = isRefNode(item) ? getRefTargetID(item) : undefined;
    if (!targetRelationId) {
      return acc;
    }

    if (
      targetRelationId === itemId ||
      targetRelationId === ownResolvedItemId ||
      shortID(targetRelationId) === itemId
    ) {
      return acc.includes(item.id) ? acc : [...acc, item.id];
    }

    return acc;
  }, [] as Array<ID>);

  if (candidates.length === 1) {
    return candidates[0];
  }
  if (candidates.length > 1) {
    throw new Error(`Ambiguous item ID under parent: ${itemId}`);
  }

  return ownResolvedItemId;
}

async function publishWorkspaceMutation(
  profile: WorkspaceWriteProfile,
  relayUrls: string[] | undefined,
  mutate: (plan: GraphPlan) => {
    plan: GraphPlan;
    relationId?: LongID;
    itemId?: ID;
  }
): Promise<{
  relation_id?: LongID;
  item_id?: ID;
  affected_root_relation_ids: LongID[];
  event_ids: string[];
  pending_event_ids: string[];
  pending_count: number;
  relay_urls: string[];
}> {
  const graph = await loadWorkspaceGraph(profile.workspaceDir);
  const plan = createHeadlessPlan(profile.pubkey, graph.knowledgeDBs);
  const mutation = mutate(plan);
  const explicitRelayUrls =
    relayUrls && relayUrls.length > 0
      ? uniqueRelayUrls(relaysFromUrls(relayUrls))
      : undefined;
  const secretKey = await loadWriteSecretKey(profile);
  const unsignedEvents = buildKnowledgeDocumentEvents(mutation.plan);
  const signedEvents = signUnsignedEvents(secretKey, unsignedEvents);
  const workspaceManifest = await loadOrCreateWorkspaceManifest(
    profile.workspaceDir,
    profile.pubkey
  );
  await applyKnowledgeEventsToWorkspace(
    profile.workspaceDir,
    workspaceManifest,
    signedEvents
  );
  const pendingEntries = await enqueuePendingWriteEntries(
    profile.knowstrHome,
    signedEvents.map((event) => ({
      event,
      ...(explicitRelayUrls ? { relayUrls: explicitRelayUrls } : {}),
    }))
  );
  return {
    ...(mutation.relationId ? { relation_id: mutation.relationId } : {}),
    ...(mutation.itemId ? { item_id: mutation.itemId } : {}),
    affected_root_relation_ids: getAffectedRootRelationIds(mutation.plan),
    event_ids: signedEvents.map((event) => event.id),
    pending_event_ids: pendingEntries.map(({ event }) => event.id),
    pending_count: pendingEntries.length,
    relay_urls: explicitRelayUrls || [],
  };
}

export async function writeSetText(
  profile: WorkspaceWriteProfile,
  options: {
    relationId: ID;
    text: string;
    relayUrls?: string[];
  }
): Promise<Awaited<ReturnType<typeof publishWorkspaceMutation>>> {
  const relationId = resolveOwnWriteId(profile.pubkey, options.relationId);
  if (!relationId || relationId.startsWith("cref:")) {
    throw new Error(`Invalid relation ID: ${options.relationId}`);
  }
  return publishWorkspaceMutation(profile, options.relayUrls, (plan) => {
    requireWritableRelationById(plan, relationId as LongID);
    return {
      plan: planSetRelationTextById(plan, relationId as LongID, options.text),
      relationId: relationId as LongID,
    };
  });
}

export async function writeCreateUnder(
  profile: WorkspaceWriteProfile,
  options: {
    parentRelationId: ID;
    markdownText: string;
    beforeItemId?: ID;
    afterItemId?: ID;
    relevance?: "contains" | Relevance;
    argument?: "none" | Argument;
    relayUrls?: string[];
  }
): Promise<Awaited<ReturnType<typeof publishWorkspaceMutation>>> {
  const parentRelationId = resolveOwnWriteId(
    profile.pubkey,
    options.parentRelationId
  );
  if (!parentRelationId || parentRelationId.startsWith("cref:")) {
    throw new Error(`Invalid parent relation ID: ${options.parentRelationId}`);
  }
  const { beforeItemId, afterItemId } = options;
  return publishWorkspaceMutation(profile, options.relayUrls, (plan) => {
    requireWritableRelationById(plan, parentRelationId as LongID);
    const resolvedBeforeItemId = resolveParentItemId(
      plan,
      parentRelationId as LongID,
      profile.pubkey,
      beforeItemId
    );
    const resolvedAfterItemId = resolveParentItemId(
      plan,
      parentRelationId as LongID,
      profile.pubkey,
      afterItemId
    );
    const inserted = planInsertMarkdownUnderRelationById(
      plan,
      parentRelationId as LongID,
      [requireSingleRootMarkdownTree(options.markdownText)],
      resolveInsertAtIndexById(plan, parentRelationId as LongID, {
        ...(resolvedBeforeItemId ? { beforeItemId: resolvedBeforeItemId } : {}),
        ...(resolvedAfterItemId ? { afterItemId: resolvedAfterItemId } : {}),
      }),
      normalizeRelevanceInput(options.relevance || "contains"),
      normalizeArgumentInput(options.argument || "none")
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
  });
}

export async function writeLink(
  profile: WorkspaceWriteProfile,
  options: {
    parentRelationId: ID;
    targetRelationId: ID;
    beforeItemId?: ID;
    afterItemId?: ID;
    relevance?: "contains" | Relevance;
    argument?: "none" | Argument;
    relayUrls?: string[];
  }
): Promise<Awaited<ReturnType<typeof publishWorkspaceMutation>>> {
  const parentRelationId = resolveOwnWriteId(
    profile.pubkey,
    options.parentRelationId
  );
  const targetRelationId = resolveOwnWriteId(
    profile.pubkey,
    options.targetRelationId
  );
  if (!parentRelationId || parentRelationId.startsWith("cref:")) {
    throw new Error(`Invalid parent relation ID: ${options.parentRelationId}`);
  }
  if (!targetRelationId || targetRelationId.startsWith("cref:")) {
    throw new Error(`Invalid target relation ID: ${options.targetRelationId}`);
  }
  const { beforeItemId, afterItemId } = options;
  return publishWorkspaceMutation(profile, options.relayUrls, (plan) => {
    requireWritableRelationById(plan, parentRelationId as LongID);
    requireRelationById(plan, targetRelationId as LongID);
    const resolvedBeforeItemId = resolveParentItemId(
      plan,
      parentRelationId as LongID,
      profile.pubkey,
      beforeItemId
    );
    const resolvedAfterItemId = resolveParentItemId(
      plan,
      parentRelationId as LongID,
      profile.pubkey,
      afterItemId
    );
    const linked = planLinkRelationById(
      plan,
      parentRelationId as LongID,
      targetRelationId as LongID,
      resolveInsertAtIndexById(plan, parentRelationId as LongID, {
        ...(resolvedBeforeItemId ? { beforeItemId: resolvedBeforeItemId } : {}),
        ...(resolvedAfterItemId ? { afterItemId: resolvedAfterItemId } : {}),
      }),
      normalizeRelevanceInput(options.relevance || "contains"),
      normalizeArgumentInput(options.argument || "none")
    );
    return {
      plan: linked.plan,
      itemId: linked.itemId,
    };
  });
}

export async function writeSetRelevance(
  profile: WorkspaceWriteProfile,
  options: {
    parentRelationId: ID;
    itemId: ID;
    relevance: "contains" | Relevance;
    relayUrls?: string[];
  }
): Promise<Awaited<ReturnType<typeof publishWorkspaceMutation>>> {
  const parentRelationId = resolveOwnWriteId(
    profile.pubkey,
    options.parentRelationId
  );
  const { itemId } = options;
  if (!parentRelationId || parentRelationId.startsWith("cref:") || !itemId) {
    throw new Error("Invalid parent relation ID or item ID");
  }
  return publishWorkspaceMutation(profile, options.relayUrls, (plan) => {
    requireWritableRelationById(plan, parentRelationId as LongID);
    const resolvedItemId = resolveParentItemId(
      plan,
      parentRelationId as LongID,
      profile.pubkey,
      itemId
    );
    requireRelationItemIndexById(
      plan,
      parentRelationId as LongID,
      resolvedItemId as ID
    );
    return {
      plan: planUpdateRelationItemMetadataById(
        plan,
        parentRelationId as LongID,
        resolvedItemId as ID,
        {
          relevance: normalizeRelevanceInput(options.relevance),
        }
      ),
    };
  });
}

export async function writeSetArgument(
  profile: WorkspaceWriteProfile,
  options: {
    parentRelationId: ID;
    itemId: ID;
    argument: "none" | Argument;
    relayUrls?: string[];
  }
): Promise<Awaited<ReturnType<typeof publishWorkspaceMutation>>> {
  const parentRelationId = resolveOwnWriteId(
    profile.pubkey,
    options.parentRelationId
  );
  const { itemId } = options;
  if (!parentRelationId || parentRelationId.startsWith("cref:") || !itemId) {
    throw new Error("Invalid parent relation ID or item ID");
  }
  return publishWorkspaceMutation(profile, options.relayUrls, (plan) => {
    requireWritableRelationById(plan, parentRelationId as LongID);
    const resolvedItemId = resolveParentItemId(
      plan,
      parentRelationId as LongID,
      profile.pubkey,
      itemId
    );
    requireRelationItemIndexById(
      plan,
      parentRelationId as LongID,
      resolvedItemId as ID
    );
    return {
      plan: planUpdateRelationItemMetadataById(
        plan,
        parentRelationId as LongID,
        resolvedItemId as ID,
        {
          argument: normalizeArgumentInput(options.argument),
        }
      ),
    };
  });
}

export async function writeDeleteItem(
  profile: WorkspaceWriteProfile,
  options: {
    parentRelationId: ID;
    itemId: ID;
    relayUrls?: string[];
  }
): Promise<Awaited<ReturnType<typeof publishWorkspaceMutation>>> {
  const parentRelationId = resolveOwnWriteId(
    profile.pubkey,
    options.parentRelationId
  );
  const { itemId } = options;
  if (!parentRelationId || parentRelationId.startsWith("cref:") || !itemId) {
    throw new Error("Invalid parent relation ID or item ID");
  }
  return publishWorkspaceMutation(profile, options.relayUrls, (plan) => {
    requireWritableRelationById(plan, parentRelationId as LongID);
    const resolvedItemId = resolveParentItemId(
      plan,
      parentRelationId as LongID,
      profile.pubkey,
      itemId
    );
    requireRelationItemIndexById(
      plan,
      parentRelationId as LongID,
      resolvedItemId as ID
    );
    return {
      plan: planRemoveRelationItemById(
        plan,
        parentRelationId as LongID,
        resolvedItemId as ID
      ),
    };
  });
}

export async function writeMoveItem(
  profile: WorkspaceWriteProfile,
  options: {
    sourceParentRelationId: ID;
    itemId: ID;
    targetParentRelationId: ID;
    beforeItemId?: ID;
    afterItemId?: ID;
    relayUrls?: string[];
  }
): Promise<Awaited<ReturnType<typeof publishWorkspaceMutation>>> {
  const sourceParentRelationId = resolveOwnWriteId(
    profile.pubkey,
    options.sourceParentRelationId
  );
  const { itemId } = options;
  const targetParentRelationId = resolveOwnWriteId(
    profile.pubkey,
    options.targetParentRelationId
  );
  if (
    !sourceParentRelationId ||
    sourceParentRelationId.startsWith("cref:") ||
    !itemId ||
    !targetParentRelationId ||
    targetParentRelationId.startsWith("cref:")
  ) {
    throw new Error("Invalid source parent, target parent, or item ID");
  }
  const { beforeItemId, afterItemId } = options;
  return publishWorkspaceMutation(profile, options.relayUrls, (plan) => {
    requireWritableRelationById(plan, sourceParentRelationId as LongID);
    requireWritableRelationById(plan, targetParentRelationId as LongID);
    const resolvedItemId = resolveParentItemId(
      plan,
      sourceParentRelationId as LongID,
      profile.pubkey,
      itemId
    );
    const resolvedBeforeItemId = resolveParentItemId(
      plan,
      targetParentRelationId as LongID,
      profile.pubkey,
      beforeItemId
    );
    const resolvedAfterItemId = resolveParentItemId(
      plan,
      targetParentRelationId as LongID,
      profile.pubkey,
      afterItemId
    );
    requireRelationItemIndexById(
      plan,
      sourceParentRelationId as LongID,
      resolvedItemId as ID
    );
    return {
      plan: planMoveRelationItemById(
        plan,
        sourceParentRelationId as LongID,
        resolvedItemId as ID,
        targetParentRelationId as LongID,
        resolveInsertAtIndexById(plan, targetParentRelationId as LongID, {
          ...(resolvedBeforeItemId
            ? { beforeItemId: resolvedBeforeItemId }
            : {}),
          ...(resolvedAfterItemId ? { afterItemId: resolvedAfterItemId } : {}),
        })
      ),
    };
  });
}
