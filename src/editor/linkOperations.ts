import { createDocumentLinkTarget, createRefTarget } from "../core/connections";
import { Document, getDocumentForNode, documentKeyOf } from "../core/Document";
import {
  getNodeInSource,
  graphLookupFromData,
  lookupNode,
  resolveBlockLinkTarget,
  ResolvedNode,
} from "../core/graphLookup";
import { Link } from "../core/link";
import { resolveLinkPath } from "../core/linkPath";
import { buildDocumentRouteUrl, buildNodeRouteUrl } from "../navigationUrl";
import { AddToParentTarget } from "../planner";

export type LinkNavigationMode = "link" | "target";

export type EditorNavigationTarget = {
  author: PublicKey;
  sourceId: SourceId;
  documentId?: string;
  rootNodeId?: ID;
  scrollToId?: string;
};

function sourceFilePath(data: Data, source: GraphNode): string | undefined {
  return getDocumentForNode(data.knowledgeDBs, data.documents, source)
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
    data.documentByFilePath.get(resolvedPath) ||
    data.documents.get(documentKeyOf(link.source.author, link.path))
  );
}

function sourceResolvedNode(
  graph: ReturnType<typeof graphLookupFromData>,
  link: Extract<Link, { kind: "node" }>,
  sourceId: SourceId
): ResolvedNode {
  return (
    lookupNode(graph, link.source.id, sourceId) ?? {
      ref: { sourceId, id: link.source.id },
      node: link.source,
    }
  );
}

function nodeTarget(
  data: Data,
  link: Extract<Link, { kind: "node" }>,
  mode: LinkNavigationMode
): EditorNavigationTarget | undefined {
  const graph = graphLookupFromData(data);
  const source = sourceResolvedNode(graph, link, link.source.author);
  const target =
    mode === "target" ? source : resolveBlockLinkTarget(graph, source);
  if (!target) {
    return undefined;
  }
  const parent = target.node.parent
    ? getNodeInSource(graph, {
        sourceId: target.ref.sourceId,
        id: target.node.parent,
      })
    : undefined;
  const targetRoot = mode === "target" ? target : parent ?? target;
  return {
    author: targetRoot.node.author,
    sourceId: targetRoot.ref.sourceId,
    rootNodeId: targetRoot.node.id,
    scrollToId:
      targetRoot.node.id === target.node.id ? undefined : target.node.id,
  };
}

export function linkToNavigationTarget(
  data: Data,
  link: Link,
  mode: LinkNavigationMode = "link"
): EditorNavigationTarget | undefined {
  if (link.kind === "document") {
    const document = documentTarget(data, link);
    return document
      ? {
          author: document.author,
          sourceId: document.author,
          documentId: document.docId,
        }
      : undefined;
  }

  return nodeTarget(data, link, mode);
}

export function linkToHref(
  data: Data,
  link: Link,
  mode: LinkNavigationMode = "link"
): string | undefined {
  const target = linkToNavigationTarget(data, link, mode);
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
    ? buildNodeRouteUrl(target.rootNodeId, target.sourceId, target.scrollToId)
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
    ? buildNodeRouteUrl(target.rootNodeId, target.sourceId, target.scrollToId)
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
