/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let, functional/immutable-data */
import React from "react";
import { LOCAL } from "./core/nodeRef";
import { useBackend } from "./BackendContext";
import { useData } from "./DataContext";
import {
  isSearchId,
  parseSearchId,
  createSearchId,
  EMPTY_NODE_ID,
  getRefTargetInfo,
} from "./core/connections";
import { isCanonicalId } from "./core/entityRecognition";
import { nodeText } from "./core/nodeSpans";
import { graphLookupFromData, lookupNode } from "./core/graphLookup";
import { EditorNavigationTarget } from "./editor/linkOperations";
import { searchTargetID } from "./localSearch";

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
    EMPTY_NODE_ID
  );
}

function getViewExactMatch(views: Views, path: ViewPath): View | undefined {
  const viewKey = viewPathToString(path);
  return views.get(viewKey);
}

export function getViewForNode(data: Data, path: ViewPath, nodeID: ID): View {
  return (
    getViewExactMatch(data.views, path) || getDefaultView(nodeID, isRoot(path))
  );
}

// A row's view state lives under its full path of stable ids. When a touch
// swaps a row's id (a judged base row becomes the reader's claim line), the
// swapped-in row inherits state through its target: each candidate joins the
// parent's resolved key with the row's id or its target, so the takeover
// chains to every depth without rewriting stored keys.
export function resolveRowView(
  data: Data,
  path: ViewPath,
  parentStateKey: string | undefined,
  candidates: ID[]
): { view: View; key: string } {
  const exactParent = getParentView(path);
  const parentKeys = [
    ...(exactParent ? [viewPathToString(exactParent)] : []),
    ...(parentStateKey !== undefined ? [parentStateKey] : []),
  ].filter((key, index, keys) => keys.indexOf(key) === index);
  const prefixes =
    parentKeys.length > 0 ? parentKeys : [`p${getPaneIndex(path)}`];
  const keys = prefixes.flatMap((prefix) =>
    candidates.map((candidate) => `${prefix}:${encodePathID(candidate)}`)
  );
  const found = keys.reduce<{ view: View; key: string } | undefined>(
    (hit, key) => {
      if (hit) {
        return hit;
      }
      const view = data.views.get(key);
      return view ? { view, key } : undefined;
    },
    undefined
  );
  return (
    found ?? {
      view: getDefaultView(candidates[0], isRoot(path)),
      key: keys[0],
    }
  );
}

export function buildPaneTarget(data: Data, row: Row): EditorNavigationTarget {
  const composedPlacement =
    row.composed?.kind === "placement" || row.composed?.kind === "speaking";
  const terminalTarget =
    composedPlacement &&
    row.composed?.flags.some(
      (flag) =>
        flag === "cycle" || flag === "dangling" || flag === "orphan-source"
    )
      ? row.composed.chain[row.composed.chain.length - 1]
      : undefined;
  const targetID =
    row.virtualType === "search"
      ? searchTargetID(row.node)
      : row.reference?.id ?? terminalTarget;
  const targetSourceId =
    terminalTarget === undefined
      ? row.sourceId
      : row.composed?.sourceParent?.sourceId ?? row.sourceId;
  const resolvedTarget = terminalTarget
    ? lookupNode(graphLookupFromData(data), terminalTarget, targetSourceId)
    : undefined;
  const refInfo = targetID
    ? getRefTargetInfo(
        targetID,
        data.knowledgeDBs,
        resolvedTarget?.ref.sourceId ?? targetSourceId
      )
    : undefined;
  if (terminalTarget !== undefined && resolvedTarget === undefined) {
    return isCanonicalId(terminalTarget)
      ? {
          sourceId: targetSourceId,
          rootNodeId: terminalTarget,
          fallbackLabel: nodeText(row.node),
        }
      : { sourceId: targetSourceId };
  }
  return refInfo
    ? {
        sourceId: refInfo.sourceId,
        rootNodeId: refInfo.rootNodeId,
        scrollToId: refInfo.scrollToId,
      }
    : {
        sourceId: row.sourceId,
        rootNodeId: row.node.id,
        ...(isCanonicalId(row.node.id) && {
          fallbackLabel: nodeText(row.node),
        }),
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
  const nodeID = nodes.children.get(index);
  if (nodeID === undefined) {
    throw new Error("No child node found at index");
  }
  const pathWithNodes = addNodesToLastElement(path, nodes.id);
  const nextSegment =
    nodeID === EMPTY_NODE_ID ? createEmptyViewPathID(nodes.id) : nodeID;
  return [...pathWithNodes, nextSegment] as ViewPath;
}

export function useCurrentNode(): GraphNode {
  return useRow().node;
}

export function useIsViewingOtherUserContent(): boolean {
  const { user } = useData();
  const { workspace } = useBackend();
  const row = useRow();
  return (!user && !workspace) || row.sourceId !== LOCAL;
}

export function useNodeIndex(): number | undefined {
  return useRow().childIndex;
}

export function useCurrentEdge(): GraphNode {
  return useRow().node;
}

export function getDisplayTextForRow(row: Row): string {
  const { reference } = row;
  if (row.standsFor?.liveText !== undefined) {
    return row.standsFor.liveText;
  }
  if (
    row.virtualType === undefined &&
    row.node.spans.some((span) => span.kind === "link")
  ) {
    return nodeText(row.node);
  }
  if (reference) return reference.text;
  if (isSearchId(row.node.id)) {
    const query = parseSearchId(row.node.id) || "";
    return `Search: ${query}`;
  }
  return nodeText(row.node);
}

export function useDisplayText(): string {
  return getDisplayTextForRow(useRow());
}

export function useIsExpanded(): boolean {
  return useRow().view.expanded === true;
}

export function useIsRoot(): boolean {
  return useRow().depth === 1;
}

export function updateView(views: Views, path: ViewPath, view: View): Views {
  const key = viewPathToString(path);
  const nodeID = getLast(path);
  const defaultView = getDefaultView(nodeID, isRoot(path));
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
