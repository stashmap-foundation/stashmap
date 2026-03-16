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
import type { VirtualRowsMap } from "./rows/types";
import {
  getLast,
  getPaneIndex,
  getParentRowPath,
  isRoot,
  RowPath,
  rowPathToString,
} from "./session/rowPaths";
import { isExpanded } from "./session/views";

export { newNode } from "./nodeFactory";
export {
  getLast,
  getPaneIndex,
  getParentRowPath,
  isRoot,
  parseRowPath,
  type RowPath,
  rowPathToString,
} from "./session/rowPaths";
export {
  bulkUpdateRowPathsAfterAddNode,
  copyViewsWithNewPrefix,
  copyViewsWithNodesMapping,
  getParentKey,
  isExpanded,
  updateRowPathsAfterDisconnect,
  updateRowPathsAfterMoveNodes,
  updateRowPathsAfterPaneDelete,
  updateRowPathsAfterPaneInsert,
  updateView,
} from "./session/views";

export const ViewContext = React.createContext<RowPath | undefined>(undefined);

export function useRowPath(): RowPath {
  const context = React.useContext(ViewContext);
  if (!context) {
    throw new Error("ViewContext not provided");
  }
  return context;
}

export type { VirtualRowsMap } from "./rows/types";

const VirtualRowsContext = React.createContext<VirtualRowsMap>(
  Map<string, GraphNode>()
);

const EMPTY_ROW_PATH_PREFIX = "empty-row:";

export const VirtualRowsProvider = VirtualRowsContext.Provider;

export function useVirtualRowsMap(): VirtualRowsMap {
  return React.useContext(VirtualRowsContext);
}

function createEmptyRowPathID(nodeID: LongID): string {
  return `${EMPTY_ROW_PATH_PREFIX}${nodeID}`;
}

function isEmptyRowPathID(id: ID): boolean {
  return id.startsWith(EMPTY_ROW_PATH_PREFIX);
}

function getContextFromStack(stack: ID[]): Context {
  return List(stack.slice(0, -1));
}

export function getContext(data: Data, rowPath: RowPath, stack: ID[]): Context {
  const directNode = getViewNodeByID(
    data.knowledgeDBs,
    getLast(rowPath),
    data.user.publicKey
  );
  if (directNode) {
    return getNodeContext(data.knowledgeDBs, directNode);
  }
  if (isRoot(rowPath)) {
    return getContextFromStack(stack);
  }
  const parentPath = getParentRowPath(rowPath);
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

function getViewExactMatch(views: Views, path: RowPath): View | undefined {
  const viewKey = rowPathToString(path);
  return views.get(viewKey);
}

function getViewFromPath(data: Data, path: RowPath): View {
  const rowID = getRowIDFromPath(data, path);
  return (
    getViewExactMatch(data.views, path) || {
      expanded: isRoot(path) || isSearchId(rowID),
    }
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

function getRowIDFromPath(data: Data, rowPath: RowPath): ID {
  const currentID = getLast(rowPath);
  if (isEmptyRowPathID(currentID)) {
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

export function getRowIDFromView(data: Data, rowPath: RowPath): [ID, View] {
  const view = getViewFromPath(data, rowPath);
  return [getRowIDFromPath(data, rowPath), view];
}

function getRowIDsForRowPath(data: Data, rowPath: RowPath): Array<ID> {
  const paneIndex = getPaneIndex(rowPath);
  return (rowPath.slice(1) as ID[]).map((_, index, segments) =>
    getRowIDFromPath(data, [paneIndex, ...segments.slice(0, index + 1)])
  );
}

export function getParentNode(
  data: Data,
  rowPath: RowPath
): GraphNode | undefined {
  if (isRoot(rowPath)) {
    return undefined;
  }
  const parentID = rowPath[rowPath.length - 2] as ID;
  return getNode(data.knowledgeDBs, parentID, data.user.publicKey);
}

export function getEffectiveAuthor(data: Data, rowPath: RowPath): PublicKey {
  const pane = getPane(data, rowPath);
  const parentNode = getParentNode(data, rowPath);
  return parentNode?.author || pane.author;
}

export function getNodeForView(
  data: Data,
  rowPath: RowPath,
  stack: ID[]
): GraphNode | undefined {
  const currentID = getLast(rowPath);
  const directNode = getViewNodeByID(
    data.knowledgeDBs,
    currentID,
    data.user.publicKey
  );
  if (directNode) {
    return directNode;
  }

  if (!isRoot(rowPath)) {
    return undefined;
  }

  const [rowID] = getRowIDFromView(data, rowPath);
  const semanticContext = getContext(data, rowPath, stack);
  const pane = getPane(data, rowPath);
  const parentRoot = getParentNode(data, rowPath)?.root;
  const author = getEffectiveAuthor(data, rowPath);

  return resolveSemanticNodeInCurrentTree(
    data.knowledgeDBs,
    author,
    rowID,
    semanticContext,
    pane.rootNodeId,
    isRoot(rowPath),
    parentRoot
  );
}

export function buildPaneTarget(
  data: Data,
  rowPath: RowPath,
  paneStack: ID[],
  currentRow?: GraphNode
): {
  stack: ID[];
  author: PublicKey;
  rootNodeId?: LongID;
  scrollToId?: string;
} {
  const [rowID] = getRowIDFromView(data, rowPath);
  const effectiveAuthor = getEffectiveAuthor(data, rowPath);
  const currentEdge = currentRow || getCurrentEdgeForView(data, rowPath);
  const virtualType = currentEdge?.virtualType;
  const currentNode = getNodeForView(data, rowPath, paneStack);
  const currentReference = getCurrentReferenceForView(
    data,
    rowPath,
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
    ...getRowIDsForRowPath(data, rowPath),
  ];
  const node = getNodeForView(data, rowPath, paneStack);
  return {
    stack: fullStack,
    author: effectiveAuthor,
    rootNodeId: node?.id,
  };
}

export function useSearchDepth(): number | undefined {
  const data = useData();
  const rowPath = useRowPath();

  const loop = (
    currentPath: RowPath | undefined,
    depth: number
  ): number | undefined => {
    if (!currentPath) return undefined;
    const [rowID] = getRowIDFromView(data, currentPath);
    if (isSearchId(rowID as ID)) {
      return depth;
    }
    return loop(getParentRowPath(currentPath), depth + 1);
  };

  return loop(getParentRowPath(rowPath), 1);
}

export function useIsInSearchView(): boolean {
  return useSearchDepth() !== undefined;
}

export function getCurrentReferenceForView(
  data: Data,
  rowPath: RowPath,
  stack: ID[],
  virtualType?: VirtualType,
  currentRow?: GraphNode
): ReferenceRow | undefined {
  const currentEdge = currentRow || getCurrentEdgeForView(data, rowPath);
  const currentNode = getNodeForView(data, rowPath, stack);
  let referenceID: LongID | undefined;
  if (isRefNode(currentEdge)) {
    referenceID = currentEdge.id as LongID;
  } else if (isRefNode(currentNode)) {
    referenceID = currentNode.id as LongID;
  }
  if (!referenceID) {
    return undefined;
  }
  return buildReferenceItem(referenceID, data, rowPath, stack, virtualType);
}

export function addNodesToLastElement(path: RowPath, nodeID: LongID): RowPath {
  const last = getLast(path);
  if (last === nodeID) {
    return path;
  }
  return [
    getPaneIndex(path),
    ...(path.slice(1, -1) as ID[]),
    nodeID,
  ] as RowPath;
}

export function addNodeToPathWithNodes(
  path: RowPath,
  nodes: GraphNode,
  index: number
): RowPath {
  const rowID = nodes.children.get(index);
  if (rowID === undefined) {
    throw new Error("No child node found at index");
  }
  const pathWithNodes = addNodesToLastElement(path, nodes.id);
  const nextSegment =
    rowID === EMPTY_SEMANTIC_ID ? createEmptyRowPathID(nodes.id) : rowID;
  return [...pathWithNodes, nextSegment] as RowPath;
}

function addNodeToPath(
  data: Data,
  path: RowPath,
  index: number,
  stack: ID[]
): RowPath {
  const nodes = getNodeForView(data, path, stack);
  if (!nodes) {
    throw new Error("Parent doesn't have nodes, cannot add to path");
  }
  return addNodeToPathWithNodes(path, nodes, index);
}

export function useEffectiveAuthor(): PublicKey {
  const data = useData();
  const rowPath = useRowPath();
  return getEffectiveAuthor(data, rowPath);
}

export function useCurrentNode(): GraphNode | undefined {
  const data = useData();
  const rowPath = useRowPath();
  const stack = usePaneStack();
  return getNodeForView(data, rowPath, stack);
}

export function useIsViewingOtherUserContent(): boolean {
  const { user } = useData();
  const effectiveAuthor = useEffectiveAuthor();
  return effectiveAuthor !== user.publicKey;
}

export function getNodeIndexForView(
  data: Data,
  rowPath: RowPath
): number | undefined {
  const nodes = getParentNode(data, rowPath);
  if (!nodes) {
    return undefined;
  }
  const rowID = getLast(rowPath);
  const index = nodes.children.findIndex(
    (childID) =>
      childID === rowID ||
      (childID === EMPTY_SEMANTIC_ID && isEmptyRowPathID(rowID))
  );
  return index >= 0 ? index : undefined;
}

export function useNodeIndex(): number | undefined {
  const path = useRowPath();
  const data = useData();
  return getNodeIndexForView(data, path);
}

export function getCurrentEdgeForView(
  data: Data,
  rowPath: RowPath
): GraphNode | undefined {
  const parentNode = getParentNode(data, rowPath);
  if (!parentNode) {
    return undefined;
  }
  const index = getNodeIndexForView(data, rowPath);
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
  const rowPath = useRowPath();
  const viewKey = rowPathToString(rowPath);
  const virtualRow = virtualRows.get(viewKey);
  if (virtualRow) {
    return virtualRow;
  }
  return getCurrentEdgeForView(data, rowPath);
}

type SiblingInfo = {
  rowPath: RowPath;
  rowID: ID;
  view: View;
};

export function getPreviousSibling(
  data: Data,
  rowPath: RowPath,
  stack: ID[]
): SiblingInfo | undefined {
  const nodeIndex = getNodeIndexForView(data, rowPath);
  if (nodeIndex === undefined || nodeIndex === 0) {
    return undefined;
  }

  const parentPath = getParentRowPath(rowPath);
  if (!parentPath) {
    return undefined;
  }

  const parentNode = getParentNode(data, rowPath);
  if (!parentNode) {
    return undefined;
  }

  const pane = getPane(data, rowPath);
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
      rowPath: prevSiblingPath,
      rowID: prevRowID,
      view: prevView,
    };
  } catch {
    return undefined;
  }
}

export function usePreviousSibling(): SiblingInfo | undefined {
  const data = useData();
  const rowPath = useRowPath();
  const stack = usePaneStack();
  return getPreviousSibling(data, rowPath, stack);
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
  const startPath: RowPath = [paneIndex, resolvedRootNode?.id || root];
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
  const rowPath = useRowPath();
  return getRowIDFromView(data, rowPath);
}

export function getDisplayTextForView(
  data: Data,
  rowPath: RowPath,
  stack: ID[],
  virtualType?: VirtualType,
  currentRow?: GraphNode
): string {
  const reference = getCurrentReferenceForView(
    data,
    rowPath,
    stack,
    virtualType,
    currentRow
  );
  if (reference) {
    return reference.text;
  }
  const [rowID] = getRowIDFromView(data, rowPath);
  if (isSearchId(rowID as ID)) {
    const query = parseSearchId(rowID as ID) || "";
    return `Search: ${query}`;
  }
  const ownNode = getNodeForView(data, rowPath, stack);
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
  const rowPath = useRowPath();
  const stack = usePaneStack();
  const currentRow = useCurrentEdge();
  const virtualType = currentRow?.virtualType;
  return getDisplayTextForView(data, rowPath, stack, virtualType, currentRow);
}

export function useViewKey(): string {
  return rowPathToString(useRowPath());
}

export function useIsExpanded(): boolean {
  const data = useData();
  const viewKey = useViewKey();
  return isExpanded(data, viewKey);
}

export function useIsRoot(): boolean {
  return isRoot(useRowPath());
}

export function upsertNodes(
  plan: Plan,
  rowPath: RowPath,
  stack: ID[],
  modify: (nodes: GraphNode) => GraphNode
): Plan {
  const semanticContext = getContext(plan, rowPath, stack);
  const parentNode = getParentNode(plan, rowPath);
  const parentRoot = parentNode?.root;
  const currentNode = getNodeForView(plan, rowPath, stack);

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
