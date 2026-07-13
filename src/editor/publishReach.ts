import { Map as ImmutableMap } from "immutable";
import { LOCAL } from "../core/nodeRef";
import { ENTITY_SCHEME_RE } from "../core/entityRecognition";
import { getAllLinks } from "../core/nodeSpans";
import { Document, getDocumentForNode } from "../core/Document";
import { getNode } from "../core/connections";
import { publishStateOf } from "../core/knowstrFrontmatter";
import { resolveDocumentTarget } from "./linkOperations";

// Entity tags (idea.md, Entities): one bare tag per identified node in
// the document — a node whose own id, or whose link target, carries an
// entity scheme — deduplicated. Derivation reads THROUGH link targets:
// identification comes from the target id, traversal stays within this
// document's tree. Structure contributes nothing to the tags; readers
// rank arrivals by tag overlap with what they hold.
export function documentEntityTags(
  knowledgeDBs: KnowledgeDBs,
  document: Document
): string[] {
  const nodes = knowledgeDBs.get(LOCAL)?.nodes;
  if (!nodes) {
    return [];
  }
  const entitiesOf = (node: GraphNode): string[] => [
    ...(ENTITY_SCHEME_RE.test(node.id) ? [node.id] : []),
    ...getAllLinks(node)
      .map((link) => link.targetID)
      .filter((target) => ENTITY_SCHEME_RE.test(target)),
  ];
  const tags = new Set<string>();
  const walk = (nodeId: ID): void => {
    const node = nodes.get(nodeId);
    if (!node) {
      return;
    }
    entitiesOf(node).forEach((entity) => tags.add(entity));
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
  const target = href.startsWith("#")
    ? (() => {
        const targetNode = getNode(knowledgeDBs, href.slice(1), sourceId);
        return targetNode
          ? getDocumentForNode(knowledgeDBs, documents, targetNode, sourceId)
          : undefined;
      })()
    : resolveDocumentTarget(
        { knowledgeDBs, documents, documentByFilePath },
        source,
        sourceId,
        href
      );
  if (!target || target.docId === paneDocument.docId) {
    return undefined;
  }
  return publishStateOf(target.frontMatter) ? undefined : target;
}
