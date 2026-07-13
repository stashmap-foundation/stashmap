import { calendarFeedUrl, isCalendarEntryId } from "../core/ical";
import { LOCAL } from "../core/nodeRef";
import { Document, getDocumentForNode, documentKeyOf } from "../core/Document";
import {
  getNodeInSource,
  graphLookupFromData,
  lookupNode,
} from "../core/graphLookup";
import { docLinkId, resolveLinkPath } from "../core/linkPath";
import { buildDocumentRouteUrl, buildNodeRouteUrl } from "../navigationUrl";

export type EditorNavigationTarget = {
  sourceId: SourceId;
  documentId?: string;
  rootNodeId?: ID;
  scrollToId?: string;
};

function sourceFilePath(
  data: Pick<Data, "knowledgeDBs" | "documents" | "documentByFilePath">,
  source: GraphNode,
  sourceId: SourceId
): string | undefined {
  return getDocumentForNode(data.knowledgeDBs, data.documents, source, sourceId)
    ?.filePath;
}

export function resolveDocumentTarget(
  data: Pick<Data, "knowledgeDBs" | "documents" | "documentByFilePath">,
  source: GraphNode,
  sourceId: SourceId,
  path: string
): Document | undefined {
  const docId = docLinkId(path);
  if (docId !== undefined) {
    return data.documents.get(documentKeyOf(sourceId, docId));
  }
  const resolvedPath = resolveLinkPath(
    path,
    sourceFilePath(data, source, sourceId)
  );
  return data.documentByFilePath.get(resolvedPath);
}

function calendarEntryFallbackTarget(
  data: Data,
  targetID: ID
): EditorNavigationTarget | undefined {
  if (!isCalendarEntryId(targetID) || !data.calendarFeeds) {
    return undefined;
  }
  const carryingUrl = data.calendarFeeds.findKey((entries) =>
    entries.some((entry) => entry.id === targetID)
  );
  if (!carryingUrl) {
    return undefined;
  }
  const findIn = (sourceId: SourceId): EditorNavigationTarget | undefined => {
    const node = data.knowledgeDBs
      .get(sourceId)
      ?.nodes.find((candidate) => calendarFeedUrl(candidate) === carryingUrl);
    return node
      ? { sourceId, rootNodeId: node.id, scrollToId: targetID }
      : undefined;
  };
  return (
    findIn(LOCAL) ??
    data.knowledgeDBs
      .keySeq()
      .filter((sourceId) => sourceId !== LOCAL)
      .reduce<EditorNavigationTarget | undefined>(
        (found, sourceId) => found ?? findIn(sourceId),
        undefined
      )
  );
}

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
    ? buildNodeRouteUrl(target.rootNodeId, target.sourceId, target.scrollToId)
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
    const fallback = calendarEntryFallbackTarget(data, targetID);
    return fallback ? navigationTargetToHref(fallback) : undefined;
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
    targetRoot.node.id === target.node.id ? undefined : target.node.id
  );
}

// Violet means entity: the one use of color in the link language — the row
// touches the shared world. Links themselves stay unmarked.
export function inlineLinkToHref(
  data: Data,
  href: string,
  source: GraphNode,
  sourceId: SourceId
): string | undefined {
  if (href.startsWith("#")) {
    return inlineTargetToHref(data, href.slice(1), sourceId);
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
