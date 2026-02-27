import { Map } from "immutable";
import { EMPTY_NODE_ID } from "./connections";

export function newDB(): KnowledgeData {
  const emptyNode: KnowNode = {
    id: EMPTY_NODE_ID,
    text: "",
    type: "text",
  };

  return {
    nodes: Map<ID, KnowNode>([[EMPTY_NODE_ID, emptyNode]]),
    relations: Map<ID, Relations>(),
  };
}
