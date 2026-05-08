import {
  getNode,
  getRefLinkTargetInfo,
  getRefTargetInfo,
  RefTargetInfo,
  createDocumentLinkTarget,
  createRefTarget,
} from "../core/connections";
import { BlockLink } from "../core/blockLink";
import { Document, documentKeyOf } from "../core/Document";
import { resolveLinkPath } from "../core/linkPath";
import { buildDocumentRouteUrl, buildNodeRouteUrl } from "../navigationUrl";
import { AddToParentTarget } from "../planner";

export type LinkNavigationMode = "link" | "target";

export type EditorNavigationTarget = {
  author: PublicKey;
  documentId?: string;
  rootNodeId?: LongID;
  scrollToId?: string;
};

function sourceFilePath(data: Data, source: GraphNode): string | undefined {
  const sourceRoot =
    source.id === source.root
      ? source
      : getNode(data.knowledgeDBs, source.root, source.author);
  return sourceRoot?.docId
    ? data.documents.get(documentKeyOf(sourceRoot.author, sourceRoot.docId))
        ?.filePath
    : undefined;
}

function documentTarget(
  data: Data,
  link: Extract<BlockLink, { kind: "document" }>
): Document | undefined {
  const resolvedPath = resolveLinkPath(
    link.path,
    sourceFilePath(data, link.source)
  );
  return (
    data.documentByFilePath.get(resolvedPath) ||
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

export function linkToNavigationTarget(
  data: Data,
  link: BlockLink,
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
      ? getRefTargetInfo(link.source.id, data.knowledgeDBs, effectiveAuthor)
      : getRefLinkTargetInfo(
          link.source.id,
          data.knowledgeDBs,
          effectiveAuthor
        );
  return refInfo ? refInfoToTarget(refInfo) : undefined;
}

export function linkToHref(
  data: Data,
  link: BlockLink,
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
    ? buildNodeRouteUrl(target.rootNodeId, target.scrollToId)
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
    ? buildNodeRouteUrl(target.rootNodeId, target.scrollToId)
    : undefined;
}

export function linkStyle(link: BlockLink): React.CSSProperties {
  return link.kind === "document" ? { fontStyle: "italic" } : {};
}

export function linkToInsertTarget(
  data: Data,
  link: BlockLink | undefined
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
