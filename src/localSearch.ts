import { List, Set } from "immutable";
import { getNodeSemanticID, getNodeText, isRefNode } from "./connections";

function normalizeSearchText(input: string): string {
  return input.toLowerCase().replace(/\n/g, "");
}

export function getLocalSearchResultIDs(
  knowledgeDBs: KnowledgeDBs,
  query: string
): List<ID> {
  if (query === "") {
    return List<ID>();
  }

  const searchStr = normalizeSearchText(query);
  const allNodes = knowledgeDBs
    .valueSeq()
    .flatMap((db) => db.nodes.valueSeq())
    .filter((node) => !isRefNode(node));
  const resultIDs = allNodes.reduce((results, node) => {
    const text = getNodeText(node) || "";
    if (normalizeSearchText(text).indexOf(searchStr) === -1) {
      return results;
    }
    return results.add(getNodeSemanticID(node));
  }, Set<ID>());

  return resultIDs.toList();
}
