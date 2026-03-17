import { Map as ImmutableMap } from "immutable";
import type { GraphNode, SemanticIndex } from "./types";
import { EMPTY_SEMANTIC_ID } from "./types";
import { isRefNode } from "./references";

export function createEmptySemanticIndex(): SemanticIndex {
  return {
    nodeByID: new globalThis.Map<LongID, GraphNode>(),
    semantic: new globalThis.Map<string, globalThis.Set<LongID>>(),
    incomingCrefs: new globalThis.Map<LongID, globalThis.Set<LongID>>(),
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
  node: GraphNode
): void {
  addToSetMap(semanticIndex.semantic, node.text, node.id);
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
    const targetNodeID = isRefNode(childNode) ? childNode.targetID : undefined;
    if (targetNodeID) {
      addToNodeMap(semanticIndex.incomingCrefs, targetNodeID, node.id);
    }
  });
}

function removeNodeSemanticEntries(
  semanticIndex: SemanticIndex,
  node: GraphNode
): void {
  removeFromSetMap(semanticIndex.semantic, node.text, node.id);
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
    const targetNodeID = isRefNode(childNode) ? childNode.targetID : undefined;
    if (targetNodeID) {
      removeFromNodeMap(semanticIndex.incomingCrefs, targetNodeID, node.id);
    }
  });
}

export function addNodesToSemanticIndex(
  semanticIndex: SemanticIndex,
  nodes: ImmutableMap<string, GraphNode>
): SemanticIndex {
  if (nodes.size === 0) {
    return semanticIndex;
  }

  const nextIndex: SemanticIndex = {
    nodeByID: new globalThis.Map<LongID, GraphNode>(semanticIndex.nodeByID),
    semantic: new globalThis.Map<string, globalThis.Set<LongID>>(
      [...semanticIndex.semantic.entries()].map(([key, ids]) => [
        key,
        new globalThis.Set<LongID>(ids),
      ])
    ),
    incomingCrefs: new globalThis.Map<LongID, globalThis.Set<LongID>>(
      [...semanticIndex.incomingCrefs.entries()].map(([key, ids]) => [
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

  nodes.valueSeq().forEach((node) => {
    nextIndex.nodeByID.set(node.id, node);
  });

  nodes.valueSeq().forEach((node) => {
    addNodeSemanticEntries(nextIndex, node);
  });
  return nextIndex;
}

export function removeNodesFromSemanticIndex(
  semanticIndex: SemanticIndex,
  nodes: ImmutableMap<string, GraphNode>
): SemanticIndex {
  if (nodes.size === 0) {
    return semanticIndex;
  }

  const nextIndex: SemanticIndex = {
    nodeByID: new globalThis.Map<LongID, GraphNode>(semanticIndex.nodeByID),
    semantic: new globalThis.Map<string, globalThis.Set<LongID>>(
      [...semanticIndex.semantic.entries()].map(([key, ids]) => [
        key,
        new globalThis.Set<LongID>(ids),
      ])
    ),
    incomingCrefs: new globalThis.Map<LongID, globalThis.Set<LongID>>(
      [...semanticIndex.incomingCrefs.entries()].map(([key, ids]) => [
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

  nodes.valueSeq().forEach((node) => {
    removeNodeSemanticEntries(nextIndex, node);
  });
  nodes.valueSeq().forEach((node) => {
    nextIndex.nodeByID.delete(node.id);
  });
  return nextIndex;
}

export function buildSemanticIndexFromDocuments(
  nodesByDocumentKey: ImmutableMap<string, ImmutableMap<string, GraphNode>>
): SemanticIndex {
  return nodesByDocumentKey
    .valueSeq()
    .reduce(
      (acc, nodes) => addNodesToSemanticIndex(acc, nodes),
      createEmptySemanticIndex()
    );
}
