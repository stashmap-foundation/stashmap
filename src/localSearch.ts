import { List, Set } from "immutable";
import {
  createDocumentLinkTarget,
  createRefTarget,
  getNodeText,
} from "./core/connections";
import { getDocumentByIdOrFilePath } from "./core/Document";
import { AddToParentTarget } from "./planner";

function normalizeSearchText(input: string): string {
  return input.toLowerCase().replace(/\n/g, "");
}

function searchLink(
  node: GraphNode
): Extract<InlineSpan, { kind: "link" }> | undefined {
  const span = node.spans.length === 1 ? node.spans[0] : undefined;
  return span?.kind === "link" ? span : undefined;
}

export function searchTargetID(node: GraphNode): ID | undefined {
  const span = searchLink(node);
  return span?.href.startsWith("#") ? span.href.slice(1) : undefined;
}

export function searchInsertTarget(
  data: Data,
  node: GraphNode,
  sourceId: SourceId
): AddToParentTarget | undefined {
  const span = searchLink(node);
  if (!span) return undefined;
  if (span.href.startsWith("#")) {
    return createRefTarget(span.href.slice(1), span.text);
  }
  const document = getDocumentByIdOrFilePath(
    data.documents,
    data.documentByFilePath,
    sourceId,
    span.href
  );
  return document
    ? createDocumentLinkTarget(
        document.sourceId,
        document.docId,
        span.href,
        span.text
      )
    : undefined;
}

function searchContribution(node: GraphNode): ID {
  return searchTargetID(node) ?? node.id;
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
    const text = getNodeText(node) ?? "";
    if (normalizeSearchText(text).indexOf(searchStr) === -1) {
      return results;
    }
    return results.add(searchContribution(node));
  }, Set<ID>());

  return resultIDs.toList();
}
