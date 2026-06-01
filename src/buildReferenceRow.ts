import { List, Map as ImmutableMap, Set } from "immutable";
import {
  getChildNodes,
  getNode,
  shortID,
  itemPassesFilters,
  getSemanticID,
  getNodeContext,
  getNodeSemanticID,
} from "./core/connections";
import {
  getBlockLinkText,
  getBlockFileLinkPath,
  getBlockFileLinkText,
  getBlockLinkTarget,
  isBlockFileLink,
  nodeText,
} from "./core/nodeSpans";
import {
  Document,
  documentKeyOf,
  getDocumentByIdOrFilePath,
  getDocumentForNode,
} from "./core/Document";
import { resolveLinkPath } from "./core/linkPath";
import {
  ViewPath,
  getParentView,
  getLast,
  getNodeForView,
} from "./ViewContext";
import { getPane } from "./planner";
import { DEFAULT_TYPE_FILTERS } from "./core/constants";
import { referenceToText } from "./editor/referenceText";
import { resolveNodeReferenceFromKnowledgeDBs } from "./core/sourceResolver";
import {
  GraphDataFields,
  filePathKeyOf,
  getNodeByKey,
  getNodeFromGraphData,
  getSourceNodeCandidates,
  nodeKeyOf,
  projectDocumentByFilePath,
  projectKnowledgeDBs,
} from "./core/graphData";

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
  contextNodes: List<GraphNode>;
  sourceItem?: GraphNode;
};

function resolveNodeReferenceFromGraphDataFields(
  graphData: GraphDataFields,
  id: ID,
  scope: { type: "local" } | { type: "source"; sourceId: SourceId },
  localSourceId: SourceId
): { node: GraphNode } | undefined {
  if (scope.type === "local") {
    const localNode = getNodeFromGraphData(graphData, id, localSourceId);
    if (localNode) {
      return { node: localNode };
    }
    const candidate = getSourceNodeCandidates(graphData, id).find(
      (entry) => entry.sourceId !== localSourceId
    );
    return candidate ? { node: candidate.node } : undefined;
  }
  const sourceNode = getNodeFromGraphData(graphData, id, scope.sourceId);
  return sourceNode ? { node: sourceNode } : undefined;
}

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
    currentParentID: LongID | undefined,
    visited: Set<string>,
    nodes: List<GraphNode>
  ): List<GraphNode> => {
    if (!currentParentID) {
      return nodes;
    }
    const parentKey = shortID(currentParentID);
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

  return loop(node.parent, Set<string>([shortID(node.id)]), List<GraphNode>());
}

function resolveNodeInSourceScope(
  graphData: GraphDataFields | undefined,
  knowledgeDBs: KnowledgeDBs,
  localSourceId: SourceId,
  sourceItem: GraphNode | undefined,
  allowIndexedTargetFallback: boolean = false
): GraphNode | undefined {
  const targetID = getBlockLinkTarget(sourceItem);
  if (!targetID || !sourceItem) {
    return sourceItem;
  }
  const scope =
    sourceItem.author === localSourceId
      ? ({ type: "local" } as const)
      : ({ type: "source", sourceId: sourceItem.author } as const);
  const indexedNode = graphData
    ? resolveNodeReferenceFromGraphDataFields(
        graphData,
        targetID,
        scope,
        localSourceId
      )?.node
    : undefined;
  return (
    indexedNode ??
    (allowIndexedTargetFallback && graphData
      ? getSourceNodeCandidates(graphData, targetID as ID)[0]?.node
      : undefined) ??
    resolveNodeReferenceFromKnowledgeDBs(
      knowledgeDBs,
      targetID,
      scope,
      localSourceId
    )?.node
  );
}

function semanticIDInSourceScope(
  knowledgeDBs: KnowledgeDBs,
  graphData: GraphDataFields | undefined,
  localSourceId: SourceId,
  node: GraphNode
): ID {
  const target = resolveNodeInSourceScope(
    graphData,
    knowledgeDBs,
    localSourceId,
    node
  );
  return target && target !== node
    ? semanticIDInSourceScope(knowledgeDBs, graphData, localSourceId, target)
    : getNodeSemanticID(node);
}

function parseRef(
  refId: LongID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  documents?: ImmutableMap<string, Document>,
  documentByFilePath?: ImmutableMap<string, Document>,
  graphData?: GraphDataFields,
  localSourceId: SourceId = myself,
  allowIndexedTargetFallback: boolean = false
): ParsedRef | undefined {
  const sourceItem =
    (graphData
      ? resolveNodeReferenceFromGraphDataFields(
          graphData,
          refId,
          { type: "source", sourceId: myself },
          localSourceId
        )?.node
      : undefined) ?? getNode(knowledgeDBs, refId, myself);
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
    return { node: fileLinkTarget, contextNodes, sourceItem };
  }
  const node = resolveNodeInSourceScope(
    graphData,
    knowledgeDBs,
    localSourceId,
    sourceItem,
    allowIndexedTargetFallback
  );
  if (!node) {
    return undefined;
  }

  const contextNodes = getConcreteContextNodes(knowledgeDBs, node);

  return { node, contextNodes, sourceItem: sourceItem || node };
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

function nodesMatchForVersion(
  knowledgeDBs: KnowledgeDBs,
  left: GraphNode,
  right: GraphNode
): boolean {
  return (
    getSemanticID(knowledgeDBs, left) === getSemanticID(knowledgeDBs, right) &&
    getNodeContext(knowledgeDBs, left).equals(
      getNodeContext(knowledgeDBs, right)
    )
  );
}

function buildDeletedReference(
  refId: LongID,
  myself: PublicKey,
  linkText?: string
): ReferenceRow | undefined {
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
    author: myself,
    deleted: true,
  };
}

function buildSourceParentReference(
  ref: ParsedRef,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): ReferenceRow | undefined {
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
  };
}

export function buildOutgoingReference(
  refId: LongID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  documents?: ImmutableMap<string, Document>,
  documentByFilePath?: ImmutableMap<string, Document>,
  graphData?: GraphDataFields,
  localSourceId: SourceId = myself,
  allowIndexedTargetFallback: boolean = false
): ReferenceRow | undefined {
  const ref = parseRef(
    refId,
    knowledgeDBs,
    myself,
    documents,
    documentByFilePath,
    graphData,
    localSourceId,
    allowIndexedTargetFallback
  );
  if (!ref) {
    const sourceItem = graphData
      ? resolveNodeReferenceFromGraphDataFields(
          graphData,
          refId,
          { type: "source", sourceId: myself },
          localSourceId
        )?.node
      : getNode(knowledgeDBs, refId, myself);
    return buildDeletedReference(
      refId,
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
  )[],
  graphData?: GraphDataFields,
  localSourceId: SourceId = node.author
): List<string> {
  return getChildNodes(knowledgeDBs, node, node.author)
    .filter(
      (item) =>
        itemPassesFilters(item, activeFilters) &&
        item.relevance !== "not_relevant"
    )
    .map((item) =>
      semanticIDInSourceScope(knowledgeDBs, graphData, localSourceId, item)
    )
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
  )[],
  graphData?: GraphDataFields,
  localSourceId: SourceId = versionNode.author
): { addCount: number; removeCount: number } {
  const versionIDs = effectiveIDs(
    knowledgeDBs,
    versionNode,
    activeFilters,
    graphData,
    localSourceId
  ).toSet();
  const parentIDs = parentNode
    ? effectiveIDs(
        knowledgeDBs,
        parentNode,
        activeFilters,
        graphData,
        localSourceId
      ).toSet()
    : List<string>().toSet();
  return {
    addCount: versionIDs.filter((id) => !parentIDs.has(id)).size,
    removeCount: parentIDs.filter((id) => !versionIDs.has(id)).size,
  };
}

function computeVersionMeta(data: Data, viewPath: ViewPath): VersionMeta {
  const refId = getLast(viewPath);
  const lookupSource =
    (getSourceNodeCandidates(data, refId)[0]?.sourceId as PublicKey | undefined) ??
    data.user.publicKey;
  const sourceItem =
    resolveNodeReferenceFromGraphDataFields(
      data,
      refId,
      { type: "source", sourceId: lookupSource },
      data.user.publicKey
    )?.node ?? getNode(projectKnowledgeDBs(data), refId, lookupSource);
  const node = resolveNodeInSourceScope(
    data,
    projectKnowledgeDBs(data),
    data.user.publicKey,
    sourceItem
  );
  if (!node) return { updated: 0, addCount: 0, removeCount: 0 };

  const pane = getPane(data, viewPath);
  const activeFilters = pane.typeFilters || DEFAULT_TYPE_FILTERS;

  const parentPath = getParentView(viewPath);
  const parentNode = parentPath ? getNodeForView(data, parentPath) : undefined;

  const { addCount, removeCount } = computeNodeDiff(
    projectKnowledgeDBs(data),
    node,
    parentNode,
    activeFilters,
    data,
    data.user.publicKey
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
  const seen = new globalThis.Set<LongID>();
  return nodes.filter((node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
}

function getDocumentTopSourceNodes(ref: ParsedRef, data: Data): GraphNode[] {
  const document = getDocumentForNode(
    projectKnowledgeDBs(data),
    data.documents,
    ref.node
  );
  if (!document) return [];
  return document.topNodeShortIds
    .map((nodeID) =>
      getNode(projectKnowledgeDBs(data), nodeID as ID, document.author)
    )
    .filter((node): node is GraphNode => node !== undefined);
}

function linkOwnerID(item: GraphNode): LongID {
  return (item.parent as LongID | undefined) ?? item.id;
}

function findIndexedGraphLinkItem(
  data: Data,
  targetNode: GraphNode,
  sourceNodes: GraphNode[]
): GraphNode | undefined {
  const sourceIDs = new globalThis.Set(sourceNodes.map((node) => node.id));
  const itemIDs = data.incomingCrefs.get(
    nodeKeyOf(targetNode.author as SourceId, targetNode.id)
  );
  if (!itemIDs) return undefined;
  return [...itemIDs]
    .map((itemID) => getNodeByKey(data, itemID))
    .filter((item): item is GraphNode => item !== undefined)
    .find((item) => sourceIDs.has(linkOwnerID(item)));
}

function findIndexedFileLinkItem(
  data: Data,
  targetNode: GraphNode,
  sourceNodes: GraphNode[]
): GraphNode | undefined {
  const targetDocument = getDocumentForNode(
    projectKnowledgeDBs(data),
    data.documents,
    targetNode
  );
  if (
    !targetDocument ||
    !targetDocument.filePath ||
    targetDocument.topNodeShortIds[0] !== shortID(targetNode.id)
  ) {
    return undefined;
  }
  const itemIDs = data.incomingFileLinks.get(
    filePathKeyOf(targetDocument.author as SourceId, targetDocument.filePath)
  );
  if (!itemIDs) return undefined;
  const sourceIDs = new globalThis.Set(sourceNodes.map((node) => node.id));
  return [...itemIDs]
    .map((itemID) => getNodeByKey(data, itemID))
    .filter((item): item is GraphNode => item !== undefined)
    .find((item) => sourceIDs.has(linkOwnerID(item)));
}

function findIndexedIncomingLinkItem(
  ref: ParsedRef,
  data: Data,
  targetNode: GraphNode
): GraphNode | undefined {
  const sourceNodes = uniqueNodes([
    ...getReferenceSourceNodes(ref, projectKnowledgeDBs(data)),
    ...getDocumentTopSourceNodes(ref, data),
  ]);
  return (
    findIndexedGraphLinkItem(data, targetNode, sourceNodes) ??
    findIndexedFileLinkItem(data, targetNode, sourceNodes)
  );
}

function getDocumentRootNodeForView(
  data: Data,
  viewPath: ViewPath
): GraphNode | undefined {
  const pane = getPane(data, viewPath);
  const document = pane.documentId
    ? getDocumentByIdOrFilePath(
        data.documents,
        projectDocumentByFilePath(data),
        pane.author,
        pane.documentId
      )
    : undefined;
  const topNodeShortId = document?.topNodeShortIds[0];
  return topNodeShortId && document
    ? getNode(projectKnowledgeDBs(data), topNodeShortId as ID, document.author)
    : undefined;
}

function findIncomingCrefItem(
  ref: ParsedRef,
  data: Data,
  viewPath: ViewPath
): GraphNode | undefined {
  const parentPath = getParentView(viewPath);
  const parentNode = parentPath
    ? getNodeForView(data, parentPath) ??
      getDocumentRootNodeForView(data, viewPath)
    : getDocumentRootNodeForView(data, viewPath);
  return parentNode
    ? findIndexedIncomingLinkItem(ref, data, parentNode)
    : undefined;
}

export function buildReferenceItem(
  refId: LongID,
  data: Data,
  viewPath: ViewPath,
  virtualType?: VirtualType,
  versionMeta?: VersionMeta
): ReferenceRow | undefined {
  const lookupAuthor =
    (getSourceNodeCandidates(data, refId as ID)[0]?.sourceId as
      | PublicKey
      | undefined) ?? data.user.publicKey;
  const ref = parseRef(
    refId,
    projectKnowledgeDBs(data),
    lookupAuthor,
    data.documents,
    projectDocumentByFilePath(data),
    data,
    data.user.publicKey,
    virtualType === "incoming"
  );
  const buildScopedOutgoingReference = (): ReferenceRow | undefined =>
    buildOutgoingReference(
      refId,
      projectKnowledgeDBs(data),
      lookupAuthor,
      data.documents,
      projectDocumentByFilePath(data),
      data,
      data.user.publicKey,
      virtualType === "incoming"
    );

  if (!ref) {
    const parentPath = getParentView(viewPath);
    const parentNode = parentPath
      ? getNodeForView(data, parentPath)
      : undefined;
    const parentItem = parentNode
      ? resolveNodeReferenceFromGraphDataFields(
          data,
          refId,
          { type: "source", sourceId: lookupAuthor },
          data.user.publicKey
        )?.node ?? getNode(projectKnowledgeDBs(data), refId, lookupAuthor)
      : undefined;
    const deleted = buildDeletedReference(
      refId,
      lookupAuthor,
      getBlockLinkText(parentItem) ?? getBlockFileLinkText(parentItem)
    );
    return deleted;
  }

  if (virtualType === "suggestion") {
    const outgoing = buildScopedOutgoingReference();
    return outgoing ? { ...outgoing, text: outgoing.targetLabel } : undefined;
  }

  if (virtualType === "incoming") {
    const outgoing =
      ref.sourceItem && isBlockFileLink(ref.sourceItem)
        ? buildSourceParentReference(ref, projectKnowledgeDBs(data), lookupAuthor) ??
          buildScopedOutgoingReference()
        : buildScopedOutgoingReference();
    if (!outgoing) {
      return undefined;
    }
    const crefItem =
      virtualType === "incoming"
        ? findIncomingCrefItem(ref, data, viewPath)
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
    const outgoing = buildScopedOutgoingReference();
    if (!outgoing) {
      return undefined;
    }
    const isOtherUser = outgoing.author !== data.user.publicKey;
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

  const outgoing = buildScopedOutgoingReference();
  if (!outgoing || !ref) {
    return outgoing;
  }

  const parentPath = getParentView(viewPath);
  const actualParentNode = parentPath
    ? getNodeForView(data, parentPath)
    : undefined;
  const parentNode =
    actualParentNode ?? getDocumentRootNodeForView(data, viewPath);
  if (
    actualParentNode &&
    nodesMatchForVersion(projectKnowledgeDBs(data), ref.node, actualParentNode)
  ) {
    const computedVersionMeta = computeVersionMeta(data, viewPath);
    return {
      ...outgoing,
      text: outgoing.text,
      versionMeta: computedVersionMeta,
    };
  }
  if (!parentNode) {
    return outgoing;
  }

  const storedItem = getNode(projectKnowledgeDBs(data), refId, lookupAuthor);
  const isNotRelevant = storedItem?.relevance === "not_relevant";

  const incomingCref = findIndexedIncomingLinkItem(ref, data, parentNode);
  const hasActiveIncoming =
    !!incomingCref && incomingCref.relevance !== "not_relevant";

  const displayAs: ReferenceRow["displayAs"] = (() => {
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

  const incomingRel = incomingCref!.relevance;
  const incomingArg = incomingCref!.argument;
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
