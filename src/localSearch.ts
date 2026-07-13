import { List, Set } from "immutable";
import { getNodeText, isRefNode } from "./core/connections";
import { getBlockLinkTarget, getBlockLinkText } from "./core/nodeSpans";

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
  const allNodes = knowledgeDBs.valueSeq().flatMap((db) => db.nodes.valueSeq());
  const resultIDs = allNodes.reduce((results, node) => {
    const text = isRefNode(node)
      ? getBlockLinkText(node) ?? ""
      : getNodeText(node) ?? "";
    if (normalizeSearchText(text).indexOf(searchStr) === -1) {
      return results;
    }
    const targetID = isRefNode(node) ? getBlockLinkTarget(node) : undefined;
    return results.add(targetID ?? node.id);
  }, Set<ID>());

  return resultIDs.toList();
}
