import { createDocumentLinkTarget, createRefTarget } from "../core/connections";
import { ENTITY_SCHEME_RE } from "../core/entityRecognition";
import { icalFeedUrlOf, isCalendarEntryId } from "../core/ical";
import { isBlockLinkAny, nodeText } from "../core/nodeSpans";
import { LOCAL } from "../core/nodeRef";
import { Document, getDocumentForNode, documentKeyOf } from "../core/Document";
import {
  getNodeInSource,
  graphLookupFromData,
  lookupNode,
  resolveBlockLinkTarget,
  ResolvedNode,
} from "../core/graphLookup";
import { Link } from "../core/link";
import { docLinkId, resolveLinkPath } from "../core/linkPath";
import { buildDocumentRouteUrl, buildNodeRouteUrl } from "../navigationUrl";
import { AddToParentTarget } from "../planner";

export type LinkNavigationMode = "link" | "target";

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

function documentTarget(
  data: Pick<Data, "knowledgeDBs" | "documents" | "documentByFilePath">,
  link: Extract<Link, { kind: "document" }>
): Document | undefined {
  const docId = docLinkId(link.path);
  if (docId !== undefined) {
    return data.documents.get(documentKeyOf(link.sourceId, docId));
  }
  const resolvedPath = resolveLinkPath(
    link.path,
    sourceFilePath(data, link.source, link.sourceId)
  );
  return data.documentByFilePath.get(resolvedPath);
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
      ?.nodes.find(
        (candidate) =>
          !isBlockLinkAny(candidate) &&
          icalFeedUrlOf(nodeText(candidate)) === carryingUrl
      );
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

function nodeTarget(
  data: Data,
  link: Extract<Link, { kind: "node" }>,
  mode: LinkNavigationMode
): EditorNavigationTarget | undefined {
  const graph = graphLookupFromData(data);
  const source = sourceResolvedNode(graph, link, link.sourceId);
  const target =
    mode === "target" ? source : resolveBlockLinkTarget(graph, source);
  if (!target) {
    const calendarTarget = calendarEntryFallbackTarget(data, link.targetID);
    if (calendarTarget) {
      return calendarTarget;
    }
    // Entity links resolve to the ordinary node view even without a
    // local page — the computed pin (E6).
    if (ENTITY_SCHEME_RE.test(link.targetID)) {
      return { sourceId: LOCAL, rootNodeId: link.targetID };
    }
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
          sourceId: document.sourceId,
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
      target.sourceId,
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
      target.sourceId,
      target.documentId,
      target.scrollToId
    );
  }
  return target.rootNodeId
    ? buildNodeRouteUrl(target.rootNodeId, target.sourceId, target.scrollToId)
    : undefined;
}

// Inline link spans navigate like block links: to the target in its
// context (parent as root, target scrolled to), but resolved from the
// span's target id directly since the containing node is no block link.
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
export function linkStyle(link: Link): React.CSSProperties {
  if (link.kind === "document") {
    return { fontStyle: "italic" };
  }
  return ENTITY_SCHEME_RE.test(link.targetID) ? { color: "var(--violet)" } : {};
}

export function linkToInsertTarget(
  data: Pick<Data, "knowledgeDBs" | "documents" | "documentByFilePath">,
  link: Link | undefined
): AddToParentTarget | undefined {
  if (!link) {
    return undefined;
  }
  if (link.kind === "document") {
    const document = documentTarget(data, link);
    return document
      ? createDocumentLinkTarget(
          document.sourceId,
          document.docId,
          link.path,
          link.text
        )
      : undefined;
  }
  return createRefTarget(link.targetID, link.text);
}
