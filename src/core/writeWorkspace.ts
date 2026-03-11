import { inspectChildren, loadWorkspaceGraph } from "./workspaceGraph";
import {
  applyWorkspaceCreateUnder,
  applyWorkspaceLink,
  applyWorkspaceMoveItem,
  applyWorkspaceRemoveItem,
  applyWorkspaceSetArgument,
  applyWorkspaceSetRelevance,
  applyWorkspaceSetText,
  buildWorkspacePlanDocumentEvents,
  createWorkspacePlan,
  getAffectedRootRelationIds,
} from "./workspacePlan";
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
  mutate: (plan: ReturnType<typeof createWorkspacePlan>) => {
    plan: ReturnType<typeof createWorkspacePlan>;
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
  const plan = createWorkspacePlan(graph, profile.pubkey);
  const mutation = mutate(plan);
  const writeRelayUrls = resolveWriteRelayUrls(profile, relayUrls);
  const secretKey = await loadWriteSecretKey(profile);
  const unsignedEvents = buildWorkspacePlanDocumentEvents(mutation.plan);
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
    (plan) => applyWorkspaceSetText(plan, options.relationId, options.text)
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
    (plan) =>
      applyWorkspaceCreateUnder(
        plan,
        options.parentRelationId,
        options.markdownText,
        {
          ...(options.beforeItemId
            ? { beforeItemId: options.beforeItemId }
            : {}),
          ...(options.afterItemId ? { afterItemId: options.afterItemId } : {}),
        },
        options.relevance,
        options.argument
      )
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
    (plan) =>
      applyWorkspaceLink(
        plan,
        options.parentRelationId,
        options.targetRelationId,
        {
          ...(options.beforeItemId
            ? { beforeItemId: options.beforeItemId }
            : {}),
          ...(options.afterItemId ? { afterItemId: options.afterItemId } : {}),
        },
        options.relevance,
        options.argument
      )
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
    (plan) =>
      applyWorkspaceSetRelevance(
        plan,
        options.parentRelationId,
        options.itemId,
        options.relevance
      )
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
    (plan) =>
      applyWorkspaceSetArgument(
        plan,
        options.parentRelationId,
        options.itemId,
        options.argument
      )
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
    (plan) =>
      applyWorkspaceRemoveItem(plan, options.parentRelationId, options.itemId)
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
    (plan) =>
      applyWorkspaceMoveItem(
        plan,
        options.sourceParentRelationId,
        options.itemId,
        options.targetParentRelationId,
        {
          ...(options.beforeItemId
            ? { beforeItemId: options.beforeItemId }
            : {}),
          ...(options.afterItemId ? { afterItemId: options.afterItemId } : {}),
        }
      )
  );
}
