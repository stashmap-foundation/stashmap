/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let, functional/immutable-data */
import { List } from "immutable";
import {
  computeEmptyNodeMetadata,
  getNode,
  nodePassesFilters,
} from "../graph/queries";
import {
  shortID,
  isSearchId,
  getNodeContext,
  getNodeSemanticID,
  getSemanticID,
} from "../graph/context";
import { EMPTY_SEMANTIC_ID } from "../graph/types";
import {
  getRefLinkTargetInfo,
  getRefTargetInfo,
  isRefNode,
} from "../graph/references";
import { buildReferenceRow } from "./buildReferenceRow";
import { resolveSemanticNodeInCurrentTree } from "../graph/semanticResolution";
import { DEFAULT_TYPE_FILTERS } from "../constants";
import {
  getLast,
  getPaneIndex,
  getParentRowPath,
  isRoot,
  type RowPath,
  rowPathToString,
} from "./rowPaths";

const EMPTY_ROW_PATH_PREFIX = "empty-row:";

function createEmptyRowPathID(nodeID: LongID): string {
  return `${EMPTY_ROW_PATH_PREFIX}${nodeID}`;
}

function isEmptyRowPathID(id: ID): boolean {
  return id.startsWith(EMPTY_ROW_PATH_PREFIX);
}

export function getContextFromStack(stack: ID[]): Context {
  return List(stack.slice(0, -1));
}

function getViewExactMatch(views: Views, path: RowPath): View | undefined {
  const viewKey = rowPathToString(path);
  return views.get(viewKey);
}

function getViewNodeByID(
  knowledgeDBs: KnowledgeDBs,
  id: ID,
  myself: PublicKey
): GraphNode | undefined {
  return getNode(knowledgeDBs, id, myself);
}

function getEmptyPlaceholderNode(
  data: Data,
  parentNode: GraphNode | undefined
): GraphNode | undefined {
  if (!parentNode) {
    return undefined;
  }
  return computeEmptyNodeMetadata(data.publishEventsStatus.temporaryEvents).get(
    parentNode.id as LongID
  )?.emptyNode;
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

function getViewFromPath(data: Data, path: RowPath): View {
  const rowID = getRowIDFromPath(data, path);
  return (
    getViewExactMatch(data.views, path) || {
      expanded: isRoot(path) || isSearchId(rowID),
    }
  );
}

function getRowIDsForRowPath(data: Data, rowPath: RowPath): Array<ID> {
  const paneIndex = getPaneIndex(rowPath);
  return (rowPath.slice(1) as ID[]).map((_, index, segments) =>
    getRowIDFromPath(data, [paneIndex, ...segments.slice(0, index + 1)])
  );
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

export function getRowIDFromView(data: Data, rowPath: RowPath): [ID, View] {
  const view = getViewFromPath(data, rowPath);
  return [getRowIDFromPath(data, rowPath), view];
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
  const pane = data.panes[getPaneIndex(rowPath)];
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
  const pane = data.panes[getPaneIndex(rowPath)];
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
  return buildReferenceRow(referenceID, data, rowPath, stack, virtualType);
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

export function addNodeToPath(
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
    return getEmptyPlaceholderNode(data, parentNode);
  }
  return getNode(data.knowledgeDBs, childID, data.user.publicKey);
}

export type SiblingInfo = {
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

  const pane = data.panes[getPaneIndex(rowPath)];
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
      return childNode && nodePassesFilters(childNode, activeFilters)
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
