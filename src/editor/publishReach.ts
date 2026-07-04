import { Map as ImmutableMap } from "immutable";
import { LOCAL } from "../core/nodeRef";
import { getBlockLink } from "../core/blockLink";
import {
  Document,
  getDocumentByIdOrFilePath,
  getDocumentForNode,
} from "../core/Document";
import { getNode } from "../core/connections";
import { publishStateOf } from "../core/knowstrFrontmatter";

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
