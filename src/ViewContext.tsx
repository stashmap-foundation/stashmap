/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let, functional/immutable-data */
import React from "react";
import { List, Map } from "immutable";
import {
  computeEmptyNodeMetadata,
  getNode,
  shortID,
  isSearchId,
  parseSearchId,
  EMPTY_SEMANTIC_ID,
  itemPassesFilters,
  getNodeContext,
  getNodeSemanticID,
  getSemanticID,
  getRefLinkTargetInfo,
  getRefTargetInfo,
  isRefNode,
} from "./connections";
import { buildReferenceItem } from "./buildReferenceRow";
import { resolveSemanticNodeInCurrentTree } from "./semanticNavigation";
import { useData } from "./DataContext";
import { Plan, planUpsertNodes, getPane } from "./planner";
import { usePaneStack } from "./SplitPanesContext";
import { DEFAULT_TYPE_FILTERS } from "./constants";
import { newNode } from "./nodeFactory";
import { getNodeUserPublicKey } from "./userEntry";

export { newNode } from "./nodeFactory";

type ViewPathSegment = ID;

export type ViewPath = readonly [number, ...ViewPathSegment[]];

export const ViewContext = React.createContext<ViewPath | undefined>(undefined);

export function useViewPath(): ViewPath {
  const context = React.useContext(ViewContext);
  if (!context) {
    throw new Error("ViewContext not provided");
  }
  return context;
}

export type VirtualRowsMap = Map<string, GraphNode>;

const VirtualRowsContext = React.createContext<VirtualRowsMap>(
  Map<string, GraphNode>()
);

const EMPTY_VIEW_PATH_PREFIX = "empty-row:";

export const VirtualRowsProvider = VirtualRowsContext.Provider;

export function useVirtualRowsMap(): VirtualRowsMap {
  return React.useContext(VirtualRowsContext);
}

// Encode path IDs to handle colons in ref IDs (ref:ctx:target format)
function encodePathID(id: string): string {
  return id.replace(/:/g, "%3A");
}

function decodePathID(encoded: string): string {
  return encoded.replace(/%3A/g, ":");
}

function createEmptyViewPathID(nodeID: LongID): string {
  return `${EMPTY_VIEW_PATH_PREFIX}${nodeID}`;
}

function isEmptyViewPathID(id: ID): boolean {
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

function getContextFromStack(stack: ID[]): Context {
  return List(stack.slice(0, -1));
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

export function getContext(
  data: Data,
  viewPath: ViewPath,
  stack: ID[]
): Context {
  const directNode = getViewNodeByID(
    data.knowledgeDBs,
    getLast(viewPath),
    data.user.publicKey
  );
  if (directNode) {
    return getNodeContext(data.knowledgeDBs, directNode);
  }
  if (isRoot(viewPath)) {
    return getContextFromStack(stack);
  }
  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    throw new Error("Cannot determine context: no parent path found");
  }
  const parentContext = getContext(data, parentPath, stack);
  const parentNode = getNodeForView(data, parentPath, stack);
  if (parentNode) {
    return parentContext.push(getSemanticID(data.knowledgeDBs, parentNode));
  }
  const [parentRowID] = getRowIDFromView(data, parentPath);
  return parentContext.push(shortID(parentRowID as ID) as ID);
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

function getViewFromPath(data: Data, path: ViewPath): View {
  const rowID = getRowIDFromPath(data, path);
  return (
    getViewExactMatch(data.views, path) || getDefaultView(rowID, isRoot(path))
  );
}

function getViewNodeByID(
  knowledgeDBs: KnowledgeDBs,
  id: ID,
  myself: PublicKey
): GraphNode | undefined {
  return getNode(knowledgeDBs, id, myself);
}

function getEmptyNodeItem(
  data: Data,
  parentNode: GraphNode | undefined
): GraphNode | undefined {
  if (!parentNode) {
    return undefined;
  }
  return computeEmptyNodeMetadata(data.publishEventsStatus.temporaryEvents).get(
    parentNode.id as LongID
  )?.nodeItem;
}

function getRowIDFromPath(data: Data, viewPath: ViewPath): ID {
  const currentID = getLast(viewPath);
  if (isEmptyViewPathID(currentID)) {
    return EMPTY_SEMANTIC_ID;
  }
  const node = getNode(data.knowledgeDBs, currentID, data.user.publicKey);
  if (!node) {
    return currentID;
  }
  if (isRefNode(node)) {
    return node.id;
  }
  return getNodeSemanticID(node);
}

export function getRowIDFromView(data: Data, viewPath: ViewPath): [ID, View] {
  const view = getViewFromPath(data, viewPath);
  return [getRowIDFromPath(data, viewPath), view];
}

function getRowIDsForViewPath(data: Data, viewPath: ViewPath): Array<ID> {
  const paneIndex = getPaneIndex(viewPath);
  return (viewPath.slice(1) as ViewPathSegment[]).map((_, index, segments) =>
    getRowIDFromPath(data, [paneIndex, ...segments.slice(0, index + 1)])
  );
}

export function getParentNode(
  data: Data,
  viewPath: ViewPath
): GraphNode | undefined {
  if (isRoot(viewPath)) {
    return undefined;
  }
  const parentID = viewPath[viewPath.length - 2] as ViewPathSegment;
  return getNode(data.knowledgeDBs, parentID, data.user.publicKey);
}

export function getEffectiveAuthor(data: Data, viewPath: ViewPath): PublicKey {
  const pane = getPane(data, viewPath);
  const parentNode = getParentNode(data, viewPath);
  return parentNode?.author || pane.author;
}

export function getNodeForView(
  data: Data,
  viewPath: ViewPath,
  stack: ID[]
): GraphNode | undefined {
  const currentID = getLast(viewPath);
  const directNode = getViewNodeByID(
    data.knowledgeDBs,
    currentID,
    data.user.publicKey
  );
  if (directNode) {
    return directNode;
  }

  if (!isRoot(viewPath)) {
    return undefined;
  }

  const [rowID] = getRowIDFromView(data, viewPath);
  const semanticContext = getContext(data, viewPath, stack);
  const pane = getPane(data, viewPath);
  const parentRoot = getParentNode(data, viewPath)?.root;
  const author = getEffectiveAuthor(data, viewPath);

  return resolveSemanticNodeInCurrentTree(
    data.knowledgeDBs,
    author,
    rowID,
    semanticContext,
    pane.rootNodeId,
    isRoot(viewPath),
    parentRoot
  );
}

export function buildPaneTarget(
  data: Data,
  viewPath: ViewPath,
  paneStack: ID[],
  currentRow?: GraphNode
): {
  stack: ID[];
  author: PublicKey;
  rootNodeId?: LongID;
  scrollToId?: string;
} {
  const [rowID] = getRowIDFromView(data, viewPath);
  const effectiveAuthor = getEffectiveAuthor(data, viewPath);
  const currentEdge = currentRow || getCurrentEdgeForView(data, viewPath);
  const virtualType = currentEdge?.virtualType;
  const currentNode = getNodeForView(data, viewPath, paneStack);
  const currentReference = getCurrentReferenceForView(
    data,
    viewPath,
    paneStack,
    virtualType,
    currentEdge
  );
  const refInfo = (() => {
    if (!currentReference) {
      if (isRefNode(currentEdge)) {
        return getRefLinkTargetInfo(
          currentEdge.id,
          data.knowledgeDBs,
          effectiveAuthor
        );
      }
      if (isRefNode(currentNode)) {
        return getRefLinkTargetInfo(
          currentNode.id,
          data.knowledgeDBs,
          effectiveAuthor
        );
      }
      return getRefTargetInfo(rowID, data.knowledgeDBs, effectiveAuthor);
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
      stack: refInfo.stack,
      author: refInfo.author,
      rootNodeId: refInfo.rootNodeId,
      scrollToId: refInfo.scrollToId,
    };
  }

  const paneStackWithoutRoot = paneStack.slice(0, -1);
  const fullStack = [
    ...paneStackWithoutRoot,
    ...getRowIDsForViewPath(data, viewPath),
  ];
  const node = getNodeForView(data, viewPath, paneStack);
  return {
    stack: fullStack,
    author: effectiveAuthor,
    rootNodeId: node?.id,
  };
}

export function useSearchDepth(): number | undefined {
  const data = useData();
  const viewPath = useViewPath();

  const loop = (
    currentPath: ViewPath | undefined,
    depth: number
  ): number | undefined => {
    if (!currentPath) return undefined;
    const [rowID] = getRowIDFromView(data, currentPath);
    if (isSearchId(rowID as ID)) {
      return depth;
    }
    return loop(getParentView(currentPath), depth + 1);
  };

  return loop(getParentView(viewPath), 1);
}

export function useIsInSearchView(): boolean {
  return useSearchDepth() !== undefined;
}

export function getCurrentReferenceForView(
  data: Data,
  viewPath: ViewPath,
  stack: ID[],
  virtualType?: VirtualType,
  currentRow?: GraphNode
): ReferenceRow | undefined {
  const currentEdge = currentRow || getCurrentEdgeForView(data, viewPath);
  const currentNode = getNodeForView(data, viewPath, stack);
  let referenceID: LongID | undefined;
  if (isRefNode(currentEdge)) {
    referenceID = currentEdge.id as LongID;
  } else if (isRefNode(currentNode)) {
    referenceID = currentNode.id as LongID;
  }
  if (!referenceID) {
    return undefined;
  }
  return buildReferenceItem(referenceID, data, viewPath, stack, virtualType);
}

export function addNodesToLastElement(
  path: ViewPath,
  nodeID: LongID
): ViewPath {
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

function addNodeToPath(
  data: Data,
  path: ViewPath,
  index: number,
  stack: ID[]
): ViewPath {
  const nodes = getNodeForView(data, path, stack);
  if (!nodes) {
    throw new Error("Parent doesn't have nodes, cannot add to path");
  }
  return addNodeToPathWithNodes(path, nodes, index);
}

export function useEffectiveAuthor(): PublicKey {
  const data = useData();
  const viewPath = useViewPath();
  return getEffectiveAuthor(data, viewPath);
}

export function useCurrentNode(): GraphNode | undefined {
  const data = useData();
  const viewPath = useViewPath();
  const stack = usePaneStack();
  return getNodeForView(data, viewPath, stack);
}

export function useIsViewingOtherUserContent(): boolean {
  const { user } = useData();
  const effectiveAuthor = useEffectiveAuthor();
  return effectiveAuthor !== user.publicKey;
}

export function getNodeIndexForView(
  data: Data,
  viewPath: ViewPath
): number | undefined {
  const nodes = getParentNode(data, viewPath);
  if (!nodes) {
    return undefined;
  }
  const rowID = getLast(viewPath);
  const index = nodes.children.findIndex(
    (childID) =>
      childID === rowID ||
      (childID === EMPTY_SEMANTIC_ID && isEmptyViewPathID(rowID))
  );
  return index >= 0 ? index : undefined;
}

export function useNodeIndex(): number | undefined {
  const path = useViewPath();
  const data = useData();
  return getNodeIndexForView(data, path);
}

export function getCurrentEdgeForView(
  data: Data,
  viewPath: ViewPath
): GraphNode | undefined {
  const parentNode = getParentNode(data, viewPath);
  if (!parentNode) {
    return undefined;
  }
  const index = getNodeIndexForView(data, viewPath);
  if (index === undefined) {
    return undefined;
  }
  const childID = parentNode.children.get(index);
  if (childID === undefined) {
    return undefined;
  }
  if (childID === EMPTY_SEMANTIC_ID) {
    return getEmptyNodeItem(data, parentNode);
  }
  return getNode(data.knowledgeDBs, childID, data.user.publicKey);
}

export function useCurrentEdge(): GraphNode | undefined {
  const virtualRows = React.useContext(VirtualRowsContext);
  const data = useData();
  const viewPath = useViewPath();
  const viewKey = viewPathToString(viewPath);
  const virtualRow = virtualRows.get(viewKey);
  if (virtualRow) {
    return virtualRow;
  }
  return getCurrentEdgeForView(data, viewPath);
}

type SiblingInfo = {
  viewPath: ViewPath;
  rowID: ID;
  view: View;
};

export function getPreviousSibling(
  data: Data,
  viewPath: ViewPath,
  stack: ID[]
): SiblingInfo | undefined {
  const nodeIndex = getNodeIndexForView(data, viewPath);
  if (nodeIndex === undefined || nodeIndex === 0) {
    return undefined;
  }

  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    return undefined;
  }

  const parentNode = getParentNode(data, viewPath);
  if (!parentNode) {
    return undefined;
  }

  const pane = getPane(data, viewPath);
  const activeFilters = pane.typeFilters || DEFAULT_TYPE_FILTERS;

  const prevIndex = parentNode.children
    .slice(0, nodeIndex)
    .reduce<number>((found, childID, i) => {
      if (childID === EMPTY_SEMANTIC_ID) {
        return found;
      }
      const childNode = getNode(
        data.knowledgeDBs,
        childID,
        data.user.publicKey
      );
      return childNode && itemPassesFilters(childNode, activeFilters)
        ? i
        : found;
    }, -1);

  if (prevIndex === -1) {
    return undefined;
  }

  try {
    const prevSiblingPath = addNodeToPath(data, parentPath, prevIndex, stack);
    const [prevRowID, prevView] = getRowIDFromView(data, prevSiblingPath);
    return {
      viewPath: prevSiblingPath,
      rowID: prevRowID,
      view: prevView,
    };
  } catch {
    return undefined;
  }
}

export function usePreviousSibling(): SiblingInfo | undefined {
  const data = useData();
  const viewPath = useViewPath();
  const stack = usePaneStack();
  return getPreviousSibling(data, viewPath, stack);
}

export function RootViewContextProvider({
  children,
  root,
  paneIndex = 0,
  indices, // TODO: only used in tests, get rid of it
}: {
  children: React.ReactNode;
  root: ID;
  paneIndex?: number;
  indices?: List<number>;
}): JSX.Element {
  const data = useData();
  const stack = usePaneStack();
  const pane = data.panes[paneIndex];
  const rootContext = getContextFromStack(stack);
  const resolvedRootNode = pane?.rootNodeId
    ? getNode(data.knowledgeDBs, pane.rootNodeId, data.user.publicKey)
    : resolveSemanticNodeInCurrentTree(
        data.knowledgeDBs,
        pane?.author || data.user.publicKey,
        root,
        rootContext,
        undefined,
        true
      );
  const startPath: ViewPath = [paneIndex, resolvedRootNode?.id || root];
  const finalPath = (indices || List<number>()).reduce(
    (acc, index) => addNodeToPath(data, acc, index, stack),
    startPath
  );
  return (
    <ViewContext.Provider value={finalPath}>{children}</ViewContext.Provider>
  );
}

export function useCurrentRowID(): [ID, View] {
  const data = useData();
  const viewPath = useViewPath();
  return getRowIDFromView(data, viewPath);
}

export function getDisplayTextForView(
  data: Data,
  viewPath: ViewPath,
  stack: ID[],
  virtualType?: VirtualType,
  currentRow?: GraphNode
): string {
  const reference = getCurrentReferenceForView(
    data,
    viewPath,
    stack,
    virtualType,
    currentRow
  );
  if (reference) {
    return reference.text;
  }
  const [rowID] = getRowIDFromView(data, viewPath);
  if (isSearchId(rowID as ID)) {
    const query = parseSearchId(rowID as ID) || "";
    return `Search: ${query}`;
  }
  const ownNode = getNodeForView(data, viewPath, stack);
  const userPublicKey = getNodeUserPublicKey(ownNode);
  const contactPetname = userPublicKey
    ? data.contacts.get(userPublicKey)?.userName
    : undefined;
  if (contactPetname) {
    return contactPetname;
  }
  return ownNode?.text ?? "";
}

export function useDisplayText(): string {
  const data = useData();
  const viewPath = useViewPath();
  const stack = usePaneStack();
  const currentRow = useCurrentEdge();
  const virtualType = currentRow?.virtualType;
  return getDisplayTextForView(data, viewPath, stack, virtualType, currentRow);
}

export function isExpanded(data: Data, viewKey: string): boolean {
  const viewPath = parseViewPath(viewKey);
  const view = getViewFromPath(data, viewPath);
  return view.expanded === true;
}

export function useViewKey(): string {
  return viewPathToString(useViewPath());
}

export function useIsExpanded(): boolean {
  const data = useData();
  const viewKey = useViewKey();
  return isExpanded(data, viewKey);
}

export function useIsRoot(): boolean {
  return isRoot(useViewPath());
}

export function getParentKey(viewKey: string): string {
  return viewKey.split(":").slice(0, -1).join(":");
}

export function updateView(views: Views, path: ViewPath, view: View): Views {
  const key = viewPathToString(path);
  const rowID = getLast(path);
  const defaultView = getDefaultView(rowID, isRoot(path));
  const isDefault = view.expanded === defaultView.expanded && !view.typeFilters;
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
  nodesIdMapping: Map<LongID, LongID>
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

export function upsertNodes(
  plan: Plan,
  viewPath: ViewPath,
  stack: ID[],
  modify: (nodes: GraphNode) => GraphNode
): Plan {
  const semanticContext = getContext(plan, viewPath, stack);
  const parentNode = getParentNode(plan, viewPath);
  const parentRoot = parentNode?.root;
  const currentNode = getNodeForView(plan, viewPath, stack);

  if (currentNode && currentNode.author !== plan.user.publicKey) {
    throw new Error("Cannot edit another user's nodes");
  }

  const base =
    currentNode ||
    newNode(
      "",
      semanticContext,
      plan.user.publicKey,
      parentRoot,
      parentNode?.id
    );

  // Apply modification
  const updatedNodes = modify(base);

  // Skip event if children unchanged
  if (currentNode && currentNode.children.equals(updatedNodes.children)) {
    return plan;
  }

  return planUpsertNodes(plan, updatedNodes);
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

export function updateViewPathsAfterMoveNodes(data: Data): Views {
  return data.views;
}

export function updateViewPathsAfterDisconnect(
  views: Views,
  disconnectNode: ID,
  fromNode: LongID
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
