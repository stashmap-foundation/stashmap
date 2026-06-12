import { List, Map as ImmutableMap, Set } from "immutable";
import {
  getChildNodes,
  getNode,
  resolveNode,
  itemPassesFilters,
  getSemanticID,
} from "./core/connections";
import {
  getBlockLinkText,
  getBlockFileLinkPath,
  getBlockFileLinkText,
  isBlockFileLink,
  isBlockLink,
  nodeText,
} from "./core/nodeSpans";
import { Document, documentKeyOf, getDocumentForNode } from "./core/Document";
import { fileLinkIndexKey, resolveLinkPath } from "./core/linkPath";
import { LOCAL, nodeRefKey } from "./core/nodeRef";
import { DEFAULT_TYPE_FILTERS } from "./core/constants";
import { referenceToText } from "./editor/referenceText";
import {
  getNodeInSource,
  graphLookupFromData,
  lookupNode,
  resolveBlockLinkTarget,
} from "./core/graphLookup";

function argumentPrefix(argument?: Argument): string {
  if (argument === "confirms") {
    return "+";
  }
  if (argument === "contra") {
    return "-";
  }
  return "";
}

type ParsedRef = {
  node: GraphNode;
  nodeSourceId: SourceId;
  contextNodes: List<GraphNode>;
  sourceItem?: GraphNode;
  sourceItemSourceId: SourceId;
};

function resolveFileLinkRoot(
  sourceItem: GraphNode,
  knowledgeDBs: KnowledgeDBs,
  documents: ImmutableMap<string, Document>,
  documentByFilePath: ImmutableMap<string, Document>
): GraphNode | undefined {
  const linkPath = getBlockFileLinkPath(sourceItem);
  if (!linkPath) return undefined;
  const sourceRoot =
    sourceItem.id === sourceItem.root
      ? sourceItem
      : getNode(knowledgeDBs, sourceItem.root, sourceItem.author);
  const sourceFilePath = sourceRoot?.docId
    ? documents.get(documentKeyOf(sourceRoot.author, sourceRoot.docId))
        ?.filePath
    : undefined;
  const resolved = resolveLinkPath(linkPath, sourceFilePath);
  const targetDoc =
    documentByFilePath.get(resolved) ||
    documents.get(documentKeyOf(sourceItem.author, resolved));
  if (!targetDoc) return undefined;
  const topNodeShortId = targetDoc.topNodeShortIds[0];
  return topNodeShortId
    ? getNode(knowledgeDBs, topNodeShortId as ID, targetDoc.author)
    : undefined;
}

function getConcreteContextNodes(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode
): List<GraphNode> {
  const loop = (
    currentParentID: ID | undefined,
    visited: Set<string>,
    nodes: List<GraphNode>
  ): List<GraphNode> => {
    if (!currentParentID) {
      return nodes;
    }
    const parentKey = currentParentID;
    if (visited.has(parentKey)) {
      return nodes;
    }
    const parentNode = getNode(knowledgeDBs, currentParentID, node.author);
    if (!parentNode) {
      return nodes;
    }
    return loop(
      parentNode.parent,
      visited.add(parentKey),
      nodes.unshift(parentNode)
    );
  };

  return loop(node.parent, Set<string>([node.id]), List<GraphNode>());
}

function parseRef(
  refId: ID,
  knowledgeDBs: KnowledgeDBs,
  myself: SourceId,
  documents?: ImmutableMap<string, Document>,
  documentByFilePath?: ImmutableMap<string, Document>
): ParsedRef | undefined {
  const sourceItem = getNode(knowledgeDBs, refId, myself);
  if (
    sourceItem &&
    isBlockFileLink(sourceItem) &&
    documents &&
    documentByFilePath
  ) {
    const fileLinkTarget = resolveFileLinkRoot(
      sourceItem,
      knowledgeDBs,
      documents,
      documentByFilePath
    );
    if (!fileLinkTarget) return undefined;
    const contextNodes = getConcreteContextNodes(knowledgeDBs, fileLinkTarget);
    return {
      node: fileLinkTarget,
      nodeSourceId: fileLinkTarget.author,
      contextNodes,
      sourceItem,
      sourceItemSourceId: sourceItem.author,
    };
  }
  const node = resolveNode(knowledgeDBs, sourceItem);
  if (!node) {
    return undefined;
  }

  const contextNodes = getConcreteContextNodes(knowledgeDBs, node);

  const effectiveSourceItem = sourceItem || node;
  return {
    node,
    nodeSourceId: node.author,
    contextNodes,
    sourceItem: effectiveSourceItem,
    sourceItemSourceId: effectiveSourceItem.author,
  };
}

function getConcreteContextNodesInSource(
  graph: ReturnType<typeof graphLookupFromData>,
  node: GraphNode,
  sourceId: SourceId
): List<GraphNode> {
  const loop = (
    currentParentID: ID | undefined,
    visited: Set<string>,
    nodes: List<GraphNode>
  ): List<GraphNode> => {
    if (!currentParentID) {
      return nodes;
    }
    const parentKey = `${sourceId}:${currentParentID}`;
    if (visited.has(parentKey)) {
      return nodes;
    }
    const parentNode = getNodeInSource(graph, {
      sourceId,
      id: currentParentID,
    })?.node;
    if (!parentNode) {
      return nodes;
    }
    return loop(
      parentNode.parent,
      visited.add(parentKey),
      nodes.unshift(parentNode)
    );
  };

  return loop(node.parent, Set<string>([`${sourceId}:${node.id}`]), List());
}

function resolveFileLinkRootInSource(
  sourceItem: GraphNode,
  graph: ReturnType<typeof graphLookupFromData>,
  sourceId: SourceId,
  documents: ImmutableMap<string, Document>,
  documentByFilePath: ImmutableMap<string, Document>
): { node: GraphNode; sourceId: SourceId } | undefined {
  const linkPath = getBlockFileLinkPath(sourceItem);
  if (!linkPath) return undefined;
  const sourceRoot =
    sourceItem.id === sourceItem.root
      ? sourceItem
      : getNodeInSource(graph, { sourceId, id: sourceItem.root })?.node;
  const sourceFilePath = sourceRoot?.docId
    ? documents.get(documentKeyOf(sourceRoot.author, sourceRoot.docId))
        ?.filePath
    : undefined;
  const resolved = resolveLinkPath(linkPath, sourceFilePath);
  const targetDoc =
    documentByFilePath.get(resolved) ||
    documents.get(documentKeyOf(sourceItem.author, resolved));
  const topNodeShortId = targetDoc?.topNodeShortIds[0];
  if (!targetDoc || !topNodeShortId) return undefined;
  const node = lookupNode(graph, topNodeShortId as ID, targetDoc.author)?.node;
  return node ? { node, sourceId: targetDoc.author } : undefined;
}

function parseRefInSource(
  graph: ReturnType<typeof graphLookupFromData>,
  refId: ID,
  data: Data,
  sourceId: SourceId
): ParsedRef | undefined {
  const source = lookupNode(graph, refId, sourceId);
  if (!source) {
    return undefined;
  }
  if (isBlockFileLink(source.node)) {
    const fileLinkTarget = resolveFileLinkRootInSource(
      source.node,
      graph,
      source.ref.sourceId,
      data.documents,
      data.documentByFilePath
    );
    if (!fileLinkTarget) return undefined;
    return {
      node: fileLinkTarget.node,
      nodeSourceId: fileLinkTarget.sourceId,
      contextNodes: getConcreteContextNodesInSource(
        graph,
        fileLinkTarget.node,
        fileLinkTarget.sourceId
      ),
      sourceItem: source.node,
      sourceItemSourceId: source.ref.sourceId,
    };
  }

  const target = isBlockLink(source.node)
    ? resolveBlockLinkTarget(graph, source)
    : source;
  if (!target) {
    return undefined;
  }
  return {
    node: target.node,
    nodeSourceId: target.ref.sourceId,
    contextNodes: getConcreteContextNodesInSource(
      graph,
      target.node,
      target.ref.sourceId
    ),
    sourceItem: source.node,
    sourceItemSourceId: source.ref.sourceId,
  };
}

function resolveLabels(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode,
  contextNodes: List<GraphNode>
): { contextLabels: string[]; targetLabel: string; fullContext: List<ID> } {
  const contextLabels = contextNodes.map((contextNode) =>
    nodeText(contextNode)
  );
  const targetLabel = nodeText(node);
  const fullContext = contextNodes.map((contextNode) =>
    getSemanticID(knowledgeDBs, contextNode)
  );
  return { contextLabels: contextLabels.toArray(), targetLabel, fullContext };
}

function buildReferenceFromParsed(
  refId: ID,
  knowledgeDBs: KnowledgeDBs,
  ref: ParsedRef
): {
  id: ID;
  sourceId: SourceId;
  type: "reference";
  text: string;
  targetContext: List<ID>;
  contextLabels: string[];
  targetLabel: string;
  author: SourceId;
  incomingRelevance?: Relevance;
  incomingArgument?: Argument;
  displayAs?: "bidirectional" | "incoming";
  versionMeta?: Row["versionMeta"];
  deleted?: boolean;
} {
  const { contextLabels, targetLabel, fullContext } = resolveLabels(
    knowledgeDBs,
    ref.node,
    ref.contextNodes
  );
  const contextPath = contextLabels.join(" / ");
  const text = contextPath ? `${contextPath} / ${targetLabel}` : targetLabel;

  return {
    id: refId,
    type: "reference",
    text,
    targetContext: fullContext,
    contextLabels,
    targetLabel,
    author: ref.node.author,
    sourceId: ref.nodeSourceId,
  };
}

function nodesShareLineage(left: GraphNode, right: GraphNode): boolean {
  return (
    left.basedOn === right.id ||
    right.basedOn === left.id ||
    (left.basedOn !== undefined && left.basedOn === right.basedOn)
  );
}

function buildDeletedReference(
  refId: ID,
  author: SourceId,
  sourceId: SourceId,
  linkText?: string
): ReturnType<typeof buildReferenceFromParsed> | undefined {
  if (!linkText) return undefined;

  const parts = linkText.split(" / ");
  const targetLabel = parts[parts.length - 1];
  const contextLabels = parts.slice(0, -1);
  return {
    id: refId,
    type: "reference",
    text: `(deleted) ${linkText}`,
    targetContext: List<ID>(),
    contextLabels,
    targetLabel,
    author,
    sourceId,
    deleted: true,
  };
}

function buildSourceParentReference(
  ref: ParsedRef,
  knowledgeDBs: KnowledgeDBs,
  myself: SourceId
): ReturnType<typeof buildReferenceFromParsed> | undefined {
  const { sourceItem } = ref;
  if (!sourceItem?.parent) {
    return undefined;
  }
  const sourceParent = getNode(
    knowledgeDBs,
    sourceItem.parent,
    sourceItem.author
  );
  if (!sourceParent) {
    return undefined;
  }
  const contextNodes = getConcreteContextNodes(knowledgeDBs, sourceParent);
  const { contextLabels, targetLabel, fullContext } = resolveLabels(
    knowledgeDBs,
    sourceParent,
    contextNodes
  );
  const contextPath = contextLabels.join(" / ");
  const text = contextPath ? `${contextPath} / ${targetLabel}` : targetLabel;

  return {
    id: sourceParent.id,
    type: "reference",
    text,
    targetContext: fullContext,
    contextLabels,
    targetLabel,
    author: sourceParent.author || myself,
    sourceId: sourceParent.author || myself,
  };
}

export function buildOutgoingReference(
  refId: ID,
  knowledgeDBs: KnowledgeDBs,
  myself: SourceId,
  documents?: ImmutableMap<string, Document>,
  documentByFilePath?: ImmutableMap<string, Document>
): ReturnType<typeof buildReferenceFromParsed> | undefined {
  const ref = parseRef(
    refId,
    knowledgeDBs,
    myself,
    documents,
    documentByFilePath
  );
  if (!ref) {
    const sourceItem = getNode(knowledgeDBs, refId, myself);
    return buildDeletedReference(
      refId,
      myself,
      myself,
      getBlockLinkText(sourceItem) ?? getBlockFileLinkText(sourceItem)
    );
  }

  const { contextLabels, targetLabel, fullContext } = resolveLabels(
    knowledgeDBs,
    ref.node,
    ref.contextNodes
  );
  const contextPath = contextLabels.join(" / ");
  const text = contextPath ? `${contextPath} / ${targetLabel}` : targetLabel;

  return {
    id: refId,
    type: "reference",
    text,
    targetContext: fullContext,
    contextLabels,
    targetLabel,
    author: ref.node.author,
    sourceId: ref.node.author,
  };
}

function effectiveIDs(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode,
  activeFilters: (
    | Relevance
    | "suggestions"
    | "versions"
    | "incoming"
    | "contains"
  )[]
): List<string> {
  return getChildNodes(knowledgeDBs, node, node.author)
    .filter(
      (item) =>
        itemPassesFilters(item, activeFilters) &&
        item.relevance !== "not_relevant"
    )
    .map((item) => getSemanticID(knowledgeDBs, item))
    .toList();
}

function computeNodeDiff(
  knowledgeDBs: KnowledgeDBs,
  versionNode: GraphNode,
  parentNode: GraphNode | undefined,
  activeFilters: (
    | Relevance
    | "suggestions"
    | "versions"
    | "incoming"
    | "contains"
  )[]
): { addCount: number; removeCount: number } {
  const versionIDs = effectiveIDs(
    knowledgeDBs,
    versionNode,
    activeFilters
  ).toSet();
  const parentIDs = parentNode
    ? effectiveIDs(knowledgeDBs, parentNode, activeFilters).toSet()
    : List<string>().toSet();
  return {
    addCount: versionIDs.filter((id) => !parentIDs.has(id)).size,
    removeCount: parentIDs.filter((id) => !versionIDs.has(id)).size,
  };
}

function computeVersionMeta(
  graph: ReturnType<typeof graphLookupFromData>,
  data: Data,
  refId: ID,
  sourceId: SourceId,
  parentNode: GraphNode | undefined,
  typeFilters: Pane["typeFilters"]
): Row["versionMeta"] {
  const source = lookupNode(graph, refId, sourceId);
  const node = source
    ? resolveBlockLinkTarget(graph, source)?.node ?? source.node
    : undefined;
  if (!node) return { updated: 0, addCount: 0, removeCount: 0 };

  const activeFilters = typeFilters || DEFAULT_TYPE_FILTERS;

  const { addCount, removeCount } = computeNodeDiff(
    data.knowledgeDBs,
    node,
    parentNode,
    activeFilters
  );
  return { updated: node.updated, addCount, removeCount };
}

function getReferenceSourceNodes(
  ref: ParsedRef,
  knowledgeDBs: KnowledgeDBs
): GraphNode[] {
  const parentNode = ref.node.parent
    ? getNode(knowledgeDBs, ref.node.parent, ref.node.author)
    : undefined;
  return parentNode && parentNode.id !== ref.node.id
    ? [ref.node, parentNode]
    : [ref.node];
}

function uniqueNodes(nodes: GraphNode[]): GraphNode[] {
  const seen = new globalThis.Set<ID>();
  return nodes.filter((node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
}

function getDocumentTopSourceNodes(ref: ParsedRef, data: Data): GraphNode[] {
  const document = getDocumentForNode(
    data.knowledgeDBs,
    data.documents,
    ref.node
  );
  if (!document) return [];
  return document.topNodeShortIds
    .map((nodeID) => getNode(data.knowledgeDBs, nodeID as ID, document.author))
    .filter((node): node is GraphNode => node !== undefined);
}

function linkOwnerID(item: GraphNode): ID {
  return (item.parent as ID | undefined) ?? item.id;
}

function findIndexedGraphLinkItem(
  graph: ReturnType<typeof graphLookupFromData>,
  data: Data,
  targetNode: GraphNode,
  sourceNodes: GraphNode[]
): GraphNode | undefined {
  const sourceIDs = new globalThis.Set(sourceNodes.map((node) => node.id));
  const itemRefs = data.graphIndex.incomingCrefsByTarget.get(
    nodeRefKey({ sourceId: targetNode.author, id: targetNode.id })
  );
  const items = itemRefs
    ? itemRefs.map((ref) => getNodeInSource(graph, ref)?.node)
    : (data.graphIndex.incomingCrefs.get(targetNode.id) ?? []).map(
        (ref) => getNodeInSource(graph, ref)?.node
      );
  return items
    .filter((item): item is GraphNode => item !== undefined)
    .find((item) => sourceIDs.has(linkOwnerID(item)));
}

function findIndexedFileLinkItem(
  graph: ReturnType<typeof graphLookupFromData>,
  data: Data,
  targetNode: GraphNode,
  sourceNodes: GraphNode[]
): GraphNode | undefined {
  const targetDocument = getDocumentForNode(
    data.knowledgeDBs,
    data.documents,
    targetNode
  );
  if (
    !targetDocument ||
    !targetDocument.filePath ||
    targetDocument.topNodeShortIds[0] !== targetNode.id
  ) {
    return undefined;
  }
  const itemRefs = data.graphIndex.incomingFileLinks.get(
    fileLinkIndexKey(targetDocument.author, targetDocument.filePath)
  );
  if (!itemRefs) return undefined;
  const sourceIDs = new globalThis.Set(sourceNodes.map((node) => node.id));
  return itemRefs
    .map((ref) => getNodeInSource(graph, ref)?.node)
    .filter((item): item is GraphNode => item !== undefined)
    .find((item) => sourceIDs.has(linkOwnerID(item)));
}

function findIndexedIncomingLinkItem(
  graph: ReturnType<typeof graphLookupFromData>,
  ref: ParsedRef,
  data: Data,
  targetNode: GraphNode
): GraphNode | undefined {
  const sourceNodes = uniqueNodes([
    ...getReferenceSourceNodes(ref, data.knowledgeDBs),
    ...getDocumentTopSourceNodes(ref, data),
  ]);
  return (
    findIndexedGraphLinkItem(graph, data, targetNode, sourceNodes) ??
    findIndexedFileLinkItem(graph, data, targetNode, sourceNodes)
  );
}

function findIncomingCrefItem(
  graph: ReturnType<typeof graphLookupFromData>,
  ref: ParsedRef,
  data: Data,
  containingNode: GraphNode | undefined
): GraphNode | undefined {
  return containingNode
    ? findIndexedIncomingLinkItem(graph, ref, data, containingNode)
    : undefined;
}

export function buildReferenceItem(
  graph: ReturnType<typeof graphLookupFromData>,
  refId: ID,
  data: Data,
  sourceId: SourceId,
  virtualType: Row["virtualType"],
  versionMeta: Row["versionMeta"],
  parentNode: GraphNode | undefined,
  containingNode: GraphNode | undefined,
  typeFilters: Pane["typeFilters"]
): Row["reference"] {
  const ref = parseRefInSource(graph, refId, data, sourceId);
  const resolvedOutgoing = ref
    ? buildReferenceFromParsed(refId, data.knowledgeDBs, ref)
    : undefined;
  if (!ref) {
    const parentItem = parentNode
      ? lookupNode(graph, refId, sourceId)?.node
      : undefined;
    const deleted = buildDeletedReference(
      refId,
      sourceId as SourceId,
      sourceId,
      getBlockLinkText(parentItem) ?? getBlockFileLinkText(parentItem)
    );
    return deleted;
  }

  if (virtualType === "suggestion") {
    return resolvedOutgoing
      ? { ...resolvedOutgoing, text: resolvedOutgoing.targetLabel }
      : undefined;
  }

  if (virtualType === "incoming") {
    const outgoing =
      ref.sourceItem && isBlockFileLink(ref.sourceItem)
        ? buildSourceParentReference(ref, data.knowledgeDBs, LOCAL) ??
          resolvedOutgoing
        : resolvedOutgoing;
    if (!outgoing) {
      return undefined;
    }
    const crefItem =
      virtualType === "incoming"
        ? findIncomingCrefItem(graph, ref, data, containingNode)
        : undefined;
    const incomingRelevance = crefItem?.relevance ?? ref.sourceItem?.relevance;
    const incomingArgument = crefItem?.argument ?? ref.sourceItem?.argument;
    const text = referenceToText({
      displayAs: "incoming" as const,
      contextLabels: outgoing.contextLabels,
      targetLabel: outgoing.targetLabel,
      incomingRelevance,
      incomingArgument,
    });
    return {
      ...outgoing,
      text,
      displayAs: "incoming" as const,
      incomingRelevance,
      incomingArgument,
    };
  }

  if (virtualType === "version" && versionMeta) {
    const outgoing = resolvedOutgoing;
    if (!outgoing) {
      return undefined;
    }
    const isOtherUser = outgoing.author !== LOCAL;
    const dateStr = new Date(versionMeta.updated).toLocaleString();
    const parts = [
      dateStr,
      ...(isOtherUser ? ["\u{1F464}"] : []),
      ...(versionMeta.addCount > 0 ? [`+${versionMeta.addCount}`] : []),
      ...(versionMeta.removeCount > 0 ? [`-${versionMeta.removeCount}`] : []),
    ];
    const text = parts.join(" ");
    return { ...outgoing, text, versionMeta };
  }

  const outgoing = resolvedOutgoing;
  if (!outgoing) {
    return undefined;
  }

  if (parentNode && nodesShareLineage(ref.node, parentNode)) {
    const computedVersionMeta = computeVersionMeta(
      graph,
      data,
      refId,
      sourceId,
      parentNode,
      typeFilters
    );
    return {
      ...outgoing,
      text: outgoing.text,
      versionMeta: computedVersionMeta,
    };
  }
  if (!containingNode) {
    return outgoing;
  }

  const storedItem = lookupNode(graph, refId, sourceId)?.node;
  const isNotRelevant = storedItem?.relevance === "not_relevant";

  const incomingCref = findIndexedIncomingLinkItem(
    graph,
    ref,
    data,
    containingNode
  );
  const hasActiveIncoming =
    !!incomingCref && incomingCref.relevance !== "not_relevant";

  const displayAs = (() => {
    if (!hasActiveIncoming) return undefined;
    return isNotRelevant ? "incoming" : "bidirectional";
  })();

  if (!displayAs) {
    const argument = argumentPrefix(
      storedItem?.argument ?? ref.sourceItem?.argument
    );
    if (!argument) {
      return outgoing;
    }
    const targetLabel = `${argument} ${outgoing.targetLabel}`;
    return {
      ...outgoing,
      targetLabel,
      text: referenceToText({
        contextLabels: outgoing.contextLabels,
        targetLabel,
      }),
    };
  }

  if (!incomingCref) {
    return outgoing;
  }
  const incomingRel = incomingCref.relevance;
  const incomingArg = incomingCref.argument;
  const text = referenceToText({
    displayAs,
    contextLabels: outgoing.contextLabels,
    targetLabel: outgoing.targetLabel,
    incomingRelevance: incomingRel,
    incomingArgument: incomingArg,
  });
  return {
    ...outgoing,
    text,
    displayAs,
    incomingRelevance: incomingRel,
    incomingArgument: incomingArg,
  };
}
