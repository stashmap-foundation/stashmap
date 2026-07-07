/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let, functional/immutable-data */
import React from "react";
import { Map } from "immutable";
import { LOCAL } from "./core/nodeRef";
import {
  isSearchId,
  parseSearchId,
  createSearchId,
  EMPTY_SEMANTIC_ID,
  getRefLinkTargetInfo,
  getRefTargetInfo,
  isRefNode,
} from "./core/connections";
import { useData } from "./DataContext";
import { nodeText } from "./core/nodeSpans";
import { getBlockLink } from "./core/blockLink";
import {
  EditorNavigationTarget,
  linkToNavigationTarget,
} from "./editor/linkOperations";

export { newGraphNode } from "./core/nodeFactory";

type ViewPathSegment = ID;

export type ViewPath = readonly [number, ...ViewPathSegment[]];

export const RowContext = React.createContext<Row | undefined>(undefined);

export function useRow(): Row {
  const row = React.useContext(RowContext);
  if (!row) {
    throw new Error("RowContext not provided");
  }
  return row;
}

// A row is either file content or a proposal about file content. Node
// types decide how a row RENDERS; only file rows BEHAVE — host overlays,
// fetch feeds, offer row furniture like the past chip.
export function isFileRow(row: Pick<Row, "virtualType">): boolean {
  return row.virtualType === undefined;
}

// An embed row's expansion shows the TARGET's subtree — computed,
// read-only, for inspection before taking. A non-embed row's expansion
// shows its own children, file truth. The suggestion preview is the one
// embed in the system today; when an explicit embed affordance lands,
// this predicate graduates to a producer-set row field.
export function isEmbedRow(row: Pick<Row, "virtualType" | "node">): boolean {
  return row.virtualType === "suggestion" && isRefNode(row.node);
}

export function getIndependentRows(rows: Row[]): Row[] {
  return rows.filter(
    (row) =>
      !rows.some(
        (other) =>
          row.viewKey !== other.viewKey &&
          row.viewKey.startsWith(`${other.viewKey}:`)
      )
  );
}

const EMPTY_VIEW_PATH_PREFIX = "empty-row:";

// Encode path IDs to handle colons in ref IDs (ref:ctx:target format)
function encodePathID(id: string): string {
  return id.replace(/:/g, "%3A");
}

function decodePathID(encoded: string): string {
  return encoded.replace(/%3A/g, ":");
}

function createEmptyViewPathID(nodeID: ID): string {
  return `${EMPTY_VIEW_PATH_PREFIX}${nodeID}`;
}

export function isEmptyViewPathID(id: ID): boolean {
  return id.startsWith(EMPTY_VIEW_PATH_PREFIX);
}

export function parseViewPath(path: string): ViewPath {
  const pieces = path.split(":");
  if (pieces.length < 2) {
    throw new Error("Invalid view path");
  }

  const panePart = pieces[0];
  if (!panePart.startsWith("p")) {
    throw new Error("Invalid view path");
  }

  const paneIndex = parseInt(panePart.substring(1), 10);
  if (Number.isNaN(paneIndex)) {
    throw new Error("Invalid view path");
  }

  const pathPieces = pieces
    .slice(1)
    .map((piece) => decodePathID(piece) as ViewPathSegment);
  if (pathPieces.length === 0) {
    throw new Error("Invalid view path");
  }

  return [paneIndex, ...pathPieces];
}

function convertViewPathToString(viewContext: ViewPath): string {
  const paneIndex = viewContext[0] as number;
  const pathPart = (viewContext.slice(1) as readonly ViewPathSegment[])
    .map((segment) => encodePathID(segment))
    .join(":");
  return `p${paneIndex}:${pathPart}`;
}

// TODO: delete this export
export const viewPathToString = convertViewPathToString;

export function isRoot(viewPath: ViewPath): boolean {
  return viewPath.length === 2;
}

export function getPaneIndex(viewContext: ViewPath): number {
  return viewContext[0] as number;
}

export function getParentView(viewContext: ViewPath): ViewPath | undefined {
  if (isRoot(viewContext)) {
    return undefined;
  }
  return viewContext.slice(0, -1) as unknown as ViewPath;
}

function getViewExactMatch(views: Views, path: ViewPath): View | undefined {
  const viewKey = viewPathToString(path);
  return views.get(viewKey);
}

export function getLast(viewContext: ViewPath): ViewPathSegment {
  return viewContext[viewContext.length - 1] as ViewPathSegment;
}

function getDefaultView(id: ID, isRootNode: boolean): View {
  return {
    expanded: isRootNode || isSearchId(id),
  };
}

export function getPaneRootItemID(pane: Pane): ID {
  return (
    pane.rootNodeId ||
    (pane.searchQuery ? createSearchId(pane.searchQuery) : undefined) ||
    EMPTY_SEMANTIC_ID
  );
}

export function getViewForRowID(data: Data, path: ViewPath, rowID: ID): View {
  return (
    getViewExactMatch(data.views, path) || getDefaultView(rowID, isRoot(path))
  );
}

export function buildPaneTarget(data: Data, row: Row): EditorNavigationTarget {
  const { virtualType } = row;
  const effectiveAuthor = row.sourceId;
  const blockLink =
    virtualType === "incoming"
      ? undefined
      : getBlockLink(row.node, row.sourceId);
  const blockLinkTarget = blockLink
    ? linkToNavigationTarget(
        data,
        blockLink,
        virtualType === "version" ? "target" : "link"
      )
    : undefined;
  if (blockLinkTarget) {
    return blockLinkTarget;
  }

  const currentReference = getCurrentReferenceForRow(data, row);
  const refInfo = (() => {
    if (!currentReference) {
      if (isRefNode(row.node)) {
        return getRefLinkTargetInfo(
          row.node.id,
          data.knowledgeDBs,
          effectiveAuthor
        );
      }
      return getRefTargetInfo(row.rowID, data.knowledgeDBs, effectiveAuthor);
    }
    return virtualType === "version"
      ? getRefTargetInfo(
          currentReference.id,
          data.knowledgeDBs,
          effectiveAuthor
        )
      : getRefLinkTargetInfo(
          currentReference.id,
          data.knowledgeDBs,
          effectiveAuthor
        );
  })();
  if (refInfo) {
    return {
      sourceId: refInfo.sourceId,
      rootNodeId: refInfo.rootNodeId,
      scrollToId: refInfo.scrollToId,
    };
  }

  return {
    sourceId: row.sourceId,
    rootNodeId: row.node.id,
  };
}

export function useSearchDepth(): number | undefined {
  const row = useRow();
  const [, ...nodeSegments] = row.viewPath;
  const ancestors = nodeSegments.slice(0, -1);
  const searchIndex = ancestors.reduce(
    (found, segment, index) => (isSearchId(segment) ? index : found),
    -1
  );
  return searchIndex === -1 ? undefined : row.depth - searchIndex - 1;
}

export function useIsInSearchView(): boolean {
  return useSearchDepth() !== undefined;
}

export function getCurrentReferenceForRow(
  _data: Data,
  row: Row
): Row["reference"] {
  return row.reference;
}

export function addNodesToLastElement(path: ViewPath, nodeID: ID): ViewPath {
  const last = getLast(path);
  if (last === nodeID) {
    return path;
  }
  return [
    getPaneIndex(path),
    ...(path.slice(1, -1) as ViewPathSegment[]),
    nodeID,
  ] as ViewPath;
}

export function addNodeToPathWithNodes(
  path: ViewPath,
  nodes: GraphNode,
  index: number
): ViewPath {
  const rowID = nodes.children.get(index);
  if (rowID === undefined) {
    throw new Error("No child node found at index");
  }
  const pathWithNodes = addNodesToLastElement(path, nodes.id);
  const nextSegment =
    rowID === EMPTY_SEMANTIC_ID ? createEmptyViewPathID(nodes.id) : rowID;
  return [...pathWithNodes, nextSegment] as ViewPath;
}

export function useCurrentNode(): GraphNode {
  return useRow().node;
}

export function useIsViewingOtherUserContent(): boolean {
  const { user } = useData();
  const row = useRow();
  if (!user) {
    return true;
  }
  return row.sourceId !== LOCAL;
}

export function useNodeIndex(): number | undefined {
  return useRow().childIndex;
}

export function useCurrentEdge(): GraphNode {
  return useRow().node;
}

export function useCurrentRowID(): [ID, View] {
  const row = useRow();
  return [row.rowID, row.view];
}

export function getDisplayTextForRow(data: Data, row: Row): string {
  if (row.renameSuggestion) {
    return `${row.renameSuggestion.mine} ${row.renameSuggestion.theirs}`;
  }
  // A version row's text IS its meta: date, author mark, diff counts.
  if (row.virtualType === "version" && row.versionMeta) {
    const meta = row.versionMeta;
    return [
      new Date(meta.updated).toLocaleString(),
      ...(row.sourceId !== LOCAL ? ["\u{1F464}"] : []),
      ...(meta.direct ? [`±${meta.addCount + meta.removeCount}`] : []),
      ...(!meta.direct && meta.addCount > 0 ? [`+${meta.addCount}`] : []),
      ...(!meta.direct && meta.removeCount > 0 ? [`-${meta.removeCount}`] : []),
    ].join(" ");
  }
  const reference = getCurrentReferenceForRow(data, row);
  if (reference) {
    return reference.text;
  }
  if (isSearchId(row.rowID)) {
    const query = parseSearchId(row.rowID) || "";
    return `Search: ${query}`;
  }
  return nodeText(row.node);
}

export function useDisplayText(): string {
  const data = useData();
  return getDisplayTextForRow(data, useRow());
}

export function useIsExpanded(): boolean {
  return useRow().view.expanded === true;
}

export function useIsRoot(): boolean {
  return useRow().depth === 1;
}

export function updateView(views: Views, path: ViewPath, view: View): Views {
  const key = viewPathToString(path);
  const rowID = getLast(path);
  const defaultView = getDefaultView(rowID, isRoot(path));
  const isDefault =
    view.expanded === defaultView.expanded &&
    !view.typeFilters &&
    !view.showPastEntries;
  if (isDefault) {
    return views.delete(key);
  }
  return views.set(key, view);
}

export function copyViewsWithNewPrefix(
  views: Views,
  sourceKey: string,
  targetKey: string
): Views {
  const viewsToCopy = views.filter(
    (_, k) => k.startsWith(`${sourceKey}:`) || k === sourceKey
  );
  return viewsToCopy.reduce((acc, view, key) => {
    const newKey = targetKey + key.slice(sourceKey.length);
    return acc.set(newKey, view);
  }, views);
}

export function copyViewsWithNodesMapping(
  views: Views,
  sourceKey: string,
  targetKey: string,
  nodesIdMapping: Map<ID, ID>
): Views {
  const viewsToCopy = views.filter(
    (_, k) => k.startsWith(`${sourceKey}:`) || k === sourceKey
  );
  return viewsToCopy.reduce((acc, view, key) => {
    const suffix = key.slice(sourceKey.length);
    const mappedSuffix = nodesIdMapping.reduce(
      (s, newId, oldId) => s.split(oldId).join(newId),
      suffix
    );
    const newKey = targetKey + mappedSuffix;
    return acc.set(newKey, view);
  }, views);
}

function pathContainsSubpath(
  path: ViewPath,
  subpath: ViewPathSegment[]
): boolean {
  if (subpath.length === 0 || path.length - 1 < subpath.length) {
    return false;
  }
  const segments = path.slice(1) as ViewPathSegment[];
  return segments.some((_, index) =>
    subpath.every((segment, offset) => segments[index + offset] === segment)
  );
}

export function updateViewPathsAfterMoveNodes(
  data: Pick<Data, "views">
): Views {
  return data.views;
}

export function updateViewPathsAfterDisconnect(
  views: Views,
  disconnectNode: ID,
  fromNode: ID
): Views {
  return views.filterNot((_, key) => {
    try {
      return pathContainsSubpath(parseViewPath(key), [
        fromNode,
        disconnectNode,
      ]);
    } catch {
      return false;
    }
  });
}

export function updateViewPathsAfterPaneDelete(
  views: Views,
  removedPaneIndex: number
): Views {
  return views
    .filterNot((_, key) => key.startsWith(`p${removedPaneIndex}:`))
    .mapKeys((key) => {
      const match = key.match(/^p(\d+):/);
      if (!match) return key;
      const paneIndex = parseInt(match[1], 10);
      if (paneIndex > removedPaneIndex) {
        return key.replace(/^p\d+:/, `p${paneIndex - 1}:`);
      }
      return key;
    });
}

export function updateViewPathsAfterPaneInsert(
  views: Views,
  insertedPaneIndex: number
): Views {
  // When inserting a pane at index N, shift all pane indices >= N up by 1
  return views.mapKeys((key) => {
    const match = key.match(/^p(\d+):/);
    if (!match) return key;
    const paneIndex = parseInt(match[1], 10);
    if (paneIndex >= insertedPaneIndex) {
      return key.replace(/^p\d+:/, `p${paneIndex + 1}:`);
    }
    return key;
  });
}

export function bulkUpdateViewPathsAfterAddNode(data: Data): Views {
  return data.views;
}
