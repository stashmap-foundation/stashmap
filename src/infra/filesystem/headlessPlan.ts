import { Map } from "immutable";
import { createGraphPlan, GraphPlan } from "../../planner";
import {
  createEmptyGraphData,
  graphDataFromKnowledgeDBs,
} from "../../core/graphData";

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
    ...(knowledgeDBs.size > 0
      ? graphDataFromKnowledgeDBs(knowledgeDBs)
      : createEmptyGraphData()),
    relaysInfos: Map(),
    snapshotNodes: Map(),
    relays: EMPTY_RELAYS,
  });
}
