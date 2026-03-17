import { Map } from "immutable";
import { createGraphPlan, GraphPlan } from "../graph/commands";
import type { Contact, PublicKey } from "../graph/identity";
import type { KnowledgeData, KnowledgeDBs } from "../graph/types";
import { createEmptySemanticIndex } from "../graph/semanticIndex";
import type { AllRelays, Relays } from "../infra/publishTypes";

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
    semanticIndex: createEmptySemanticIndex(),
    relaysInfos: Map(),
    relays: EMPTY_RELAYS,
  });
}
