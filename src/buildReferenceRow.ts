import { List, Set } from "immutable";
import { displayTextOf } from "./core/ical";
import { nodeText } from "./core/nodeSpans";
import { getDocumentForNode } from "./core/Document";
import { isCanonicalId } from "./core/entityRecognition";
import { fileLinkIndexKey } from "./core/linkPath";
import { nodeRefKey } from "./core/nodeRef";
import { referenceToText } from "./editor/referenceText";
import {
  ResolvedNode,
  getNodeInSource,
  graphLookupFromData,
  linkSpeaker,
  lookupNode,
} from "./core/graphLookup";

type ParsedRef = {
  node: GraphNode;
  nodeSourceId: SourceId;
  contextNodes: List<GraphNode>;
};

function getConcreteContextNodes(
  graph: ReturnType<typeof graphLookupFromData>,
  node: GraphNode,
  sourceId: SourceId
): List<GraphNode> {
  const loop = (
    currentParentID: ID | undefined,
    visited: Set<string>,
    nodes: List<GraphNode>
  ): List<GraphNode> => {
    if (!currentParentID) return nodes;
    const parentKey = `${sourceId}:${currentParentID}`;
    if (visited.has(parentKey)) return nodes;
    const parentNode = getNodeInSource(graph, {
      sourceId,
      id: currentParentID,
    })?.node;
    return parentNode
      ? loop(
          parentNode.parent,
          visited.add(parentKey),
          nodes.unshift(parentNode)
        )
      : nodes;
  };

  return loop(node.parent, Set([`${sourceId}:${node.id}`]), List());
}

function parseRef(
  graph: ReturnType<typeof graphLookupFromData>,
  refId: ID,
  sourceId: SourceId
): ParsedRef | undefined {
  const source = lookupNode(graph, refId, sourceId);
  return source
    ? {
        node: source.node,
        nodeSourceId: source.ref.sourceId,
        contextNodes: getConcreteContextNodes(
          graph,
          source.node,
          source.ref.sourceId
        ),
      }
    : undefined;
}

function buildReference(
  refId: ID,
  ref: ParsedRef
): NonNullable<Row["reference"]> {
  const targetLabel = displayTextOf(nodeText(ref.node));
  const contextLabels = ref.contextNodes
    .map((node) => displayTextOf(nodeText(node)))
    .toArray()
    .filter(
      (label, index, labels) =>
        label !== targetLabel || index !== labels.length - 1
    );
  return {
    id: refId,
    text: [...contextLabels, targetLabel].join(" / "),
    contextLabels,
    targetLabel,
    sourceId: ref.nodeSourceId,
  };
}

function sameRef(left: NodeRef, right: NodeRef): boolean {
  return left.id === right.id && left.sourceId === right.sourceId;
}

function uniqueRefs(refs: readonly NodeRef[]): NodeRef[] {
  return refs.reduce<NodeRef[]>(
    (acc, ref) =>
      acc.some((candidate) => sameRef(candidate, ref)) ? acc : [...acc, ref],
    []
  );
}

function incomingGraphRefs(data: Data, target: ResolvedNode): NodeRef[] {
  const exact =
    data.graphIndex.incomingCrefsByTarget.get(nodeRefKey(target.ref)) ?? [];
  const unscoped = data.graphIndex.incomingCrefs.get(target.node.id) ?? [];
  if (isCanonicalId(target.node.id)) {
    return uniqueRefs([...exact, ...unscoped]);
  }
  if (exact.length > 0) {
    return exact;
  }
  return unscoped;
}

function incomingFileRefs(data: Data, target: ResolvedNode): NodeRef[] {
  const document = getDocumentForNode(
    data.knowledgeDBs,
    data.documents,
    target.node,
    target.ref.sourceId
  );
  return document?.filePath && document.topNodeShortIds[0] === target.node.id
    ? data.graphIndex.incomingFileLinks.get(
        fileLinkIndexKey(document.sourceId, document.filePath)
      ) ?? []
    : [];
}

function findIncomingLinkItem(
  graph: ReturnType<typeof graphLookupFromData>,
  data: Data,
  source: NodeRef,
  target: ResolvedNode | undefined
): GraphNode | undefined {
  if (!target) return undefined;
  return [...incomingGraphRefs(data, target), ...incomingFileRefs(data, target)]
    .map((candidate) => getNodeInSource(graph, candidate))
    .filter((candidate): candidate is ResolvedNode => candidate !== undefined)
    .find((candidate) => sameRef(linkSpeaker(graph, candidate).ref, source))
    ?.node;
}

export function findReciprocalLinkItem(
  graph: ReturnType<typeof graphLookupFromData>,
  data: Data,
  sourceOccurrence: ResolvedNode,
  target: ResolvedNode
): GraphNode | undefined {
  const source = linkSpeaker(graph, sourceOccurrence);
  const refs = [
    ...incomingGraphRefs(data, source),
    ...incomingFileRefs(data, source),
  ];
  return refs
    .filter((candidate) => !sameRef(candidate, sourceOccurrence.ref))
    .map((candidate) => getNodeInSource(graph, candidate))
    .filter((candidate): candidate is ResolvedNode => candidate !== undefined)
    .find((candidate) => sameRef(linkSpeaker(graph, candidate).ref, target.ref))
    ?.node;
}

export function buildReferenceItem(
  graph: ReturnType<typeof graphLookupFromData>,
  refId: ID,
  data: Data,
  sourceId: SourceId,
  virtualType: Row["virtualType"],
  containing: ResolvedNode | undefined
): Row["reference"] {
  if (virtualType !== "incoming") return undefined;
  const parsed = parseRef(graph, refId, sourceId);
  if (!parsed) return undefined;
  const outgoing = buildReference(refId, parsed);
  const sourceRef = { sourceId: parsed.nodeSourceId, id: parsed.node.id };
  const incoming = findIncomingLinkItem(graph, data, sourceRef, containing);
  const incomingRelevance = incoming?.relevance ?? parsed.node.relevance;
  const incomingArgument = incoming?.argument ?? parsed.node.argument;
  return {
    ...outgoing,
    text: referenceToText({
      displayAs: "incoming",
      contextLabels: outgoing.contextLabels,
      targetLabel: outgoing.targetLabel,
      incomingRelevance,
      incomingArgument,
    }),
    displayAs: "incoming",
    incomingRelevance,
    incomingArgument,
  };
}
