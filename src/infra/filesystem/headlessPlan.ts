import { Map } from "immutable";
import { createGraphPlan, GraphPlan } from "../../planner";
import { createEmptyGraphIndex } from "../../graphIndex";

const EMPTY_RELAYS: AllRelays = {
  defaultRelays: [],
  userRelays: [],
};

export function createHeadlessPlan(
  viewer: PublicKey,
  knowledgeDBs: KnowledgeDBs = Map<SourceId, KnowledgeData>()
): GraphPlan {
  return createGraphPlan({
    user: { publicKey: viewer },
    knowledgeDBs,
    graphIndex: createEmptyGraphIndex(),
    documents: Map(),
    documentByFilePath: Map(),
    relaysInfos: Map(),
    snapshotNodes: Map(),
    relays: EMPTY_RELAYS,
  });
}
