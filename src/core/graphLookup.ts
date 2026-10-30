import { Map } from "immutable";
import { LOCAL, pathOf, sourceAuthor } from "./nodeRef";
import { isInternalLinkHref } from "./nodeSpans";
import { isValidPath } from "./linkPath";
import { Document, documentKeyOf } from "./Document";

export type ResolvedNode = {
  ref: NodeRef;
  node: GraphNode;
  origin: "authored" | "computed";
};

export type GraphLookup = {
  knowledgeDBs: KnowledgeDBs;
  graphIndex: GraphIndex;
  documents: Map<string, Document>;
  localSourceId: SourceId;
  sourceOrder: readonly SourceId[];
  computedNodes: Map<ID, GraphNode>;
};

export function allKnownNodes(
  data: Pick<Data, "knowledgeDBs" | "graphIndex">
): GraphNode[] {
  const fromDBs = data.knowledgeDBs
    .valueSeq()
    .toArray()
    .flatMap((db) => db.nodes.valueSeq().toArray());
  const fromIndex = [...data.graphIndex.nodesBySource.values()].flatMap(
    (nodes) => [...nodes.values()]
  );
  return [...fromDBs, ...fromIndex];
}

type GraphLookupData = Pick<
  Data,
  "user" | "knowledgeDBs" | "graphIndex" | "computedNodes" | "documents"
>;

function sourceOrderFromData(data: GraphLookupData): SourceId[] {
  const others = [
    ...data.knowledgeDBs.keySeq().toArray(),
    ...data.graphIndex.nodesBySource.keys(),
  ]
    .filter((sourceId) => sourceId !== LOCAL)
    .sort();
  return [LOCAL, ...new Set(others)];
}

export function graphLookupFromData(data: GraphLookupData): GraphLookup {
  return {
    knowledgeDBs: data.knowledgeDBs,
    graphIndex: data.graphIndex,
    documents: data.documents,
    localSourceId: LOCAL,
    sourceOrder: sourceOrderFromData(data),
    computedNodes: data.computedNodes,
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

function authorSources(ref: NodeRef): SourceId[] {
  const author = sourceAuthor(ref.sourceId);
  return /^[0-9a-f]{64}$/u.test(author)
    ? [...new Set([ref.sourceId, author, `34774:${author}:${pathOf(ref.id)}`])]
    : [ref.sourceId];
}

export function getNodeInSource(
  graph: GraphLookup,
  ref: NodeRef
): ResolvedNode | undefined {
  return authorSources(ref).reduce<ResolvedNode | undefined>(
    (found, sourceId) => {
      if (found) {
        return found;
      }
      const sourceRef = { sourceId, id: ref.id };
      const node =
        getNodeFromKnowledgeDBs(graph, sourceRef) ??
        getNodeFromGraphIndex(graph, sourceRef);
      return node
        ? { ref: nodeRef(sourceId, node), node, origin: "authored" }
        : undefined;
    },
    undefined
  );
}

function sourceRank(graph: GraphLookup, sourceId: SourceId): number {
  const index = graph.sourceOrder.indexOf(sourceId);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function compareCandidates(
  graph: GraphLookup,
  left: NodeRef,
  right: NodeRef
): number {
  return (
    sourceRank(graph, left.sourceId) - sourceRank(graph, right.sourceId) ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.id.localeCompare(right.id)
  );
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
    compareCandidates(graph, left, right)
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
  return getNodeInSource(graph, { sourceId: currentSourceId, id });
}

export function resolveAuthoredFirst(
  graph: GraphLookup,
  id: ID,
  currentSourceId: SourceId
): ResolvedNode | undefined {
  const authored = lookupNode(graph, id, currentSourceId);
  if (authored) {
    return authored;
  }
  const node = graph.computedNodes.get(id);
  if (!node) {
    return undefined;
  }
  return (
    lookupNode(graph, id, graph.localSourceId) ?? {
      node,
      ref: { sourceId: graph.localSourceId, id },
      origin: "computed",
    }
  );
}

export function fileTopRowRef(graph: GraphLookup, ref: NodeRef): NodeRef {
  if (!isValidPath(ref.id)) {
    return ref;
  }
  const document = authorSources(ref)
    .map((sourceId) => graph.documents.get(documentKeyOf(sourceId, ref.id)))
    .find((candidate) => candidate !== undefined);
  const topRow = document?.topNodeShortIds[0];
  return document && topRow !== undefined
    ? { sourceId: document.sourceId, id: topRow }
    : ref;
}

export function resolveRef(
  graph: GraphLookup,
  ref: NodeRef
): ResolvedNode | undefined {
  const target = fileTopRowRef(graph, ref);
  const authored = getNodeInSource(graph, target);
  if (authored) {
    return authored;
  }
  const computed = graph.computedNodes.get(target.id);
  return computed
    ? {
        node: computed,
        ref: { sourceId: graph.localSourceId, id: target.id },
        origin: "computed",
      }
    : undefined;
}

export function resolveChildOf(
  graph: GraphLookup,
  parent: ResolvedNode,
  childID: ID
): ResolvedNode | undefined {
  return parent.origin === "computed"
    ? resolveAuthoredFirst(graph, childID, parent.ref.sourceId)
    : getNodeInSource(graph, { sourceId: parent.ref.sourceId, id: childID });
}

export function parentOf(
  graph: GraphLookup,
  node: ResolvedNode
): ResolvedNode | undefined {
  if (!node.node.parent) {
    return undefined;
  }
  return node.origin === "computed"
    ? resolveAuthoredFirst(graph, node.node.parent, node.ref.sourceId)
    : getNodeInSource(graph, {
        sourceId: node.ref.sourceId,
        id: node.node.parent,
      });
}

export function linkSpeaker(
  graph: GraphLookup,
  occurrence: ResolvedNode
): ResolvedNode {
  const onlySpan =
    occurrence.node.spans.length === 1 ? occurrence.node.spans[0] : undefined;
  if (onlySpan?.kind !== "link" || !isInternalLinkHref(onlySpan.href)) {
    return occurrence;
  }
  return parentOf(graph, occurrence) ?? occurrence;
}

export function childrenOf(
  graph: GraphLookup,
  node: ResolvedNode
): ResolvedNode[] {
  return node.node.children
    .map((childID) => resolveChildOf(graph, node, childID))
    .filter((child): child is ResolvedNode => child !== undefined)
    .toArray();
}
