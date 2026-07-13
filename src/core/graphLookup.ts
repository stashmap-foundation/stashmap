import { LOCAL } from "./nodeRef";

export type ResolvedNode = {
  ref: NodeRef;
  node: GraphNode;
};

export type GraphLookup = {
  knowledgeDBs: KnowledgeDBs;
  graphIndex: GraphIndex;
  localSourceId: SourceId;
  sourceOrder: readonly SourceId[];
};

const UNSAFE_MARKDOWN_ID_RE = /\s|["'<>]|-->/u;

export function isSafeMarkdownNodeId(id: string): boolean {
  return id.length > 0 && id.trim() === id && !UNSAFE_MARKDOWN_ID_RE.test(id);
}

type GraphLookupData = Pick<Data, "user" | "knowledgeDBs" | "graphIndex">;

function sourceOrderFromData(data: GraphLookupData): SourceId[] {
  const preferred = [
    LOCAL,
    ...data.knowledgeDBs.keySeq().toArray(),
    ...data.graphIndex.nodesBySource.keys(),
  ];
  return preferred.reduce<SourceId[]>(
    (acc, sourceId) => (acc.includes(sourceId) ? acc : [...acc, sourceId]),
    []
  );
}

export function graphLookupFromData(data: GraphLookupData): GraphLookup {
  return {
    knowledgeDBs: data.knowledgeDBs,
    graphIndex: data.graphIndex,
    localSourceId: LOCAL,
    sourceOrder: sourceOrderFromData(data),
  };
}

function nodeRef(sourceId: SourceId, node: GraphNode): NodeRef {
  return { sourceId, id: node.id };
}

function getNodeFromKnowledgeDBs(
  graph: GraphLookup,
  ref: NodeRef
): GraphNode | undefined {
  const sourceNodes = graph.knowledgeDBs.get(ref.sourceId as SourceId)?.nodes;
  return sourceNodes?.get(ref.id);
}

function getNodeFromGraphIndex(
  graph: GraphLookup,
  ref: NodeRef
): GraphNode | undefined {
  const sourceNodes = graph.graphIndex.nodesBySource.get(ref.sourceId);
  if (!sourceNodes) {
    return undefined;
  }
  return sourceNodes.get(ref.id);
}

export function getNodeInSource(
  graph: GraphLookup,
  ref: NodeRef
): ResolvedNode | undefined {
  const node =
    getNodeFromKnowledgeDBs(graph, ref) ?? getNodeFromGraphIndex(graph, ref);
  return node ? { ref: nodeRef(ref.sourceId, node), node } : undefined;
}

function sourceRank(graph: GraphLookup, sourceId: SourceId): number {
  const index = graph.sourceOrder.indexOf(sourceId);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function candidateSortKey(graph: GraphLookup, ref: NodeRef): string {
  return `${sourceRank(graph, ref.sourceId)}:${ref.sourceId}:${ref.id}`;
}

function uniqueCandidates(candidates: readonly NodeRef[]): NodeRef[] {
  return candidates.reduce<NodeRef[]>(
    (acc, ref) =>
      acc.some(
        (candidate) =>
          candidate.sourceId === ref.sourceId && candidate.id === ref.id
      )
        ? acc
        : [...acc, ref],
    []
  );
}

function sourceCandidatesForID(graph: GraphLookup, id: ID): NodeRef[] {
  const candidates = graph.graphIndex.sourceCandidatesById.get(id) ?? [];
  return [...uniqueCandidates(candidates)].sort((left, right) =>
    candidateSortKey(graph, left).localeCompare(candidateSortKey(graph, right))
  );
}

export function lookupNodes(graph: GraphLookup, id: ID): ResolvedNode[] {
  return sourceCandidatesForID(graph, id)
    .map((ref) => getNodeInSource(graph, ref))
    .filter((node): node is ResolvedNode => node !== undefined);
}

export function lookupNode(
  graph: GraphLookup,
  id: ID,
  currentSourceId: SourceId
): ResolvedNode | undefined {
  const direct = getNodeInSource(graph, { sourceId: currentSourceId, id });
  if (direct) {
    return direct;
  }
  if (currentSourceId !== graph.localSourceId) {
    return undefined;
  }
  const candidate = sourceCandidatesForID(graph, id).find(
    (ref) => ref.sourceId !== graph.localSourceId
  );
  return candidate ? getNodeInSource(graph, candidate) : undefined;
}

export function parentOf(
  graph: GraphLookup,
  node: ResolvedNode
): ResolvedNode | undefined {
  return node.node.parent
    ? getNodeInSource(graph, {
        sourceId: node.ref.sourceId,
        id: node.node.parent,
      })
    : undefined;
}

export function childrenOf(
  graph: GraphLookup,
  node: ResolvedNode
): ResolvedNode[] {
  return node.node.children
    .map((childID) =>
      getNodeInSource(graph, { sourceId: node.ref.sourceId, id: childID })
    )
    .filter((child): child is ResolvedNode => child !== undefined)
    .toArray();
}
