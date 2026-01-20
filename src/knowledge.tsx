import { Map } from "immutable";
import { ROOT } from "./types";
import { EMPTY_NODE_ID } from "./connections";

export function newDB(): KnowledgeData {
  const rootNode: KnowNode = {
    id: ROOT,
    text: "My Notes",
    type: "text",
  };

  const emptyNode: KnowNode = {
    id: EMPTY_NODE_ID,
    text: "",
    type: "text",
  };

  return {
    nodes: Map<ID, KnowNode>([
      [ROOT, rootNode],
      [EMPTY_NODE_ID, emptyNode],
    ]),
    relations: Map<ID, Relations>(),
  };
}
