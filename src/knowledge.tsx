import { Map } from "immutable";

export function newDB(): KnowledgeData {
  return {
    relations: Map<ID, Relations>(),
  };
}
