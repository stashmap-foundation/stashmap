import { Map } from "immutable";
import { createGraphPlan, GraphPlan } from "../graph/commands";
import type { Contact, PublicKey } from "../graph/identity";
import type { KnowledgeData, KnowledgeDBs } from "../graph/types";

export function createHeadlessPlan(
  viewer: PublicKey,
  knowledgeDBs: KnowledgeDBs = Map<PublicKey, KnowledgeData>()
): GraphPlan {
  return createGraphPlan({
    contacts: Map<PublicKey, Contact>(),
    user: { publicKey: viewer },
    knowledgeDBs,
  });
}
