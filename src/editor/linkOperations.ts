import { LOCAL } from "../core/nodeRef";
import { documentKeyOf } from "../core/Document";
import {
  getNodeInSource,
  graphLookupFromData,
  lookupNode,
  resolveRef,
} from "../core/graphLookup";
import { classifyLinkHref, resolveLink } from "../core/linkPath";
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
    return buildDocumentRouteUrl(target.sourceId, target.documentId);
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
  return buildNodeRouteUrl(
    targetRoot.node.id,
    targetRoot.ref.sourceId,
    {
      scrollToId:
        targetRoot.node.id === target.node.id ? undefined : target.node.id,
      fallbackLabel: undefined,
    },
    data.pull?.coordinatesBySourceId.get(targetRoot.ref.sourceId)
  );
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

export function rowRouteHref(data: Data, target: NodeRef): string | undefined {
  return (
    inlineTargetToHref(data, target.id, target.sourceId) ??
    (target.sourceId === LOCAL
      ? undefined
      : buildNodeRouteUrl(target.id, target.sourceId, {
          scrollToId: undefined,
          fallbackLabel: undefined,
        }))
  );
}

export function isDeadLinkTarget(
  data: Data,
  href: string,
  source: GraphNode,
  sourceId: SourceId
): boolean {
  if (sourceId !== LOCAL) return false;
  const targetClass = classifyLinkHref(href);
  if (targetClass !== "node" && targetClass !== "file") return false;
  const target = resolveLink(href, { sourceId, id: source.id });
  return (
    target === undefined ||
    (target.sourceId === LOCAL &&
      resolveRef(graphLookupFromData(data), target) === undefined)
  );
}

export function inlineLinkToHref(
  data: Data,
  href: string,
  source: GraphNode,
  sourceId: SourceId,
  fallbackLabel?: string
): string | undefined {
  const targetClass = classifyLinkHref(href);
  const target = resolveLink(href, { sourceId, id: source.id });
  if (!target) {
    return undefined;
  }
  if (targetClass === "calendar" || targetClass === "thing") {
    return sourceId === LOCAL
      ? localTargetToHref(data, target.id) ??
          buildNodeRouteUrl(target.id, LOCAL, {
            scrollToId: undefined,
            fallbackLabel,
          })
      : inlineTargetToHref(data, target.id, sourceId) ??
          localTargetToHref(data, target.id) ??
          buildNodeRouteUrl(target.id, LOCAL, {
            scrollToId: undefined,
            fallbackLabel,
          });
  }
  if (targetClass === "node") {
    return rowRouteHref(data, target);
  }
  return target.sourceId !== LOCAL ||
    data.documents.has(documentKeyOf(target.sourceId, target.id))
    ? buildDocumentRouteUrl(
        target.sourceId,
        target.id,
        data.pull?.coordinatesBySourceId.get(target.sourceId)
      )
    : undefined;
}
