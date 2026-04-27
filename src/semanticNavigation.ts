/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let */
import { getChildNodes, getNode, getSemanticID, shortID } from "./connections";

function nodeMatchesRequestedID(node: GraphNode, requestedID: ID): boolean {
  return shortID(node.id) === shortID(requestedID);
}

function getMatchingChildNode(
  knowledgeDBs: KnowledgeDBs,
  parentNode: GraphNode,
  requestedID: ID
): GraphNode | undefined {
  return getChildNodes(knowledgeDBs, parentNode, parentNode.author).find(
    (node): node is GraphNode => nodeMatchesRequestedID(node, requestedID)
  );
}

function resolveRequestedStackFromRoot(
  knowledgeDBs: KnowledgeDBs,
  rootNode: GraphNode,
  requestedStack: ID[]
): ResolvedStack | undefined {
  if (requestedStack.length === 0) {
    return { actualStack: [] };
  }
  if (!nodeMatchesRequestedID(rootNode, requestedStack[0] as ID)) {
    return undefined;
  }

  return requestedStack.slice(1).reduce<ResolvedStack | undefined>(
    (acc, requestedID) => {
      if (!acc?.node) {
        return undefined;
      }
      const nextNode = getMatchingChildNode(
        knowledgeDBs,
        acc.node,
        requestedID as ID
      );
      if (!nextNode) {
        return undefined;
      }
      return {
        actualStack: [
          ...acc.actualStack,
          getSemanticID(knowledgeDBs, nextNode),
        ],
        node: nextNode,
      };
    },
    {
      actualStack: [getSemanticID(knowledgeDBs, rootNode)],
      node: rootNode,
    }
  );
}

function buildRequestedPath(context: Context, itemID: ID): ID[] {
  return [...context.toArray(), itemID];
}

type ResolvedStack = {
  actualStack: ID[];
  node?: GraphNode;
};

export function resolveSemanticStackToActualIDs(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  requestedStack: ID[]
): ResolvedStack | undefined {
  if (requestedStack.length === 0) {
    return { actualStack: [] };
  }

  const rootNode = getNode(knowledgeDBs, requestedStack[0] as ID, author);
  if (!rootNode) {
    return undefined;
  }

  return resolveRequestedStackFromRoot(knowledgeDBs, rootNode, requestedStack);
}

export function resolveSemanticNodeInCurrentTree(
  knowledgeDBs: KnowledgeDBs,
  paneAuthor: PublicKey,
  itemID: ID,
  context: Context,
  rootNodeId: LongID | undefined,
  isRootNode: boolean,
  currentRoot?: ID
): GraphNode | undefined {
  if (isRootNode && rootNodeId) {
    const node = getNode(knowledgeDBs, rootNodeId, paneAuthor);
    if (node) {
      return node;
    }
  }

  const directNode = getNode(knowledgeDBs, itemID, paneAuthor);
  if (directNode) {
    return directNode;
  }

  const requestedPath = buildRequestedPath(context, itemID);
  const preferredRoot =
    currentRoot ||
    (rootNodeId
      ? getNode(knowledgeDBs, rootNodeId, paneAuthor)?.root
      : undefined);

  if (preferredRoot) {
    const root = getNode(knowledgeDBs, preferredRoot, paneAuthor);
    return root
      ? resolveRequestedStackFromRoot(knowledgeDBs, root, requestedPath)?.node
      : undefined;
  }

  if (!isRootNode) {
    return undefined;
  }

  return resolveSemanticStackToActualIDs(
    knowledgeDBs,
    paneAuthor,
    requestedPath
  )?.node;
}
