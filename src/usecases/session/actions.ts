import { List } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import { createGraphPlan, planUpsertNodes } from "../../graph/commands";
import type { Contacts, User } from "../../graph/identity";
import type { GraphNode, ID, SemanticIndex } from "../../graph/types";
import { newNode } from "../../graph/nodeFactory";
import {
  getContext,
  getNodeForView,
  getParentNode,
} from "../../rows/resolveRow";
import { type RowPath } from "../../rows/rowPaths";
import type {
  Pane,
  TemporaryEvent,
  TemporaryViewState,
  Views,
} from "../../session/types";
import type { Plan } from "./types";

type CreatePlanInput = {
  contacts: Contacts;
  user: User;
  knowledgeDBs: Plan["knowledgeDBs"];
  semanticIndex: SemanticIndex;
  publishEventsStatus: {
    temporaryView: TemporaryViewState;
    temporaryEvents: List<TemporaryEvent>;
  };
  views: Views;
  panes: Pane[];
};

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

export function createPlan(
  props: CreatePlanInput & {
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
    semanticIndex: props.semanticIndex,
    publishEventsStatus: props.publishEventsStatus,
    views: props.views,
    panes: props.panes,
    temporaryView: props.publishEventsStatus.temporaryView,
    temporaryEvents: List<TemporaryEvent>(),
  };
}
