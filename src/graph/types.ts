import { Map } from "immutable";

export const EMPTY_SEMANTIC_ID = "" as ID;

export type TextSeed = {
  id: ID;
  text: string;
};

export type RefTargetSeed = {
  targetID: LongID;
  linkText?: string;
};

export function newDB(): KnowledgeData {
  return {
    nodes: Map<ID, GraphNode>(),
  };
}
