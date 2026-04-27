import { List, Map as ImmutableMap, Set } from "immutable";
import {
  getChildNodes,
  getNode,
  resolveNode,
  isRefNode,
  shortID,
  splitID,
  itemPassesFilters,
  getSemanticID,
  getNodeContext,
} from "./connections";
import {
  getBlockLinkText,
  getBlockFileLinkPath,
  getBlockFileLinkText,
  isBlockFileLink,
  nodeText,
} from "./nodeSpans";
import { Document, documentKeyOf } from "./Document";
import { resolveLinkPath } from "./linkPath";
import {
  ViewPath,
  getParentView,
  getLast,
  getNodeForView,
} from "./ViewContext";
import { getPane } from "./planner";
import { DEFAULT_TYPE_FILTERS } from "./constants";
import { referenceToText } from "./components/referenceDisplay";

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
  const targetDoc = documentByFilePath.get(resolved);
  if (!targetDoc) return undefined;
  return knowledgeDBs
    .get(targetDoc.author)
    ?.nodes.valueSeq()
    .find((node) => node.docId === targetDoc.docId && !node.parent);
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

function parseRef(
  refId: LongID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
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
    return { node: fileLinkTarget, contextNodes, sourceItem };
  }
  const node = resolveNode(knowledgeDBs, sourceItem);
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
  const [remote] = splitID(refId);
  const author = remote || myself;

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
    deleted: true,
  };
}

export function buildOutgoingReference(
  refId: LongID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  documents?: ImmutableMap<string, Document>,
  documentByFilePath?: ImmutableMap<string, Document>
): ReferenceRow | undefined {
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
  data: Data,
  viewPath: ViewPath,
  stack: ID[]
): VersionMeta {
  const refId = getLast(viewPath);
  const node = resolveNode(
    data.knowledgeDBs,
    getNode(data.knowledgeDBs, refId, data.user.publicKey)
  );
  if (!node) return { updated: 0, addCount: 0, removeCount: 0 };

  const pane = getPane(data, viewPath);
  const activeFilters = pane.typeFilters || DEFAULT_TYPE_FILTERS;

  const parentPath = getParentView(viewPath);
  const parentNode = parentPath
    ? getNodeForView(data, parentPath, stack)
    : undefined;

  const { addCount, removeCount } = computeNodeDiff(
    data.knowledgeDBs,
    node,
    parentNode,
    activeFilters
  );
  return { updated: node.updated, addCount, removeCount };
}

function findCrefToNode(
  children: List<ID>,
  targetNode: GraphNode,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  documents?: ImmutableMap<string, Document>,
  documentByFilePath?: ImmutableMap<string, Document>
): GraphNode | undefined {
  return children
    .map((childID) => getNode(knowledgeDBs, childID, myself))
    .find((item) => {
      if (!item) return false;
      if (isRefNode(item)) {
        const resolvedTarget = resolveNode(knowledgeDBs, item);
        return resolvedTarget?.id === targetNode.id;
      }
      if (isBlockFileLink(item) && documents && documentByFilePath) {
        const resolvedTarget = resolveFileLinkRoot(
          item,
          knowledgeDBs,
          documents,
          documentByFilePath
        );
        return resolvedTarget?.id === targetNode.id;
      }
      return false;
    });
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

function findIncomingCrefItem(
  ref: ParsedRef,
  data: Data,
  viewPath: ViewPath,
  stack: ID[]
): GraphNode | undefined {
  const parentPath = getParentView(viewPath);
  if (!parentPath) return undefined;
  const parentNode = getNodeForView(data, parentPath, stack);
  if (!parentNode) return undefined;
  return getReferenceSourceNodes(ref, data.knowledgeDBs)
    .map((sourceNode) =>
      findCrefToNode(
        sourceNode.children,
        parentNode,
        data.knowledgeDBs,
        data.user.publicKey,
        data.documents,
        data.documentByFilePath
      )
    )
    .find((item) => item !== undefined);
}

export function buildReferenceItem(
  refId: LongID,
  data: Data,
  viewPath: ViewPath,
  stack: ID[],
  virtualType?: VirtualType,
  versionMeta?: VersionMeta
): ReferenceRow | undefined {
  const ref = parseRef(
    refId,
    data.knowledgeDBs,
    data.user.publicKey,
    data.documents,
    data.documentByFilePath
  );
  if (!ref) {
    const parentPath = getParentView(viewPath);
    const parentNode = parentPath
      ? getNodeForView(data, parentPath, stack)
      : undefined;
    const parentItem = parentNode
      ? getNode(data.knowledgeDBs, refId, data.user.publicKey)
      : undefined;
    const deleted = buildDeletedReference(
      refId,
      data.user.publicKey,
      getBlockLinkText(parentItem) ?? getBlockFileLinkText(parentItem)
    );
    return deleted;
  }

  if (virtualType === "suggestion") {
    const outgoing = buildOutgoingReference(
      refId,
      data.knowledgeDBs,
      data.user.publicKey,
      data.documents,
      data.documentByFilePath
    );
    return outgoing ? { ...outgoing, text: outgoing.targetLabel } : undefined;
  }

  if (virtualType === "incoming") {
    const outgoing = buildOutgoingReference(
      refId,
      data.knowledgeDBs,
      data.user.publicKey,
      data.documents,
      data.documentByFilePath
    );
    if (!outgoing) {
      return undefined;
    }
    const crefItem =
      virtualType === "incoming"
        ? findIncomingCrefItem(ref, data, viewPath, stack)
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
    const outgoing = buildOutgoingReference(
      refId,
      data.knowledgeDBs,
      data.user.publicKey,
      data.documents,
      data.documentByFilePath
    );
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

  const outgoing = buildOutgoingReference(
    refId,
    data.knowledgeDBs,
    data.user.publicKey,
    data.documents,
    data.documentByFilePath
  );
  if (!outgoing || !ref) {
    return outgoing;
  }

  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    return outgoing;
  }

  const parentNode = getNodeForView(data, parentPath, stack);
  if (
    parentNode &&
    nodesMatchForVersion(data.knowledgeDBs, ref.node, parentNode)
  ) {
    const computedVersionMeta = computeVersionMeta(data, viewPath, stack);
    return {
      ...outgoing,
      text: outgoing.text,
      versionMeta: computedVersionMeta,
    };
  }
  if (!parentNode) {
    return outgoing;
  }

  const storedItem = getNode(data.knowledgeDBs, refId, data.user.publicKey);
  const isNotRelevant = storedItem?.relevance === "not_relevant";

  const findReverseCref = (children: List<ID>): GraphNode | undefined =>
    findCrefToNode(
      children,
      parentNode,
      data.knowledgeDBs,
      data.user.publicKey
    );

  const incomingCref = getReferenceSourceNodes(ref, data.knowledgeDBs)
    .map((sourceNode) => findReverseCref(sourceNode.children))
    .find((item) => item !== undefined);
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
