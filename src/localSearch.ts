import { List, Set } from "immutable";
import {
  createDocumentLinkTarget,
  createRefTarget,
  getNodeText,
} from "./core/connections";
import { AddToParentTarget } from "./planner";
import { classifyLinkHref, resolveLink } from "./core/linkPath";
import { LOCAL } from "./core/nodeRef";

function normalizeSearchText(input: string): string {
  return input.toLowerCase().replace(/\n/g, "");
}

function searchLink(
  node: GraphNode
): Extract<InlineSpan, { kind: "link" }> | undefined {
  const span = node.spans.length === 1 ? node.spans[0] : undefined;
  return span?.kind === "link" ? span : undefined;
}

function searchTargetRef(
  node: GraphNode,
  localPubkey: PublicKey | undefined
): NodeRef | undefined {
  const span = searchLink(node);
  if (!span) return undefined;
  const targetClass = classifyLinkHref(span.href);
  return targetClass === "node" ||
    targetClass === "thing" ||
    targetClass === "calendar"
    ? resolveLink(span.href, { sourceId: LOCAL, id: node.id }, localPubkey)
    : undefined;
}

export function searchTargetID(
  node: GraphNode,
  localPubkey: PublicKey | undefined
): ID | undefined {
  return searchTargetRef(node, localPubkey)?.id;
}

export function searchInsertTarget(
  node: GraphNode,
  localPubkey: PublicKey | undefined
): AddToParentTarget | undefined {
  const span = searchLink(node);
  if (!span) return undefined;
  const target = searchTargetRef(node, localPubkey);
  if (target) {
    return createRefTarget(target, span.text);
  }
  const file =
    classifyLinkHref(span.href) === "file"
      ? resolveLink(span.href, { sourceId: LOCAL, id: node.id }, localPubkey)
      : undefined;
  return file
    ? createDocumentLinkTarget(file.sourceId, file.id, span.text)
    : undefined;
}

function searchContribution(
  node: GraphNode,
  localPubkey: PublicKey | undefined
): ID {
  return searchTargetID(node, localPubkey) ?? node.id;
}

export function getLocalSearchResultIDs(
  knowledgeDBs: KnowledgeDBs,
  query: string,
  localPubkey: PublicKey | undefined
): List<ID> {
  if (query === "") {
    return List<ID>();
  }

  const searchStr = normalizeSearchText(query);
  const allNodes = knowledgeDBs.valueSeq().flatMap((db) => db.nodes.valueSeq());
  const resultIDs = allNodes.reduce((results, node) => {
    const text = getNodeText(node) ?? "";
    if (normalizeSearchText(text).indexOf(searchStr) === -1) {
      return results;
    }
    return results.add(searchContribution(node, localPubkey));
  }, Set<ID>());

  return resultIDs.toList();
}
