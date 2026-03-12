import { Map } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import { KIND_DELETE, KIND_KNOWLEDGE_DOCUMENT } from "../nostr";
import { joinID } from "../connections";
import { buildDocumentEvents, createGraphPlan, GraphPlan } from "../planner";

const EMPTY_RELAYS: AllRelays = {
  defaultRelays: [],
  userRelays: [],
  contactsRelays: [],
};

export function createHeadlessPlan(
  viewer: PublicKey,
  knowledgeDBs: KnowledgeDBs = Map<PublicKey, KnowledgeData>()
): GraphPlan {
  return createGraphPlan({
    contacts: Map<PublicKey, Contact>(),
    user: { publicKey: viewer },
    contactsRelays: Map<PublicKey, Relays>(),
    knowledgeDBs,
    relaysInfos: Map(),
    projectMembers: Map<PublicKey, Member>(),
    relays: EMPTY_RELAYS,
  });
}

export function buildKnowledgeDocumentEvents(plan: GraphPlan): UnsignedEvent[] {
  return buildDocumentEvents(plan)
    .filter(
      (event) =>
        event.kind === KIND_KNOWLEDGE_DOCUMENT || event.kind === KIND_DELETE
    )
    .toArray();
}

export function getAffectedRootRelationIds(plan: GraphPlan): LongID[] {
  return plan.affectedRoots
    .toArray()
    .map((rootId) => joinID(plan.user.publicKey, rootId));
}
