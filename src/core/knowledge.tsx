import { Map } from "immutable";

export function newDB(): KnowledgeData {
  return {
    nodes: Map<ID, GraphNode>(),
  };
}
