import {
  getNode,
  getNodeStack,
  getRefLinkTargetInfo,
  getRefTargetInfo,
  RefTargetInfo,
  createDocumentLinkTarget,
  createRefTarget,
} from "../core/connections";
import { Document, getDocumentForNode, documentKeyOf } from "../core/Document";
import { Link } from "../core/link";
import { resolveLinkPath } from "../core/linkPath";
import { buildDocumentRouteUrl, buildNodeRouteUrl } from "../navigationUrl";
import { AddToParentTarget } from "../planner";
import {
  getNodeFromGraphData,
  getSourceNodeCandidates,
  projectDocumentByFilePath,
  projectKnowledgeDBs,
} from "../core/graphData";

export type LinkNavigationMode = "link" | "target";

export type EditorNavigationTarget = {
  author: PublicKey;
  documentId?: string;
  rootNodeId?: LongID;
  scrollToId?: string;
};

function sourceFilePath(data: Data, source: GraphNode): string | undefined {
  return getDocumentForNode(projectKnowledgeDBs(data), data.documents, source)
    ?.filePath;
}

function documentTarget(
  data: Data,
  link: Extract<Link, { kind: "document" }>
): Document | undefined {
  const resolvedPath = resolveLinkPath(
    link.path,
    sourceFilePath(data, link.source)
  );
  return (
    projectDocumentByFilePath(data).get(resolvedPath) ||
    data.documents.get(documentKeyOf(link.source.author, link.path))
  );
}

function refInfoToTarget(refInfo: RefTargetInfo): EditorNavigationTarget {
  return {
    author: refInfo.author,
    rootNodeId: refInfo.rootNodeId,
    scrollToId: refInfo.scrollToId,
  };
}

function nodeRefInfo(data: Data, node: GraphNode): RefTargetInfo {
  const knowledgeDBs = projectKnowledgeDBs(data);
  const containingParent = knowledgeDBs
    .get(node.author)
    ?.nodes.valueSeq()
    .find((candidate) =>
      candidate.children.some((childID) => childID === node.id)
    );
  const parentNode =
    (node.parent ? getNode(knowledgeDBs, node.parent, node.author) : undefined) ||
    containingParent;
  const targetRoot = parentNode || node;
  return {
    stack: getNodeStack(knowledgeDBs, targetRoot),
    author: targetRoot.author,
    rootNodeId: targetRoot.id,
    scrollToId: targetRoot.id === node.id ? undefined : node.id,
  };
}

function graphLinkRefInfo(data: Data, link: Extract<Link, { kind: "node" }>): RefTargetInfo | undefined {
  const target = link.targetID as ID;
  const targetNode =
    getNodeFromGraphData(data, target, link.source.author as SourceId) ??
    getSourceNodeCandidates(data, target)[0]?.node;
  return targetNode ? nodeRefInfo(data, targetNode) : undefined;
}

export function linkToNavigationTarget(
  data: Data,
  link: Link,
  effectiveAuthor: PublicKey,
  mode: LinkNavigationMode = "link"
): EditorNavigationTarget | undefined {
  if (link.kind === "document") {
    const document = documentTarget(data, link);
    return document
      ? { author: document.author, documentId: document.docId }
      : undefined;
  }

  const refInfo =
    mode === "target"
      ? getRefTargetInfo(
          link.source.id,
          projectKnowledgeDBs(data),
          effectiveAuthor
        )
      : graphLinkRefInfo(data, link) ??
        getRefLinkTargetInfo(
          link.source.id,
          projectKnowledgeDBs(data),
          effectiveAuthor
        );
  return refInfo ? refInfoToTarget(refInfo) : undefined;
}

export function linkToHref(
  data: Data,
  link: Link,
  effectiveAuthor: PublicKey,
  mode: LinkNavigationMode = "link"
): string | undefined {
  const target = linkToNavigationTarget(data, link, effectiveAuthor, mode);
  if (!target) {
    return undefined;
  }
  if (target.documentId) {
    return buildDocumentRouteUrl(
      target.author,
      target.documentId,
      target.scrollToId
    );
  }
  return target.rootNodeId
    ? buildNodeRouteUrl(target.rootNodeId, target.scrollToId, target.author)
    : undefined;
}

export function navigationTargetToHref(
  target: EditorNavigationTarget
): string | undefined {
  if (target.documentId) {
    return buildDocumentRouteUrl(
      target.author,
      target.documentId,
      target.scrollToId
    );
  }
  return target.rootNodeId
    ? buildNodeRouteUrl(target.rootNodeId, target.scrollToId, target.author)
    : undefined;
}

export function linkStyle(link: Link): React.CSSProperties {
  return link.kind === "document" ? { fontStyle: "italic" } : {};
}

export function linkToInsertTarget(
  data: Data,
  link: Link | undefined
): AddToParentTarget | undefined {
  if (!link) {
    return undefined;
  }
  if (link.kind === "document") {
    const document = documentTarget(data, link);
    return document
      ? createDocumentLinkTarget(
          document.author,
          document.docId,
          link.path,
          link.text
        )
      : undefined;
  }
  return createRefTarget(link.targetID, link.text);
}
