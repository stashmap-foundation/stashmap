import { inspectChildren, loadWorkspaceGraph } from "./workspaceGraph";
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

export async function inspectWorkspaceChildren(
  profile: Pick<WorkspaceWriteProfile, "workspaceDir" | "pubkey">,
  parentRelationId: LongID
): Promise<ReturnType<typeof inspectChildren>> {
  const graph = await loadWorkspaceGraph(profile.workspaceDir);
  return inspectChildren(graph, profile.pubkey, parentRelationId);
}

async function publishWorkspaceMutation(
  profile: WorkspaceWriteProfile,
  relayUrls: string[] | undefined,
  mutate: (plan: GraphPlan) => {
    plan: GraphPlan;
    relationId?: LongID;
    itemId?: LongID | ID;
  }
): Promise<{
  relation_id?: LongID;
  item_id?: LongID | ID;
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
    relationId: LongID;
    text: string;
    relayUrls?: string[];
  }
): Promise<Awaited<ReturnType<typeof publishWorkspaceMutation>>> {
  return publishWorkspaceMutation(profile, options.relayUrls, (plan) => {
    requireWritableRelationById(plan, options.relationId);
    return {
      plan: planSetRelationTextById(plan, options.relationId, options.text),
      relationId: options.relationId,
    };
  });
}

export async function writeCreateUnder(
  profile: WorkspaceWriteProfile,
  options: {
    parentRelationId: LongID;
    markdownText: string;
    beforeItemId?: LongID | ID;
    afterItemId?: LongID | ID;
    relevance?: "contains" | Relevance;
    argument?: "none" | Argument;
    relayUrls?: string[];
  }
): Promise<Awaited<ReturnType<typeof publishWorkspaceMutation>>> {
  return publishWorkspaceMutation(profile, options.relayUrls, (plan) => {
    requireWritableRelationById(plan, options.parentRelationId);
    const inserted = planInsertMarkdownUnderRelationById(
      plan,
      options.parentRelationId,
      [requireSingleRootMarkdownTree(options.markdownText)],
      resolveInsertAtIndexById(plan, options.parentRelationId, {
        ...(options.beforeItemId ? { beforeItemId: options.beforeItemId } : {}),
        ...(options.afterItemId ? { afterItemId: options.afterItemId } : {}),
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
    parentRelationId: LongID;
    targetRelationId: LongID;
    beforeItemId?: LongID | ID;
    afterItemId?: LongID | ID;
    relevance?: "contains" | Relevance;
    argument?: "none" | Argument;
    relayUrls?: string[];
  }
): Promise<Awaited<ReturnType<typeof publishWorkspaceMutation>>> {
  return publishWorkspaceMutation(profile, options.relayUrls, (plan) => {
    requireWritableRelationById(plan, options.parentRelationId);
    requireRelationById(plan, options.targetRelationId);
    const linked = planLinkRelationById(
      plan,
      options.parentRelationId,
      options.targetRelationId,
      resolveInsertAtIndexById(plan, options.parentRelationId, {
        ...(options.beforeItemId ? { beforeItemId: options.beforeItemId } : {}),
        ...(options.afterItemId ? { afterItemId: options.afterItemId } : {}),
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
    parentRelationId: LongID;
    itemId: LongID | ID;
    relevance: "contains" | Relevance;
    relayUrls?: string[];
  }
): Promise<Awaited<ReturnType<typeof publishWorkspaceMutation>>> {
  return publishWorkspaceMutation(profile, options.relayUrls, (plan) => {
    requireWritableRelationById(plan, options.parentRelationId);
    requireRelationItemIndexById(
      plan,
      options.parentRelationId,
      options.itemId
    );
    return {
      plan: planUpdateRelationItemMetadataById(
        plan,
        options.parentRelationId,
        options.itemId,
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
    parentRelationId: LongID;
    itemId: LongID | ID;
    argument: "none" | Argument;
    relayUrls?: string[];
  }
): Promise<Awaited<ReturnType<typeof publishWorkspaceMutation>>> {
  return publishWorkspaceMutation(profile, options.relayUrls, (plan) => {
    requireWritableRelationById(plan, options.parentRelationId);
    requireRelationItemIndexById(
      plan,
      options.parentRelationId,
      options.itemId
    );
    return {
      plan: planUpdateRelationItemMetadataById(
        plan,
        options.parentRelationId,
        options.itemId,
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
    parentRelationId: LongID;
    itemId: LongID | ID;
    relayUrls?: string[];
  }
): Promise<Awaited<ReturnType<typeof publishWorkspaceMutation>>> {
  return publishWorkspaceMutation(profile, options.relayUrls, (plan) => {
    requireWritableRelationById(plan, options.parentRelationId);
    requireRelationItemIndexById(
      plan,
      options.parentRelationId,
      options.itemId
    );
    return {
      plan: planRemoveRelationItemById(
        plan,
        options.parentRelationId,
        options.itemId
      ),
    };
  });
}

export async function writeMoveItem(
  profile: WorkspaceWriteProfile,
  options: {
    sourceParentRelationId: LongID;
    itemId: LongID | ID;
    targetParentRelationId: LongID;
    beforeItemId?: LongID | ID;
    afterItemId?: LongID | ID;
    relayUrls?: string[];
  }
): Promise<Awaited<ReturnType<typeof publishWorkspaceMutation>>> {
  return publishWorkspaceMutation(profile, options.relayUrls, (plan) => {
    requireWritableRelationById(plan, options.sourceParentRelationId);
    requireWritableRelationById(plan, options.targetParentRelationId);
    requireRelationItemIndexById(
      plan,
      options.sourceParentRelationId,
      options.itemId
    );
    return {
      plan: planMoveRelationItemById(
        plan,
        options.sourceParentRelationId,
        options.itemId,
        options.targetParentRelationId,
        resolveInsertAtIndexById(plan, options.targetParentRelationId, {
          ...(options.beforeItemId
            ? { beforeItemId: options.beforeItemId }
            : {}),
          ...(options.afterItemId ? { afterItemId: options.afterItemId } : {}),
        })
      ),
    };
  });
}
