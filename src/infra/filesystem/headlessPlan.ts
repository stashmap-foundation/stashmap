import { Map } from "immutable";
import { createGraphPlan, GraphPlan } from "../../planner";
import { createEmptyGraphIndex } from "../../graphIndex";

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
  });
}
