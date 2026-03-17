import type { PublicKey } from "./identity";
import type {
  GraphNode,
  ID,
  KnowledgeDBs,
  LongID,
  RefTargetSeed,
} from "./types";
import { getNode } from "./queries";
import { getNodeStack } from "./context";

export function createRefTarget(
  targetID: LongID,
  linkText?: string
): RefTargetSeed {
  return { targetID, linkText };
}

export function isRefNode(
  node: GraphNode | undefined
): node is GraphNode & { targetID: LongID } {
  return !!node && (node.isRef === true || node.targetID !== undefined);
}

function getTargetNode(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode | undefined
): GraphNode | undefined {
  const targetID = node?.targetID;
  return targetID && node
    ? getNode(knowledgeDBs, targetID, node.author)
    : undefined;
}

export function resolveNode(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode | undefined
): GraphNode | undefined {
  if (!node) {
    return undefined;
  }
  return isRefNode(node) ? getTargetNode(knowledgeDBs, node) : node;
}

type RefTargetInfo = {
  stack: ID[];
  author: PublicKey;
  rootNodeId?: LongID;
  scrollToId?: string;
};

export function getNodeRouteTargetInfo(
  nodeID: LongID,
  knowledgeDBs: KnowledgeDBs,
  effectiveAuthor: PublicKey
): RefTargetInfo | undefined {
  const node = getNode(knowledgeDBs, nodeID, effectiveAuthor);
  if (!node) {
    return undefined;
  }
  return {
    stack: getNodeStack(knowledgeDBs, node),
    author: node.author,
    rootNodeId: node.id,
  };
}

export function getRefTargetInfo(
  refId: ID,
  knowledgeDBs: KnowledgeDBs,
  effectiveAuthor: PublicKey
): RefTargetInfo | undefined {
  const node = resolveNode(
    knowledgeDBs,
    getNode(knowledgeDBs, refId, effectiveAuthor)
  );
  if (!node) {
    return undefined;
  }

  return {
    stack: getNodeStack(knowledgeDBs, node),
    author: node.author,
    rootNodeId: node.id,
  };
}

export function getRefLinkTargetInfo(
  refId: ID,
  knowledgeDBs: KnowledgeDBs,
  effectiveAuthor: PublicKey
): RefTargetInfo | undefined {
  const node = resolveNode(
    knowledgeDBs,
    getNode(knowledgeDBs, refId, effectiveAuthor)
  );
  if (!node) {
    return undefined;
  }

  const containingParent = knowledgeDBs
    .get(node.author)
    ?.nodes.valueSeq()
    .find((candidate) =>
      candidate.children.some((childID) => childID === node.id)
    );
  const parentNode =
    (node.parent
      ? getNode(knowledgeDBs, node.parent, node.author)
      : undefined) || containingParent;
  const targetRoot = parentNode || node;

  return {
    stack: getNodeStack(knowledgeDBs, targetRoot),
    author: targetRoot.author,
    rootNodeId: targetRoot.id,
    scrollToId: targetRoot.id === node.id ? undefined : node.id,
  };
}
