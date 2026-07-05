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

// Contained canonical entities: nodes of this document whose own ids —
// or whose link targets — carry an entity scheme. Pasting an entity's
// marker into a document (which creates a link row under E3's mint-or-link
// rule) is one of the three gestures that put the document into a context.
export function documentEntityCandidates(
  knowledgeDBs: KnowledgeDBs,
  document: Document
): string[] {
  const nodes = knowledgeDBs.get(LOCAL)?.nodes;
  if (!nodes) {
    return [];
  }
  return [
    ...new Set(
      nodes
        .valueSeq()
        .toArray()
        .filter(
          (node) =>
            document.topNodeShortIds.includes(node.id) ||
            document.topNodeShortIds.includes(node.root)
        )
        .flatMap((node) => {
          const own = ENTITY_SCHEME_RE.test(node.id) ? [node.id as string] : [];
          const target = getBlockLinkTarget(node);
          const viaLink =
            target && ENTITY_SCHEME_RE.test(target) ? [target as string] : [];
          return [...own, ...viaLink];
        })
    ),
  ];
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
