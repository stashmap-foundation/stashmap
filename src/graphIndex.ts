import { Map as ImmutableMap } from "immutable";
import { nodeRefKey } from "./core/nodeRef";
import { getAllLinks } from "./core/nodeSpans";
import { isThingAddress } from "./core/linkPath";

export function createEmptyGraphIndex(): GraphIndex {
  return {
    nodeByID: new globalThis.Map<ID, GraphNode>(),
    nodesBySource: new globalThis.Map<
      SourceId,
      globalThis.Map<ID, GraphNode>
    >(),
    sourceCandidatesById: new globalThis.Map<ID, NodeRef[]>(),
    incomingCrefs: new globalThis.Map<ID, NodeRef[]>(),
    incomingCrefsByTarget: new globalThis.Map<string, NodeRef[]>(),
  };
}

function sameRef(left: NodeRef, right: NodeRef): boolean {
  return left.sourceId === right.sourceId && left.id === right.id;
}

function addRefToMap(
  map: globalThis.Map<string, NodeRef[]>,
  key: string,
  ref: NodeRef
): void {
  const existing = map.get(key) ?? [];
  if (existing.some((candidate) => sameRef(candidate, ref))) {
    return;
  }
  map.set(key, [...existing, ref]);
}

function removeRefFromMap(
  map: globalThis.Map<string, NodeRef[]>,
  key: string,
  ref: NodeRef
): void {
  const existing = map.get(key);
  if (!existing) {
    return;
  }
  const next = existing.filter((candidate) => !sameRef(candidate, ref));
  if (next.length === 0) {
    map.delete(key);
    return;
  }
  map.set(key, next);
}

function addRefToNodeMap(
  map: globalThis.Map<ID, NodeRef[]>,
  key: ID,
  ref: NodeRef
): void {
  const existing = map.get(key) ?? [];
  if (existing.some((candidate) => sameRef(candidate, ref))) {
    return;
  }
  map.set(key, [...existing, ref]);
}

function removeRefFromNodeMap(
  map: globalThis.Map<ID, NodeRef[]>,
  key: ID,
  ref: NodeRef
): void {
  const existing = map.get(key);
  if (!existing) {
    return;
  }
  const next = existing.filter((candidate) => !sameRef(candidate, ref));
  if (next.length === 0) {
    map.delete(key);
    return;
  }
  map.set(key, next);
}

function addSourceCandidate(
  graphIndex: GraphIndex,
  key: ID,
  ref: NodeRef
): void {
  addRefToMap(graphIndex.sourceCandidatesById, key, ref);
}

function removeSourceCandidate(
  graphIndex: GraphIndex,
  key: ID,
  ref: NodeRef
): void {
  removeRefFromMap(graphIndex.sourceCandidatesById, key, ref);
}

function getNodeInIndexedSource(
  graphIndex: GraphIndex,
  sourceId: SourceId,
  nodeID: ID
): GraphNode | undefined {
  const sourceNodes = graphIndex.nodesBySource.get(sourceId);
  if (!sourceNodes) {
    return undefined;
  }
  return sourceNodes.get(nodeID);
}

function addNodeSourceEntries(
  graphIndex: GraphIndex,
  node: GraphNode,
  sourceId: SourceId
): void {
  const existingSourceNodes = graphIndex.nodesBySource.get(sourceId);
  const sourceNodes =
    existingSourceNodes ?? new globalThis.Map<ID, GraphNode>();
  sourceNodes.set(node.id, node);
  addSourceCandidate(graphIndex, node.id, { sourceId, id: node.id });
  if (!existingSourceNodes) {
    graphIndex.nodesBySource.set(sourceId, sourceNodes);
  }
  graphIndex.nodeByID.set(node.id as ID, node);
}

function setNodeByIDFromCandidates(graphIndex: GraphIndex, nodeID: ID): void {
  const candidates = graphIndex.sourceCandidatesById.get(nodeID as ID) ?? [];
  const replacement = candidates
    .map((ref) => getNodeInIndexedSource(graphIndex, ref.sourceId, ref.id))
    .find((node): node is GraphNode => node !== undefined);
  if (replacement) {
    graphIndex.nodeByID.set(nodeID, replacement);
    return;
  }
  graphIndex.nodeByID.delete(nodeID);
}

function removeNodeSourceEntries(
  graphIndex: GraphIndex,
  node: GraphNode,
  sourceId: SourceId
): void {
  const existingSourceNodes = graphIndex.nodesBySource.get(sourceId);
  if (!existingSourceNodes) {
    setNodeByIDFromCandidates(graphIndex, node.id as ID);
    return;
  }
  const sourceNodes = existingSourceNodes;
  const ref: NodeRef = { sourceId, id: node.id };
  const existingNode = sourceNodes.get(node.id);
  if (existingNode?.id === node.id) {
    sourceNodes.delete(node.id);
  }
  removeSourceCandidate(graphIndex, node.id, ref);
  if (sourceNodes.size === 0) {
    graphIndex.nodesBySource.delete(sourceId);
  }
  setNodeByIDFromCandidates(graphIndex, node.id as ID);
}

function addNodeLinkEntries(
  graphIndex: GraphIndex,
  node: GraphNode,
  sourceId: SourceId
): void {
  const ref = { sourceId, id: node.id };
  getAllLinks(node, sourceId).forEach(({ target }) => {
    if (isThingAddress(target.id)) {
      addRefToNodeMap(graphIndex.incomingCrefs, target.id, ref);
      return;
    }
    addRefToMap(graphIndex.incomingCrefsByTarget, nodeRefKey(target), ref);
  });
}

function removeNodeLinkEntries(
  graphIndex: GraphIndex,
  node: GraphNode,
  sourceId: SourceId
): void {
  const ref = { sourceId, id: node.id };
  getAllLinks(node, sourceId).forEach(({ target }) => {
    if (isThingAddress(target.id)) {
      removeRefFromNodeMap(graphIndex.incomingCrefs, target.id, ref);
      return;
    }
    removeRefFromMap(graphIndex.incomingCrefsByTarget, nodeRefKey(target), ref);
  });
}

function cloneIndex(graphIndex: GraphIndex): GraphIndex {
  return {
    nodeByID: new globalThis.Map<ID, GraphNode>(graphIndex.nodeByID),
    nodesBySource: new globalThis.Map<SourceId, globalThis.Map<ID, GraphNode>>(
      [...graphIndex.nodesBySource.entries()].map(([sourceId, nodes]) => [
        sourceId,
        new globalThis.Map<ID, GraphNode>(nodes),
      ])
    ),
    sourceCandidatesById: new globalThis.Map<ID, NodeRef[]>(
      [...graphIndex.sourceCandidatesById.entries()].map(
        ([key, candidates]) => [key, [...candidates]]
      )
    ),
    incomingCrefs: new globalThis.Map<ID, NodeRef[]>(
      [...graphIndex.incomingCrefs.entries()].map(([key, refs]) => [
        key,
        [...refs],
      ])
    ),
    incomingCrefsByTarget: new globalThis.Map<string, NodeRef[]>(
      [...graphIndex.incomingCrefsByTarget.entries()].map(([key, refs]) => [
        key,
        [...refs],
      ])
    ),
  };
}

export function addNodesToGraphIndex(
  graphIndex: GraphIndex,
  nodes: ImmutableMap<string, GraphNode>,
  sourceId: SourceId
): GraphIndex {
  if (nodes.size === 0) {
    return graphIndex;
  }

  const nextIndex = cloneIndex(graphIndex);

  nodes.valueSeq().forEach((node) => {
    addNodeSourceEntries(nextIndex, node, sourceId);
  });

  nodes.valueSeq().forEach((node) => {
    addNodeLinkEntries(nextIndex, node, sourceId);
  });
  return nextIndex;
}

export function removeNodesFromGraphIndex(
  graphIndex: GraphIndex,
  nodes: ImmutableMap<string, GraphNode>,
  sourceId: SourceId
): GraphIndex {
  if (nodes.size === 0) {
    return graphIndex;
  }

  const nextIndex = cloneIndex(graphIndex);

  nodes.valueSeq().forEach((node) => {
    removeNodeLinkEntries(nextIndex, node, sourceId);
  });
  nodes.valueSeq().forEach((node) => {
    removeNodeSourceEntries(nextIndex, node, sourceId);
  });
  return nextIndex;
}

export function mergeGraphIndexes(
  base: GraphIndex,
  overlay: GraphIndex
): GraphIndex {
  const nextIndex = cloneIndex(base);
  overlay.nodesBySource.forEach((nodes, sourceId) => {
    const existingNodes = nextIndex.nodesBySource.get(sourceId);
    const nextNodes = existingNodes ?? new globalThis.Map<ID, GraphNode>();
    nodes.forEach((node, nodeId) => {
      nextNodes.set(nodeId, node);
      nextIndex.nodeByID.set(nodeId, node);
    });
    if (!existingNodes) {
      nextIndex.nodesBySource.set(sourceId, nextNodes);
    }
  });
  overlay.sourceCandidatesById.forEach((refs, key) => {
    refs.forEach((ref) =>
      addRefToMap(nextIndex.sourceCandidatesById, key, ref)
    );
  });
  overlay.incomingCrefs.forEach((refs, key) => {
    refs.forEach((ref) => addRefToNodeMap(nextIndex.incomingCrefs, key, ref));
  });
  overlay.incomingCrefsByTarget.forEach((refs, key) => {
    refs.forEach((ref) =>
      addRefToMap(nextIndex.incomingCrefsByTarget, key, ref)
    );
  });
  return nextIndex;
}

export function buildGraphIndexFromDocuments(
  documents: ReadonlyArray<{
    sourceId: SourceId;
    nodes: ImmutableMap<string, GraphNode>;
  }>
): GraphIndex {
  const graphIndex = createEmptyGraphIndex();
  documents.forEach(({ nodes, sourceId }) => {
    nodes.valueSeq().forEach((node) => {
      addNodeSourceEntries(graphIndex, node, sourceId);
    });
  });
  documents.forEach(({ nodes, sourceId }) => {
    nodes.valueSeq().forEach((node) => {
      addNodeLinkEntries(graphIndex, node, sourceId);
    });
  });
  return graphIndex;
}
