import { Map as ImmutableMap } from "immutable";
import { classifyLinkHref } from "../core/linkPath";
import {
  Document,
  getDocumentForNode,
  resolveDocumentTarget,
} from "../core/Document";
import { getNode } from "../core/connections";
import { publishStateOf } from "../core/knowstrFrontmatter";

export function unpublishedLinkTargetForHref(
  knowledgeDBs: KnowledgeDBs,
  documents: ImmutableMap<string, Document>,
  documentByFilePath: ImmutableMap<string, Document>,
  paneDocument: Document | undefined,
  source: GraphNode,
  sourceId: SourceId,
  href: string
): Document | undefined {
  if (!paneDocument || !publishStateOf(paneDocument.frontMatter)) {
    return undefined;
  }
  const targetClass = classifyLinkHref(href);
  const target = (() => {
    if (
      targetClass === "entity" ||
      targetClass === "node" ||
      targetClass === "calendar"
    ) {
      const targetNode = getNode(knowledgeDBs, href.slice(1), sourceId);
      return targetNode
        ? getDocumentForNode(knowledgeDBs, documents, targetNode, sourceId)
        : undefined;
    }
    if (targetClass !== "document" && targetClass !== "file") {
      return undefined;
    }
    const hashIndex = href.lastIndexOf("#");
    const path = hashIndex < 0 ? href : href.slice(0, hashIndex);
    return resolveDocumentTarget(
      { knowledgeDBs, documents, documentByFilePath },
      source,
      sourceId,
      path
    );
  })();
  if (!target || target.docId === paneDocument.docId) {
    return undefined;
  }
  return publishStateOf(target.frontMatter) ? undefined : target;
}
