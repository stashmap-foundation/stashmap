import { getBlockLinkTarget, isBlockLink } from "./nodeSpans";

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

export type ResolvedReference = {
  source: ResolvedNode;
  target: ResolvedNode;
};

const UNSAFE_MARKDOWN_ID_RE = /\s|["'<>]|-->/u;

export function isSafeMarkdownNodeId(id: string): boolean {
  return id.length > 0 && id.trim() === id && !UNSAFE_MARKDOWN_ID_RE.test(id);
}

function sourceOrderFromData(data: Data): SourceId[] {
  const preferred = [
    data.user.publicKey,
    ...data.contacts.keySeq().toArray(),
    ...data.knowledgeDBs.keySeq().toArray(),
    ...data.graphIndex.nodesBySource.keys(),
  ];
  return preferred.reduce<SourceId[]>(
    (acc, sourceId) => (acc.includes(sourceId) ? acc : [...acc, sourceId]),
    []
  );
}

export function graphLookupFromData(data: Data): GraphLookup {
  return {
    knowledgeDBs: data.knowledgeDBs,
    graphIndex: data.graphIndex,
    localSourceId: data.user.publicKey,
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
  const sourceNodes = graph.knowledgeDBs.get(ref.sourceId as PublicKey)?.nodes;
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

export function resolveBlockLinkTarget(
  graph: GraphLookup,
  source: ResolvedNode
): ResolvedNode | undefined {
  const targetID = getBlockLinkTarget(source.node);
  return targetID
    ? lookupNode(graph, targetID, source.ref.sourceId)
    : undefined;
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

function paneSourceId(panes: Pane[], paneIndex: number): SourceId | undefined {
  return panes[paneIndex]?.sourceId;
}

export function resolveReferenceForView(
  graph: GraphLookup,
  panes: Pane[],
  viewPath: readonly [number, ...ID[]],
  refId: ID
): ResolvedReference | undefined {
  const sourceId = paneSourceId(panes, viewPath[0]);
  if (!sourceId) {
    return undefined;
  }
  const source = lookupNode(graph, refId, sourceId);
  if (!source) {
    return undefined;
  }
  const target = isBlockLink(source.node)
    ? resolveBlockLinkTarget(graph, source)
    : source;
  return target ? { source, target } : undefined;
}
