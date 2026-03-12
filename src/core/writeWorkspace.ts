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
import { Plan } from "../planner";
import {
  loadWriteSecretKey,
  publishUnsignedEvents,
  resolveWriteRelayUrls,
  WriteProfile,
  WritePublisher,
} from "./writeSupport";

export type WorkspaceWriteProfile = WriteProfile & {
  workspaceDir: string;
};

export async function inspectWorkspaceChildren(
  profile: Pick<WorkspaceWriteProfile, "workspaceDir" | "pubkey">,
  parentRelationId: LongID
): Promise<ReturnType<typeof inspectChildren>> {
  const graph = await loadWorkspaceGraph(profile.workspaceDir);
  return inspectChildren(graph, profile.pubkey, parentRelationId);
}

async function publishWorkspaceMutation(
  publisher: WritePublisher,
  profile: WorkspaceWriteProfile,
  relayUrls: string[] | undefined,
  mutate: (plan: Plan) => {
    plan: Plan;
    relationId?: LongID;
    itemId?: LongID | ID;
  }
): Promise<{
  relation_id?: LongID;
  item_id?: LongID | ID;
  affected_root_relation_ids: LongID[];
  relay_urls: string[];
  event_ids: string[];
  publish_results: Record<string, Record<string, PublishStatus>>;
}> {
  const graph = await loadWorkspaceGraph(profile.workspaceDir);
  const plan = createHeadlessPlan(profile.pubkey, graph.knowledgeDBs);
  const mutation = mutate(plan);
  const writeRelayUrls = resolveWriteRelayUrls(profile, relayUrls);
  const secretKey = await loadWriteSecretKey(profile);
  const unsignedEvents = buildKnowledgeDocumentEvents(mutation.plan);
  const published = await publishUnsignedEvents(
    publisher,
    secretKey,
    writeRelayUrls,
    unsignedEvents
  );
  return {
    ...(mutation.relationId ? { relation_id: mutation.relationId } : {}),
    ...(mutation.itemId ? { item_id: mutation.itemId } : {}),
    affected_root_relation_ids: getAffectedRootRelationIds(mutation.plan),
    relay_urls: published.relay_urls,
    event_ids: published.event_ids,
    publish_results: published.publish_results,
  };
}

export async function writeSetText(
  publisher: WritePublisher,
  profile: WorkspaceWriteProfile,
  options: {
    relationId: LongID;
    text: string;
    relayUrls?: string[];
  }
): Promise<Awaited<ReturnType<typeof publishWorkspaceMutation>>> {
  return publishWorkspaceMutation(
    publisher,
    profile,
    options.relayUrls,
    (plan) => {
      requireWritableRelationById(plan, options.relationId);
      return {
        plan: planSetRelationTextById(plan, options.relationId, options.text),
        relationId: options.relationId,
      };
    }
  );
}

export async function writeCreateUnder(
  publisher: WritePublisher,
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
  return publishWorkspaceMutation(
    publisher,
    profile,
    options.relayUrls,
    (plan) => {
      requireWritableRelationById(plan, options.parentRelationId);
      const inserted = planInsertMarkdownUnderRelationById(
        plan,
        options.parentRelationId,
        [requireSingleRootMarkdownTree(options.markdownText)],
        resolveInsertAtIndexById(plan, options.parentRelationId, {
          ...(options.beforeItemId
            ? { beforeItemId: options.beforeItemId }
            : {}),
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
    }
  );
}

export async function writeLink(
  publisher: WritePublisher,
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
  return publishWorkspaceMutation(
    publisher,
    profile,
    options.relayUrls,
    (plan) => {
      requireWritableRelationById(plan, options.parentRelationId);
      requireRelationById(plan, options.targetRelationId);
      const linked = planLinkRelationById(
        plan,
        options.parentRelationId,
        options.targetRelationId,
        resolveInsertAtIndexById(plan, options.parentRelationId, {
          ...(options.beforeItemId
            ? { beforeItemId: options.beforeItemId }
            : {}),
          ...(options.afterItemId ? { afterItemId: options.afterItemId } : {}),
        }),
        normalizeRelevanceInput(options.relevance || "contains"),
        normalizeArgumentInput(options.argument || "none")
      );
      return {
        plan: linked.plan,
        itemId: linked.itemId,
      };
    }
  );
}

export async function writeSetRelevance(
  publisher: WritePublisher,
  profile: WorkspaceWriteProfile,
  options: {
    parentRelationId: LongID;
    itemId: LongID | ID;
    relevance: "contains" | Relevance;
    relayUrls?: string[];
  }
): Promise<Awaited<ReturnType<typeof publishWorkspaceMutation>>> {
  return publishWorkspaceMutation(
    publisher,
    profile,
    options.relayUrls,
    (plan) => {
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
    }
  );
}

export async function writeSetArgument(
  publisher: WritePublisher,
  profile: WorkspaceWriteProfile,
  options: {
    parentRelationId: LongID;
    itemId: LongID | ID;
    argument: "none" | Argument;
    relayUrls?: string[];
  }
): Promise<Awaited<ReturnType<typeof publishWorkspaceMutation>>> {
  return publishWorkspaceMutation(
    publisher,
    profile,
    options.relayUrls,
    (plan) => {
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
    }
  );
}

export async function writeRemoveItem(
  publisher: WritePublisher,
  profile: WorkspaceWriteProfile,
  options: {
    parentRelationId: LongID;
    itemId: LongID | ID;
    relayUrls?: string[];
  }
): Promise<Awaited<ReturnType<typeof publishWorkspaceMutation>>> {
  return publishWorkspaceMutation(
    publisher,
    profile,
    options.relayUrls,
    (plan) => {
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
    }
  );
}

export async function writeMoveItem(
  publisher: WritePublisher,
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
  return publishWorkspaceMutation(
    publisher,
    profile,
    options.relayUrls,
    (plan) => {
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
            ...(options.afterItemId
              ? { afterItemId: options.afterItemId }
              : {}),
          })
        ),
      };
    }
  );
}
