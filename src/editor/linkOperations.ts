import { LOCAL } from "../core/nodeRef";
import { resolveDocumentTarget } from "../core/Document";
import {
  getNodeInSource,
  graphLookupFromData,
  lookupNode,
} from "../core/graphLookup";
import { classifyLinkHref } from "../core/linkPath";
import { buildDocumentRouteUrl, buildNodeRouteUrl } from "../navigationUrl";

export type EditorNavigationTarget = {
  sourceId: SourceId;
  documentId?: string;
  rootNodeId?: ID;
  scrollToId?: string;
  fallbackLabel?: string;
};

export function navigationTargetToHref(
  target: EditorNavigationTarget
): string | undefined {
  if (target.documentId) {
    return buildDocumentRouteUrl(
      target.sourceId,
      target.documentId,
      target.scrollToId
    );
  }
  return target.rootNodeId
    ? buildNodeRouteUrl(target.rootNodeId, target.sourceId, {
        scrollToId: target.scrollToId,
        fallbackLabel: target.fallbackLabel,
      })
    : undefined;
}

export function inlineTargetToHref(
  data: Data,
  targetID: ID,
  sourceId: SourceId
): string | undefined {
  const graph = graphLookupFromData(data);
  const target = lookupNode(graph, targetID, sourceId);
  if (!target) {
    return undefined;
  }
  const parent = target.node.parent
    ? getNodeInSource(graph, {
        sourceId: target.ref.sourceId,
        id: target.node.parent,
      })
    : undefined;
  const targetRoot = parent ?? target;
  return buildNodeRouteUrl(targetRoot.node.id, targetRoot.ref.sourceId, {
    scrollToId:
      targetRoot.node.id === target.node.id ? undefined : target.node.id,
    fallbackLabel: undefined,
  });
}

function localTargetToHref(data: Data, targetID: ID): string | undefined {
  const graph = graphLookupFromData(data);
  const target = getNodeInSource(graph, { sourceId: LOCAL, id: targetID });
  if (!target) {
    return undefined;
  }
  const parent = target.node.parent
    ? getNodeInSource(graph, {
        sourceId: LOCAL,
        id: target.node.parent,
      })
    : undefined;
  const targetRoot = parent ?? target;
  return buildNodeRouteUrl(targetRoot.node.id, LOCAL, {
    scrollToId:
      targetRoot.node.id === target.node.id ? undefined : target.node.id,
    fallbackLabel: undefined,
  });
}

export function isDeadLinkTarget(
  data: Data,
  href: string,
  source: GraphNode,
  sourceId: SourceId
): boolean {
  if (sourceId !== LOCAL) return false;
  const targetClass = classifyLinkHref(href);
  if (targetClass === "node") {
    return (
      lookupNode(graphLookupFromData(data), href.slice(1), sourceId) ===
      undefined
    );
  }
  if (targetClass !== "document" && targetClass !== "file") return false;
  const hashIndex = href.lastIndexOf("#");
  const path = hashIndex < 0 ? href : href.slice(0, hashIndex);
  return resolveDocumentTarget(data, source, sourceId, path) === undefined;
}

export function inlineLinkToHref(
  data: Data,
  href: string,
  source: GraphNode,
  sourceId: SourceId,
  fallbackLabel?: string
): string | undefined {
  const targetClass = classifyLinkHref(href);
  if (targetClass === "entity" || targetClass === "calendar") {
    const targetID = href.slice(1);
    return sourceId === LOCAL
      ? localTargetToHref(data, targetID) ??
          buildNodeRouteUrl(targetID, LOCAL, {
            scrollToId: undefined,
            fallbackLabel,
          })
      : inlineTargetToHref(data, targetID, sourceId) ??
          localTargetToHref(data, targetID) ??
          buildNodeRouteUrl(targetID, LOCAL, {
            scrollToId: undefined,
            fallbackLabel,
          });
  }
  if (targetClass === "node") {
    return (
      inlineTargetToHref(data, href.slice(1), sourceId) ??
      (sourceId === LOCAL
        ? undefined
        : buildNodeRouteUrl(href.slice(1), sourceId, {
            scrollToId: undefined,
            fallbackLabel: undefined,
          }))
    );
  }
  if (targetClass !== "document" && targetClass !== "file") {
    return undefined;
  }
  const hashIndex = href.lastIndexOf("#");
  const path = hashIndex < 0 ? href : href.slice(0, hashIndex);
  const scrollToId = hashIndex < 0 ? undefined : href.slice(hashIndex + 1);
  const document = resolveDocumentTarget(data, source, sourceId, path);
  return document
    ? buildDocumentRouteUrl(
        document.sourceId,
        document.docId,
        scrollToId || undefined
      )
    : undefined;
}
