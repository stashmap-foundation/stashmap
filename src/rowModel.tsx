/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let, functional/immutable-data */
import React from "react";
import { List } from "immutable";
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
import { composedLine, writtenLine } from "./core/composition";
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

export function isFileRow(row: Pick<Row, "virtualType">): boolean {
  return row.virtualType === undefined;
}

export function viewPathContains(parent: ViewPath, child: ViewPath): boolean {
  return (
    parent.length <= child.length &&
    parent.every((segment, index) => child[index] === segment)
  );
}

export function getIndependentRows(rows: Row[]): Row[] {
  return rows.filter(
    (row) =>
      !rows.some(
        (other) =>
          row.viewKey !== other.viewKey &&
          viewPathContains(other.viewPath, row.viewPath)
      )
  );
}

export function rowNode(row: Row): GraphNode {
  return row.rowType === "occurrence"
    ? composedLine(row.occurrence).node
    : row.node;
}

export function rowID(row: Row): ID {
  return row.rowType === "occurrence" ? row.occurrence.id : row.node.id;
}

export function rowSourceId(row: Row): SourceId {
  return row.rowType === "occurrence"
    ? composedLine(row.occurrence).ref.sourceId
    : row.sourceId;
}

export function rowRef(row: Row): NodeRef {
  return row.rowType === "occurrence"
    ? composedLine(row.occurrence).ref
    : row.ref;
}

export function rowSpans(row: Row): InlineSpan[] {
  return row.rowType === "occurrence" ? row.occurrence.spans : row.node.spans;
}

export function rowRelevance(row: Row): Relevance {
  return row.rowType === "occurrence"
    ? row.occurrence.relevance
    : row.node.relevance;
}

export function rowArgument(row: Row): Argument {
  return row.rowType === "occurrence"
    ? row.occurrence.argument
    : row.node.argument;
}

export function rowChildIndex(row: Row): number | undefined {
  if (row.rowType !== "occurrence") {
    return row.childIndex;
  }
  const line = writtenLine(row.occurrence);
  if (!line) {
    return undefined;
  }
  const index = row.occurrence.origin.physicalPeers.findIndex(
    (peer) => peer.id === line.node.id
  );
  return index < 0 ? undefined : index;
}

export function getVisibleParentRow(
  rows: List<Row>,
  row: Row
): Row | undefined {
  return rows
    .slice(0, row.index)
    .reverse()
    .find((candidate) => candidate.depth === row.depth - 1);
}

export function getPreviousSiblingFromRows(
  rows: List<Row>,
  row: Row
): Row | undefined {
  return rows
    .slice(0, row.index)
    .reverse()
    .takeWhile((candidate) => candidate.depth >= row.depth)
    .find((candidate) => candidate.depth === row.depth);
}

const EMPTY_VIEW_PATH_PREFIX = "empty-row:";

function encodePathID(id: string): string {
  return encodeURIComponent(id);
}

function decodePathID(encoded: string): string {
  return decodeURIComponent(encoded);
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

export function viewPathToString(viewContext: ViewPath): string {
  const paneIndex = viewContext[0] as number;
  const pathPart = (viewContext.slice(1) as readonly ViewPathSegment[])
    .map((segment) => encodePathID(segment))
    .join(":");
  return `p${paneIndex}:${pathPart}`;
}

export function viewKeyForIdentity(
  paneIndex: number,
  context: ID,
  identity: string
): string {
  return viewPathToString([paneIndex, context, identity]);
}

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

export function buildPaneTarget(data: Data, row: Row): EditorNavigationTarget {
  const occurrence = row.rowType === "occurrence" ? row.occurrence : undefined;
  const composedPlacement =
    occurrence?.kind === "placement" || occurrence?.kind === "speaking";
  const terminalTarget =
    composedPlacement &&
    occurrence.flags.some(
      (flag) =>
        flag === "cycle" || flag === "dangling" || flag === "orphan-source"
    )
      ? occurrence.chain[occurrence.chain.length - 1]
      : undefined;
  const sourceId = rowSourceId(row);
  const targetID =
    row.rowType === "search"
      ? searchTargetID(row.node)
      : row.reference?.id ?? terminalTarget;
  const targetSourceId =
    terminalTarget === undefined
      ? sourceId
      : occurrence?.source.parent?.sourceId ?? sourceId;
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
          fallbackLabel: getDisplayTextForRow(row),
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
        sourceId,
        rootNodeId: rowID(row),
        ...(isCanonicalId(rowID(row)) && {
          fallbackLabel: getDisplayTextForRow(row),
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

export function appendToPath(
  [paneIndex, ...segments]: ViewPath,
  nodeID: ID
): ViewPath {
  return [paneIndex, ...segments, nodeID];
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

export function useIsViewingOtherUserContent(): boolean {
  const { user } = useData();
  const { workspace } = useBackend();
  const row = useRow();
  return (!user && !workspace) || rowSourceId(row) !== LOCAL;
}

export function useNodeIndex(): number | undefined {
  return rowChildIndex(useRow());
}

export function useCurrentEdge(): GraphNode {
  return rowNode(useRow());
}

export function getDisplayTextForRow(row: Row): string {
  const { reference } = row;
  if (row.rowType === "occurrence") {
    return row.occurrence.text;
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

export function updateViewKey(
  views: Views,
  key: string,
  nodeID: ID,
  root: boolean,
  view: View
): Views {
  const defaultView = getDefaultView(nodeID, root);
  const isDefault =
    view.expanded === defaultView.expanded &&
    !view.typeFilters &&
    !view.showPastEntries;
  return isDefault ? views.delete(key) : views.set(key, view);
}

export function updateRowView(views: Views, row: Row, view: View): Views {
  return updateViewKey(
    views,
    row.viewKey,
    rowID(row),
    isRoot(row.viewPath),
    view
  );
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
