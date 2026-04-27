import { Map as ImmutableMap } from "immutable";
import { EMPTY_SEMANTIC_ID } from "./connections";
import { getAllFileLinks, getAllLinks } from "./nodeSpans";
import { fileLinkIndexKey, resolveLinkPath } from "./linkPath";

export function createEmptySemanticIndex(): SemanticIndex {
  return {
    nodeByID: new globalThis.Map<LongID, GraphNode>(),
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

function addNodeSemanticEntries(
  semanticIndex: SemanticIndex,
  node: GraphNode,
  sourceFilePath: string | undefined
): void {
  if (node.basedOn) {
    addToNodeMap(semanticIndex.basedOnIndex, node.basedOn, node.id);
  }

  node.children.forEach((childID) => {
    if (childID === EMPTY_SEMANTIC_ID) {
      return;
    }
    const childNode = semanticIndex.nodeByID.get(childID as LongID);
    if (!childNode || childNode.relevance === "not_relevant") {
      return;
    }
    getAllLinks(childNode).forEach(({ targetID }) => {
      addToNodeMap(semanticIndex.incomingCrefs, targetID, node.id);
    });
    getAllFileLinks(childNode).forEach(({ path }) => {
      const resolved = resolveLinkPath(path, sourceFilePath);
      const key = fileLinkIndexKey(childNode.author, resolved);
      addToSetMap(semanticIndex.incomingFileLinks, key, node.id);
    });
  });
}

function removeNodeSemanticEntries(
  semanticIndex: SemanticIndex,
  node: GraphNode,
  sourceFilePath: string | undefined
): void {
  if (node.basedOn) {
    removeFromNodeMap(semanticIndex.basedOnIndex, node.basedOn, node.id);
  }

  node.children.forEach((childID) => {
    if (childID === EMPTY_SEMANTIC_ID) {
      return;
    }
    const childNode = semanticIndex.nodeByID.get(childID as LongID);
    if (!childNode || childNode.relevance === "not_relevant") {
      return;
    }
    getAllLinks(childNode).forEach(({ targetID }) => {
      removeFromNodeMap(semanticIndex.incomingCrefs, targetID, node.id);
    });
    getAllFileLinks(childNode).forEach(({ path }) => {
      const resolved = resolveLinkPath(path, sourceFilePath);
      const key = fileLinkIndexKey(childNode.author, resolved);
      removeFromSetMap(semanticIndex.incomingFileLinks, key, node.id);
    });
  });
}

function cloneIndex(semanticIndex: SemanticIndex): SemanticIndex {
  return {
    nodeByID: new globalThis.Map<LongID, GraphNode>(semanticIndex.nodeByID),
    incomingCrefs: new globalThis.Map<LongID, globalThis.Set<LongID>>(
      [...semanticIndex.incomingCrefs.entries()].map(([key, ids]) => [
        key,
        new globalThis.Set<LongID>(ids),
      ])
    ),
    incomingFileLinks: new globalThis.Map<string, globalThis.Set<LongID>>(
      [...semanticIndex.incomingFileLinks.entries()].map(([key, ids]) => [
        key,
        new globalThis.Set<LongID>(ids),
      ])
    ),
    basedOnIndex: new globalThis.Map<LongID, globalThis.Set<LongID>>(
      [...semanticIndex.basedOnIndex.entries()].map(([key, ids]) => [
        key,
        new globalThis.Set<LongID>(ids),
      ])
    ),
  };
}

export function addNodesToSemanticIndex(
  semanticIndex: SemanticIndex,
  nodes: ImmutableMap<string, GraphNode>,
  sourceFilePath?: string
): SemanticIndex {
  if (nodes.size === 0) {
    return semanticIndex;
  }

  const nextIndex = cloneIndex(semanticIndex);

  nodes.valueSeq().forEach((node) => {
    nextIndex.nodeByID.set(node.id, node);
  });

  nodes.valueSeq().forEach((node) => {
    addNodeSemanticEntries(nextIndex, node, sourceFilePath);
  });
  return nextIndex;
}

export function removeNodesFromSemanticIndex(
  semanticIndex: SemanticIndex,
  nodes: ImmutableMap<string, GraphNode>,
  sourceFilePath?: string
): SemanticIndex {
  if (nodes.size === 0) {
    return semanticIndex;
  }

  const nextIndex = cloneIndex(semanticIndex);

  nodes.valueSeq().forEach((node) => {
    removeNodeSemanticEntries(nextIndex, node, sourceFilePath);
  });
  nodes.valueSeq().forEach((node) => {
    nextIndex.nodeByID.delete(node.id);
  });
  return nextIndex;
}

export function buildSemanticIndexFromDocuments(
  nodesByDocumentKey: ImmutableMap<string, ImmutableMap<string, GraphNode>>,
  filePathByDocumentKey: ImmutableMap<string, string> = ImmutableMap()
): SemanticIndex {
  return nodesByDocumentKey
    .entrySeq()
    .reduce(
      (acc, [key, nodes]) =>
        addNodesToSemanticIndex(acc, nodes, filePathByDocumentKey.get(key)),
      createEmptySemanticIndex()
    );
}
