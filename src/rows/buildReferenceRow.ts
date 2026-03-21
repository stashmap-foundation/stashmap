import { List } from "immutable";
import type {
  GraphNode,
  KnowledgeDBs,
  VersionMeta,
  VirtualType,
} from "../graph/types";
import type { RowsData } from "./data";
import type { ReferenceRow } from "./types";
import { getNode } from "../graph/queries";
import {
  shortID,
  splitID,
  getSemanticID,
  getNodeContext,
} from "../graph/context";
import { resolveNode, isRefNode } from "../graph/references";
import { getTextForSemanticID } from "../graph/semanticText";
import { getParentRowPath, type RowPath } from "./rowPaths";
import { referenceToText } from "./display";
import { getNodeForView } from "./resolveRow";
import { getVersionMeta } from "./versionService";

function argumentPrefix(argument?: Argument): string {
  if (argument === "confirms") {
    return "+";
  }
  if (argument === "contra") {
    return "-";
  }
  return "";
}

function resolveNodeLabel(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  nodeId: ID
): string {
  return getTextForSemanticID(knowledgeDBs, nodeId, myself) || "Loading...";
}

function resolveContextLabels(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  context: List<ID>
): string[] {
  return context
    .map((nodeId) => resolveNodeLabel(knowledgeDBs, myself, nodeId))
    .toArray();
}

type ParsedRef = {
  node: GraphNode;
  nodeContext: List<ID>;
  sourceItem?: GraphNode;
};

function parseRef(
  refId: LongID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): ParsedRef | undefined {
  const sourceItem = getNode(knowledgeDBs, refId, myself);
  const node = resolveNode(knowledgeDBs, sourceItem);
  if (!node) {
    return undefined;
  }

  const nodeContext = getNodeContext(knowledgeDBs, node).map(
    (id) => shortID(id) as ID
  );

  return { node, nodeContext, sourceItem: sourceItem || node };
}

function resolveLabels(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  node: GraphNode,
  nodeContext: List<ID>
): { contextLabels: string[]; targetLabel: string; fullContext: List<ID> } {
  const contextLabels = resolveContextLabels(knowledgeDBs, myself, nodeContext);
  const targetLabel = resolveNodeLabel(
    knowledgeDBs,
    myself,
    getSemanticID(knowledgeDBs, node)
  );
  return { contextLabels, targetLabel, fullContext: nodeContext };
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
  myself: PublicKey
): ReferenceRow | undefined {
  const ref = parseRef(refId, knowledgeDBs, myself);
  if (!ref) return buildDeletedReference(refId, myself);

  const { contextLabels, targetLabel, fullContext } = resolveLabels(
    knowledgeDBs,
    myself,
    ref.node,
    ref.nodeContext
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

function getDiffParts(meta: VersionMeta): string[] {
  if (meta.diffStatus === "computed") {
    return [
      ...(meta.addCount > 0 ? [`+${meta.addCount}`] : []),
      ...(meta.removeCount > 0 ? [`-${meta.removeCount}`] : []),
    ];
  }
  if (meta.diffStatus === "loading") {
    return ["..."];
  }
  return [];
}

function findCrefToNode(
  children: List<ID>,
  targetNode: GraphNode,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): GraphNode | undefined {
  return children
    .map((childID) => getNode(knowledgeDBs, childID, myself))
    .find((item) => {
      if (!isRefNode(item)) return false;
      const resolvedTarget = resolveNode(knowledgeDBs, item);
      return resolvedTarget?.id === targetNode.id;
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
  data: RowsData,
  rowPath: RowPath,
  stack: ID[]
): GraphNode | undefined {
  const parentPath = getParentRowPath(rowPath);
  if (!parentPath) return undefined;
  const parentNode = getNodeForView(data, parentPath, stack);
  if (!parentNode) return undefined;
  return getReferenceSourceNodes(ref, data.knowledgeDBs)
    .map((sourceNode) =>
      findCrefToNode(
        sourceNode.children,
        parentNode,
        data.knowledgeDBs,
        data.user.publicKey
      )
    )
    .find((item) => item !== undefined);
}

export function buildReferenceRow(
  refId: LongID,
  data: RowsData,
  rowPath: RowPath,
  stack: ID[],
  virtualType?: VirtualType
): ReferenceRow | undefined {
  const ref = parseRef(refId, data.knowledgeDBs, data.user.publicKey);
  if (!ref) {
    const parentPath = getParentRowPath(rowPath);
    const parentNode = parentPath
      ? getNodeForView(data, parentPath, stack)
      : undefined;
    const parentItem = parentNode
      ? getNode(data.knowledgeDBs, refId, data.user.publicKey)
      : undefined;
    return buildDeletedReference(
      refId,
      data.user.publicKey,
      parentItem?.linkText
    );
  }

  if (virtualType === "suggestion") {
    const outgoing = buildOutgoingReference(
      refId,
      data.knowledgeDBs,
      data.user.publicKey
    );
    if (!outgoing) return undefined;
    return { ...outgoing, text: outgoing.targetLabel };
  }

  if (virtualType === "incoming") {
    const outgoing = buildOutgoingReference(
      refId,
      data.knowledgeDBs,
      data.user.publicKey
    );
    if (!outgoing) return undefined;
    const crefItem =
      virtualType === "incoming"
        ? findIncomingCrefItem(ref, data, rowPath, stack)
        : undefined;
    const incomingRelevance = crefItem?.relevance ?? ref.sourceItem?.relevance;
    const incomingArgument = crefItem?.argument ?? ref.sourceItem?.argument;
    const text = referenceToText({
      displayAs: "incoming",
      contextLabels: outgoing.contextLabels,
      targetLabel: outgoing.targetLabel,
      incomingRelevance,
      incomingArgument,
    });
    return {
      ...outgoing,
      text,
      displayAs: "incoming",
      incomingRelevance,
      incomingArgument,
    };
  }

  if (virtualType === "version") {
    const versionMeta = getVersionMeta(data, rowPath, stack);
    const outgoing = buildOutgoingReference(
      refId,
      data.knowledgeDBs,
      data.user.publicKey
    );
    if (!outgoing) return undefined;
    const isOtherUser = outgoing.author !== data.user.publicKey;
    const dateStr = new Date(versionMeta.updated).toLocaleString();
    const diffParts = getDiffParts(versionMeta);
    const parts = [
      dateStr,
      ...(isOtherUser ? ["\u{1F464}"] : []),
      ...diffParts,
    ];
    const text = parts.join(" ");
    return { ...outgoing, text, versionMeta };
  }

  const outgoing = buildOutgoingReference(
    refId,
    data.knowledgeDBs,
    data.user.publicKey
  );
  if (!outgoing || !ref) return outgoing;

  const parentPath = getParentRowPath(rowPath);
  if (!parentPath) return outgoing;

  const parentNode = getNodeForView(data, parentPath, stack);
  if (
    parentNode &&
    nodesMatchForVersion(data.knowledgeDBs, ref.node, parentNode)
  ) {
    const versionMeta = getVersionMeta(data, rowPath, stack);
    return { ...outgoing, text: outgoing.text, versionMeta };
  }
  if (!parentNode) return outgoing;

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
