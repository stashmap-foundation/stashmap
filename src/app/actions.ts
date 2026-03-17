import { List } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import { UNAUTHENTICATED_USER_PK } from "../features/app-shell/RequireLogin";
import type { Data, TemporaryEvent } from "../features/app-shell/types";
import { createGraphPlan, planUpsertNodes } from "../graph/commands";
import type { GraphNode, ID } from "../graph/types";
import type { Plan } from "./types";
import { newNode } from "../graph/nodeFactory";
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

export function createPlan(
  props: Data & {
    publishEvents?: List<UnsignedEvent>;
  }
): Plan {
  return {
    ...createGraphPlan({
      contacts: props.contacts,
      user: props.user,
      knowledgeDBs: props.knowledgeDBs,
      publishEvents: props.publishEvents,
    }),
    contactsRelays: props.contactsRelays,
    semanticIndex: props.semanticIndex,
    relaysInfos: props.relaysInfos,
    publishEventsStatus: props.publishEventsStatus,
    views: props.views,
    panes: props.panes,
    temporaryView: props.publishEventsStatus.temporaryView,
    temporaryEvents: List<TemporaryEvent>(),
  };
}
