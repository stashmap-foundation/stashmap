import { Map as ImmutableMap } from "immutable";
import { LOCAL } from "../core/nodeRef";
import { classifyLinkHref, ENTITY_SCHEME_RE } from "../core/linkPath";
import { getAllFileLinks, getAllLinks } from "../core/nodeSpans";
import { Document, getDocumentForNode } from "../core/Document";
import { getNode } from "../core/connections";
import { publishStateOf } from "../core/knowstrFrontmatter";
import { resolveDocumentTarget } from "./linkOperations";

function isCanonicalSourceId(id: ID): boolean {
  return ENTITY_SCHEME_RE.test(id) || id.startsWith("ical:");
}

export function documentEntityTags(
  knowledgeDBs: KnowledgeDBs,
  documents: ImmutableMap<string, Document>,
  documentByFilePath: ImmutableMap<string, Document>,
  document: Document
): string[] {
  const nodes = knowledgeDBs.get(LOCAL)?.nodes;
  if (!nodes) {
    return [];
  }
  const tags = new Set<string>();
  const addDocumentTags = (target: Document): void => {
    target.topNodeShortIds.forEach((id) => tags.add(id));
  };
  const addNodeTags = (node: GraphNode): void => {
    if (isCanonicalSourceId(node.id)) {
      tags.add(node.id);
    }
    getAllLinks(node).forEach((link) => tags.add(link.targetID));
    getAllFileLinks(node).forEach((link) => {
      const target = resolveDocumentTarget(
        { knowledgeDBs, documents, documentByFilePath },
        node,
        LOCAL,
        link.path
      );
      if (target && target.docId !== document.docId) {
        addDocumentTags(target);
      }
    });
  };
  const walk = (nodeId: ID): void => {
    const node = nodes.get(nodeId);
    if (!node) {
      return;
    }
    addNodeTags(node);
    node.children.forEach((childId) => walk(childId));
  };
  document.topNodeShortIds.forEach((id) => walk(id));
  return [...tags];
}

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
