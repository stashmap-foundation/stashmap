import { Map as ImmutableMap } from "immutable";
import { LOCAL, nodeRefKey } from "./core/nodeRef";
import { EMPTY_SEMANTIC_ID } from "./core/connections";
import { getAllFileLinks, getAllLinks, nodeText } from "./core/nodeSpans";
import { fileLinkIndexKey, fileLinkIndexPath } from "./core/linkPath";

export function createEmptyGraphIndex(): GraphIndex {
  return {
    nodeByID: new globalThis.Map<ID, GraphNode>(),
    nodesBySource: new globalThis.Map<
      SourceId,
      globalThis.Map<ID, GraphNode>
    >(),
    sourceCandidatesById: new globalThis.Map<ID, NodeRef[]>(),
    semantic: new globalThis.Map<string, globalThis.Set<ID>>(),
    semanticRefs: new globalThis.Map<string, NodeRef[]>(),
    incomingCrefs: new globalThis.Map<ID, NodeRef[]>(),
    incomingCrefsByTarget: new globalThis.Map<string, NodeRef[]>(),
    incomingFileLinks: new globalThis.Map<string, NodeRef[]>(),
    basedOnIndex: new globalThis.Map<ID, globalThis.Set<ID>>(),
  };
}

function addToSetMap(
  map: globalThis.Map<string, globalThis.Set<ID>>,
  key: string,
  value: ID
): void {
  const existing = map.get(key);
  if (existing) {
    existing.add(value);
    return;
  }
  map.set(key, new globalThis.Set<ID>([value]));
}

function addToNodeMap(
  map: globalThis.Map<ID, globalThis.Set<ID>>,
  targetNodeID: ID,
  sourceNodeID: ID
): void {
  const existing = map.get(targetNodeID);
  if (existing) {
    existing.add(sourceNodeID);
    return;
  }
  map.set(targetNodeID, new globalThis.Set<ID>([sourceNodeID]));
}

function removeFromSetMap(
  map: globalThis.Map<string, globalThis.Set<ID>>,
  key: string,
  value: ID
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
  map: globalThis.Map<ID, globalThis.Set<ID>>,
  targetNodeID: ID,
  sourceNodeID: ID
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
  const sourceNodes = new globalThis.Map<ID, GraphNode>(existingSourceNodes);
  sourceNodes.set(node.id, node);
  addSourceCandidate(graphIndex, node.id, { sourceId, id: node.id });
  graphIndex.nodesBySource.set(sourceId, sourceNodes);
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
  const sourceNodes = new globalThis.Map<ID, GraphNode>(existingSourceNodes);
  const ref: NodeRef = { sourceId, id: node.id };
  const existingNode = sourceNodes.get(node.id);
  if (existingNode?.id === node.id) {
    sourceNodes.delete(node.id);
  }
  removeSourceCandidate(graphIndex, node.id, ref);
  if (sourceNodes.size === 0) {
    graphIndex.nodesBySource.delete(sourceId);
  } else {
    graphIndex.nodesBySource.set(sourceId, sourceNodes);
  }
  setNodeByIDFromCandidates(graphIndex, node.id as ID);
}

function addNodeLinkEntries(
  graphIndex: GraphIndex,
  node: GraphNode,
  sourceId: SourceId,
  sourceFilePath: string | undefined,
  fileLinkSourceID: ID
): void {
  getAllLinks(node).forEach(({ targetID }) => {
    const ref = { sourceId, id: node.id };
    addRefToNodeMap(graphIndex.incomingCrefs, targetID, ref);
    addRefToMap(
      graphIndex.incomingCrefsByTarget,
      nodeRefKey({ sourceId, id: targetID }),
      ref
    );
  });
  getAllFileLinks(node).forEach(({ path }) => {
    const resolved = fileLinkIndexPath(path, sourceFilePath);
    const key = fileLinkIndexKey(sourceId, resolved);
    addRefToMap(graphIndex.incomingFileLinks, key, {
      sourceId,
      id: fileLinkSourceID,
    });
  });
}

function removeNodeLinkEntries(
  graphIndex: GraphIndex,
  node: GraphNode,
  sourceId: SourceId,
  sourceFilePath: string | undefined,
  fileLinkSourceID: ID
): void {
  getAllLinks(node).forEach(({ targetID }) => {
    const ref = { sourceId, id: node.id };
    removeRefFromNodeMap(graphIndex.incomingCrefs, targetID, ref);
    removeRefFromMap(
      graphIndex.incomingCrefsByTarget,
      nodeRefKey({ sourceId, id: targetID }),
      ref
    );
  });
  getAllFileLinks(node).forEach(({ path }) => {
    const resolved = fileLinkIndexPath(path, sourceFilePath);
    const key = fileLinkIndexKey(sourceId, resolved);
    removeRefFromMap(graphIndex.incomingFileLinks, key, {
      sourceId,
      id: fileLinkSourceID,
    });
  });
}

function addNodeSemanticEntries(
  graphIndex: GraphIndex,
  node: GraphNode,
  sourceId: SourceId,
  sourceFilePath: string | undefined
): void {
  const semanticKey = nodeText(node);
  addToSetMap(graphIndex.semantic, semanticKey, node.id);
  addRefToMap(graphIndex.semanticRefs, semanticKey, {
    sourceId,
    id: node.id,
  });
  if (node.basedOn) {
    addToNodeMap(graphIndex.basedOnIndex, node.basedOn, node.id);
  }

  if (!node.parent && node.relevance !== "not_relevant") {
    addNodeLinkEntries(graphIndex, node, sourceId, sourceFilePath, node.id);
  }

  node.children.forEach((childID) => {
    if (childID === EMPTY_SEMANTIC_ID) {
      return;
    }
    const childNode = getNodeInIndexedSource(graphIndex, sourceId, childID);
    if (!childNode || childNode.relevance === "not_relevant") {
      return;
    }
    addNodeLinkEntries(
      graphIndex,
      childNode,
      sourceId,
      sourceFilePath,
      childNode.id
    );
  });
}

function removeNodeSemanticEntries(
  graphIndex: GraphIndex,
  node: GraphNode,
  sourceId: SourceId,
  sourceFilePath: string | undefined
): void {
  const semanticKey = nodeText(node);
  removeFromSetMap(graphIndex.semantic, semanticKey, node.id);
  removeRefFromMap(graphIndex.semanticRefs, semanticKey, {
    sourceId,
    id: node.id,
  });
  if (node.basedOn) {
    removeFromNodeMap(graphIndex.basedOnIndex, node.basedOn, node.id);
  }

  if (!node.parent && node.relevance !== "not_relevant") {
    removeNodeLinkEntries(graphIndex, node, sourceId, sourceFilePath, node.id);
  }

  node.children.forEach((childID) => {
    if (childID === EMPTY_SEMANTIC_ID) {
      return;
    }
    const childNode = getNodeInIndexedSource(graphIndex, sourceId, childID);
    if (!childNode || childNode.relevance === "not_relevant") {
      return;
    }
    removeNodeLinkEntries(
      graphIndex,
      childNode,
      sourceId,
      sourceFilePath,
      childNode.id
    );
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
    semantic: new globalThis.Map<string, globalThis.Set<ID>>(
      [...graphIndex.semantic.entries()].map(([key, ids]) => [
        key,
        new globalThis.Set<ID>(ids),
      ])
    ),
    semanticRefs: new globalThis.Map<string, NodeRef[]>(
      [...graphIndex.semanticRefs.entries()].map(([key, refs]) => [
        key,
        [...refs],
      ])
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
    incomingFileLinks: new globalThis.Map<string, NodeRef[]>(
      [...graphIndex.incomingFileLinks.entries()].map(([key, refs]) => [
        key,
        [...refs],
      ])
    ),
    basedOnIndex: new globalThis.Map<ID, globalThis.Set<ID>>(
      [...graphIndex.basedOnIndex.entries()].map(([key, ids]) => [
        key,
        new globalThis.Set<ID>(ids),
      ])
    ),
  };
}

export function addNodesToGraphIndex(
  graphIndex: GraphIndex,
  nodes: ImmutableMap<string, GraphNode>,
  sourceFilePath: string | undefined,
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
    addNodeSemanticEntries(nextIndex, node, sourceId, sourceFilePath);
  });
  return nextIndex;
}

export function removeNodesFromGraphIndex(
  graphIndex: GraphIndex,
  nodes: ImmutableMap<string, GraphNode>,
  sourceFilePath: string | undefined,
  sourceId: SourceId
): GraphIndex {
  if (nodes.size === 0) {
    return graphIndex;
  }

  const nextIndex = cloneIndex(graphIndex);

  nodes.valueSeq().forEach((node) => {
    removeNodeSemanticEntries(nextIndex, node, sourceId, sourceFilePath);
  });
  nodes.valueSeq().forEach((node) => {
    removeNodeSourceEntries(nextIndex, node, sourceId);
  });
  return nextIndex;
}

function sourceIdFromDocumentKey(documentKey: string): SourceId {
  const [sourceId] = documentKey.split(":");
  return sourceId || LOCAL;
}

export function buildGraphIndexFromDocuments(
  nodesByDocumentKey: ImmutableMap<string, ImmutableMap<string, GraphNode>>,
  filePathByDocumentKey: ImmutableMap<string, string> = ImmutableMap(),
  sourceIdByDocumentKey: ImmutableMap<string, SourceId> = ImmutableMap()
): GraphIndex {
  return nodesByDocumentKey.entrySeq().reduce((acc, [key, nodes]) => {
    const sourceId =
      sourceIdByDocumentKey.get(key) ?? sourceIdFromDocumentKey(key);
    return addNodesToGraphIndex(
      acc,
      nodes,
      filePathByDocumentKey.get(key),
      sourceId
    );
  }, createEmptyGraphIndex());
}
