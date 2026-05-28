import { Map as ImmutableMap } from "immutable";
import { EMPTY_SEMANTIC_ID } from "./core/connections";
import { getAllFileLinks, getAllLinks, nodeText } from "./core/nodeSpans";
import { fileLinkIndexKey, resolveLinkPath } from "./core/linkPath";

export function createEmptyGraphIndex(): GraphIndex {
  return {
    nodeByID: new globalThis.Map<LongID, GraphNode>(),
    semantic: new globalThis.Map<string, globalThis.Set<LongID>>(),
    incomingCrefs: new globalThis.Map<LongID, globalThis.Set<LongID>>(),
    incomingFileLinks: new globalThis.Map<string, globalThis.Set<LongID>>(),
    basedOnIndex: new globalThis.Map<LongID, globalThis.Set<LongID>>(),
  };
}

function addToSetMap(
  map: globalThis.Map<string, globalThis.Set<LongID>>,
  key: string,
  value: LongID
): void {
  const existing = map.get(key);
  if (existing) {
    existing.add(value);
    return;
  }
  map.set(key, new globalThis.Set<LongID>([value]));
}

function addToNodeMap(
  map: globalThis.Map<LongID, globalThis.Set<LongID>>,
  targetNodeID: LongID,
  sourceNodeID: LongID
): void {
  const existing = map.get(targetNodeID);
  if (existing) {
    existing.add(sourceNodeID);
    return;
  }
  map.set(targetNodeID, new globalThis.Set<LongID>([sourceNodeID]));
}

function removeFromSetMap(
  map: globalThis.Map<string, globalThis.Set<LongID>>,
  key: string,
  value: LongID
): void {
  const existing = map.get(key);
  if (!existing) {
    return;
  }
  existing.delete(value);
  if (existing.size === 0) {
    map.delete(key);
  }
}

function removeFromNodeMap(
  map: globalThis.Map<LongID, globalThis.Set<LongID>>,
  targetNodeID: LongID,
  sourceNodeID: LongID
): void {
  const existing = map.get(targetNodeID);
  if (!existing) {
    return;
  }
  existing.delete(sourceNodeID);
  if (existing.size === 0) {
    map.delete(targetNodeID);
  }
}

function addNodeLinkEntries(
  graphIndex: GraphIndex,
  node: GraphNode,
  sourceFilePath: string | undefined,
  fileLinkSourceID: LongID
): void {
  getAllLinks(node).forEach(({ targetID }) => {
    addToNodeMap(graphIndex.incomingCrefs, targetID, node.id);
  });
  getAllFileLinks(node).forEach(({ path }) => {
    const resolved = resolveLinkPath(path, sourceFilePath);
    const key = fileLinkIndexKey(node.author, resolved);
    addToSetMap(graphIndex.incomingFileLinks, key, fileLinkSourceID);
  });
}

function removeNodeLinkEntries(
  graphIndex: GraphIndex,
  node: GraphNode,
  sourceFilePath: string | undefined,
  fileLinkSourceID: LongID
): void {
  getAllLinks(node).forEach(({ targetID }) => {
    removeFromNodeMap(graphIndex.incomingCrefs, targetID, node.id);
  });
  getAllFileLinks(node).forEach(({ path }) => {
    const resolved = resolveLinkPath(path, sourceFilePath);
    const key = fileLinkIndexKey(node.author, resolved);
    removeFromSetMap(graphIndex.incomingFileLinks, key, fileLinkSourceID);
  });
}

function addNodeSemanticEntries(
  graphIndex: GraphIndex,
  node: GraphNode,
  sourceFilePath: string | undefined
): void {
  addToSetMap(graphIndex.semantic, nodeText(node), node.id);
  if (node.basedOn) {
    addToNodeMap(graphIndex.basedOnIndex, node.basedOn, node.id);
  }

  if (!node.parent && node.relevance !== "not_relevant") {
    addNodeLinkEntries(graphIndex, node, sourceFilePath, node.id);
  }

  node.children.forEach((childID) => {
    if (childID === EMPTY_SEMANTIC_ID) {
      return;
    }
    const childNode = graphIndex.nodeByID.get(childID as LongID);
    if (!childNode || childNode.relevance === "not_relevant") {
      return;
    }
    addNodeLinkEntries(graphIndex, childNode, sourceFilePath, childNode.id);
  });
}

function removeNodeSemanticEntries(
  graphIndex: GraphIndex,
  node: GraphNode,
  sourceFilePath: string | undefined
): void {
  removeFromSetMap(graphIndex.semantic, nodeText(node), node.id);
  if (node.basedOn) {
    removeFromNodeMap(graphIndex.basedOnIndex, node.basedOn, node.id);
  }

  if (!node.parent && node.relevance !== "not_relevant") {
    removeNodeLinkEntries(graphIndex, node, sourceFilePath, node.id);
  }

  node.children.forEach((childID) => {
    if (childID === EMPTY_SEMANTIC_ID) {
      return;
    }
    const childNode = graphIndex.nodeByID.get(childID as LongID);
    if (!childNode || childNode.relevance === "not_relevant") {
      return;
    }
    removeNodeLinkEntries(graphIndex, childNode, sourceFilePath, childNode.id);
  });
}

function cloneIndex(graphIndex: GraphIndex): GraphIndex {
  return {
    nodeByID: new globalThis.Map<LongID, GraphNode>(graphIndex.nodeByID),
    semantic: new globalThis.Map<string, globalThis.Set<LongID>>(
      [...graphIndex.semantic.entries()].map(([key, ids]) => [
        key,
        new globalThis.Set<LongID>(ids),
      ])
    ),
    incomingCrefs: new globalThis.Map<LongID, globalThis.Set<LongID>>(
      [...graphIndex.incomingCrefs.entries()].map(([key, ids]) => [
        key,
        new globalThis.Set<LongID>(ids),
      ])
    ),
    incomingFileLinks: new globalThis.Map<string, globalThis.Set<LongID>>(
      [...graphIndex.incomingFileLinks.entries()].map(([key, ids]) => [
        key,
        new globalThis.Set<LongID>(ids),
      ])
    ),
    basedOnIndex: new globalThis.Map<LongID, globalThis.Set<LongID>>(
      [...graphIndex.basedOnIndex.entries()].map(([key, ids]) => [
        key,
        new globalThis.Set<LongID>(ids),
      ])
    ),
  };
}

export function addNodesToGraphIndex(
  graphIndex: GraphIndex,
  nodes: ImmutableMap<string, GraphNode>,
  sourceFilePath?: string
): GraphIndex {
  if (nodes.size === 0) {
    return graphIndex;
  }

  const nextIndex = cloneIndex(graphIndex);

  nodes.valueSeq().forEach((node) => {
    nextIndex.nodeByID.set(node.id, node);
  });

  nodes.valueSeq().forEach((node) => {
    addNodeSemanticEntries(nextIndex, node, sourceFilePath);
  });
  return nextIndex;
}

export function removeNodesFromGraphIndex(
  graphIndex: GraphIndex,
  nodes: ImmutableMap<string, GraphNode>,
  sourceFilePath?: string
): GraphIndex {
  if (nodes.size === 0) {
    return graphIndex;
  }

  const nextIndex = cloneIndex(graphIndex);

  nodes.valueSeq().forEach((node) => {
    removeNodeSemanticEntries(nextIndex, node, sourceFilePath);
  });
  nodes.valueSeq().forEach((node) => {
    nextIndex.nodeByID.delete(node.id);
  });
  return nextIndex;
}

export function buildGraphIndexFromDocuments(
  nodesByDocumentKey: ImmutableMap<string, ImmutableMap<string, GraphNode>>,
  filePathByDocumentKey: ImmutableMap<string, string> = ImmutableMap()
): GraphIndex {
  return nodesByDocumentKey
    .entrySeq()
    .reduce(
      (acc, [key, nodes]) =>
        addNodesToGraphIndex(acc, nodes, filePathByDocumentKey.get(key)),
      createEmptyGraphIndex()
    );
}
