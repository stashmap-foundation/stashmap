import { List } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_RELAY_METADATA_EVENT,
  newTimestamp,
  msTag,
} from "../nostr";
import { buildDocumentEvent } from "../markdownDocument";
import {
  buildDocumentEventFromNodes,
  buildSnapshotEventFromNodes,
} from "../nodesDocumentEvent";
import { shortID } from "../graph/context";
import { getNode } from "../graph/queries";
import { newDB } from "../graph/types";
import { UNAUTHENTICATED_USER_PK } from "../AppState";
import {
  createGraphPlan,
  planUpsertNodes,
  type GraphPlan,
} from "../graph/commands";
import type { Plan } from "./types";
import { newNode } from "../nodeFactory";
import { getContext, getNodeForView, getParentNode } from "../rows/resolveRow";
import { type RowPath } from "../rows/rowPaths";

export function upsertNodes(
  plan: Plan,
  rowPath: RowPath,
  stack: ID[],
  modify: (nodes: GraphNode) => GraphNode
): Plan {
  const semanticContext = getContext(plan, rowPath, stack);
  const parentNode = getParentNode(plan, rowPath);
  const parentRoot = parentNode?.root;
  const currentNode = getNodeForView(plan, rowPath, stack);

  if (currentNode && currentNode.author !== plan.user.publicKey) {
    throw new Error("Cannot edit another user's nodes");
  }

  const base =
    currentNode ||
    newNode(
      "",
      semanticContext,
      plan.user.publicKey,
      parentRoot,
      parentNode?.id
    );

  const updatedNodes = modify(base);

  if (currentNode && currentNode.children.equals(updatedNodes.children)) {
    return plan;
  }

  return planUpsertNodes(plan, updatedNodes);
}

export function replaceUnauthenticatedUser<T extends string>(
  from: T,
  publicKey: string
): T {
  return from.replaceAll(UNAUTHENTICATED_USER_PK, publicKey) as T;
}

function rewriteIDs(event: UnsignedEvent): UnsignedEvent {
  const replacedTags = event.tags.map((tag) =>
    tag.map((value) => replaceUnauthenticatedUser(value, event.pubkey))
  );
  return {
    ...event,
    content: replaceUnauthenticatedUser(event.content, event.pubkey),
    tags: replacedTags,
  };
}

export function planRewriteUnpublishedEvents(
  plan: Plan,
  events: List<UnsignedEvent>
): Plan {
  const allEvents = plan.publishEvents.concat(events);
  const rewrittenEvents = allEvents.map((event) =>
    rewriteIDs({
      ...event,
      pubkey: plan.user.publicKey,
    })
  );
  return {
    ...plan,
    publishEvents: rewrittenEvents,
  };
}

export function relayTags(relays: Relays): string[][] {
  return relays
    .map((relay) => {
      if (relay.read && relay.write) {
        return ["r", relay.url];
      }
      if (relay.read) {
        return ["r", relay.url, "read"];
      }
      if (relay.write) {
        return ["r", relay.url, "write"];
      }
      return [];
    })
    .filter((tag) => tag.length > 0);
}

export function planPublishRelayMetadata(plan: Plan, relays: Relays): Plan {
  const tags = relayTags(relays);
  const publishRelayMetadataEvent = {
    kind: KIND_RELAY_METADATA_EVENT,
    pubkey: plan.user.publicKey,
    created_at: newTimestamp(),
    tags: [...tags, msTag()],
    content: "",
    writeRelayConf: {
      defaultRelays: true,
      user: true,
      extraRelays: relays,
    },
  };
  return {
    ...plan,
    publishEvents: plan.publishEvents.push(publishRelayMetadataEvent),
  };
}

export function buildDocumentEvents(
  plan: GraphPlan
): List<UnsignedEvent & EventAttachment> {
  const author = plan.user.publicKey;
  const userDB = plan.knowledgeDBs.get(author, newDB());
  return plan.affectedRoots.reduce((events, rootId) => {
    const rootNode = userDB.nodes.find(
      (node) =>
        !node.parent &&
        (node.id === rootId ||
          shortID(node.id) === rootId ||
          node.root === rootId ||
          node.root === shortID(rootId as ID))
    );
    if (!rootNode) {
      const rootDTag = shortID(rootId as ID);
      const deleteEvent = {
        kind: KIND_DELETE,
        pubkey: author,
        created_at: newTimestamp(),
        tags: [
          ["a", `${KIND_KNOWLEDGE_DOCUMENT}:${author}:${rootDTag}`],
          ["k", `${KIND_KNOWLEDGE_DOCUMENT}`],
          msTag(),
        ],
        content: "",
      };
      return events.push(deleteEvent as UnsignedEvent & EventAttachment);
    }
    const snapshotSourceRoot =
      rootNode.basedOn && !rootNode.snapshotDTag
        ? getNode(plan.knowledgeDBs, rootNode.basedOn, author)
        : undefined;
    const createdSnapshotDTag = snapshotSourceRoot
      ? `snapshot-${shortID(rootNode.id as ID)}`
      : undefined;
    const snapshotEvent = snapshotSourceRoot
      ? (buildSnapshotEventFromNodes(
          plan.knowledgeDBs,
          author,
          createdSnapshotDTag as string,
          snapshotSourceRoot
        ) as UnsignedEvent & EventAttachment)
      : undefined;
    const workspacePlan = plan as Partial<Plan>;
    const event =
      workspacePlan.views !== undefined && workspacePlan.panes !== undefined
        ? buildDocumentEvent(workspacePlan as Data, rootNode, {
            snapshotDTag: rootNode.snapshotDTag ?? createdSnapshotDTag,
          })
        : buildDocumentEventFromNodes(plan.knowledgeDBs, rootNode, {
            snapshotDTag: rootNode.snapshotDTag ?? createdSnapshotDTag,
          });
    return snapshotEvent
      ? events
          .push(snapshotEvent)
          .push(event as UnsignedEvent & EventAttachment)
      : events.push(event as UnsignedEvent & EventAttachment);
  }, plan.publishEvents);
}

export function createPlan(
  props: Data & {
    publishEvents?: List<UnsignedEvent & EventAttachment>;
    relays: AllRelays;
  }
): Plan {
  return {
    ...createGraphPlan(props),
    publishEventsStatus: props.publishEventsStatus,
    views: props.views,
    panes: props.panes,
    temporaryView: props.publishEventsStatus.temporaryView,
    temporaryEvents: List<TemporaryEvent>(),
  };
}
