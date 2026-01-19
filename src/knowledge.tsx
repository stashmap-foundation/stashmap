import { Map } from "immutable";
import { ROOT } from "./types";

export function newDB(): KnowledgeData {
  const rootNode: KnowNode = {
    id: ROOT,
    text: "My Notes",
    type: "text",
  };

  return {
    nodes: Map<ID, KnowNode>([[ROOT, rootNode]]),
    relations: Map<ID, Relations>(),
  };
}
