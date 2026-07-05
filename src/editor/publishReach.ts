import { Map as ImmutableMap } from "immutable";
import { LOCAL } from "../core/nodeRef";
import { ENTITY_SCHEME_RE } from "../core/entityRecognition";
import { getBlockLink } from "../core/blockLink";
import { getBlockLinkTarget } from "../core/nodeSpans";
import {
  Document,
  getDocumentByIdOrFilePath,
  getDocumentForNode,
} from "../core/Document";
import { getNode } from "../core/connections";
import { publishStateOf } from "../core/knowstrFrontmatter";

// The identified-context ladder (idea.md, Entities): one rung per
// identified node in the document — a node whose own id, or whose link
// target, carries an entity scheme. Each rung is that node's full context
// set (every identified ancestor on its path plus itself), deduplicated,
// sorted, space-joined; sorting makes rungs order-independent, and a
// joined rung is a precomputed AND that only context-sharers derive.
// `- [Barcelona] / - [Sagrada Familia] / - I want to see it` yields
// `wd:Q1492` and `wd:Q1492 wd:Q48435` — linear in chain depth, never a
// power set. The ladder reads THROUGH link targets: identification comes
// from the target id, traversal stays within this document's tree.
export function documentEntityLadder(
  knowledgeDBs: KnowledgeDBs,
  document: Document
): string[] {
  const nodes = knowledgeDBs.get(LOCAL)?.nodes;
  if (!nodes) {
    return [];
  }
  const entityOf = (node: GraphNode): string | undefined => {
    if (ENTITY_SCHEME_RE.test(node.id)) {
      return node.id;
    }
    const target = getBlockLinkTarget(node);
    return target && ENTITY_SCHEME_RE.test(target) ? target : undefined;
  };
  const rungs = new Set<string>();
  const walk = (nodeId: ID, context: ReadonlySet<string>): void => {
    const node = nodes.get(nodeId);
    if (!node) {
      return;
    }
    const entity = entityOf(node);
    const next = entity ? new Set([...context, entity]) : context;
    if (entity) {
      rungs.add([...next].sort().join(" "));
    }
    node.children.forEach((childId) => walk(childId, next));
  };
  document.topNodeShortIds.forEach((id) => walk(id as ID, new Set<string>()));
  return [...rungs];
}

// The "not shared here" chip: a link row inside a published document whose
// target doesn't reach this document's readers. v0 detects the
// unpublished-target case; the entity/relay-mismatch cases land with the
// ladder walk. Returns the target document to grant, or undefined.
export function unpublishedLinkTarget(
  knowledgeDBs: KnowledgeDBs,
  documents: ImmutableMap<string, Document>,
  documentByFilePath: ImmutableMap<string, Document>,
  paneDocument: Document | undefined,
  node: GraphNode | undefined
): Document | undefined {
  if (!paneDocument || !node) {
    return undefined;
  }
  if (!publishStateOf(paneDocument.frontMatter)) {
    return undefined;
  }
  const link = getBlockLink(node, LOCAL);
  if (!link) {
    return undefined;
  }
  const target =
    link.kind === "document"
      ? getDocumentByIdOrFilePath(
          documents,
          documentByFilePath,
          LOCAL,
          link.path
        )
      : (() => {
          const targetNode = getNode(knowledgeDBs, link.targetID, LOCAL);
          return targetNode
            ? getDocumentForNode(knowledgeDBs, documents, targetNode, LOCAL)
            : undefined;
        })();
  if (!target || target.docId === paneDocument.docId) {
    return undefined;
  }
  return publishStateOf(target.frontMatter) ? undefined : target;
}
