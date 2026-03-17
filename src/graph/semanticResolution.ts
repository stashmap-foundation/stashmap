/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let, functional/immutable-data */
import { getChildNodes, getNode } from "./queries";
import { getIndexedNodesForKeys, getSemanticID, shortID } from "./context";
import { newDB } from "./types";
import { isStandaloneRoot } from "../systemRoots";

function nodeMatchesRequestedSemanticID(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode,
  requestedSemanticID: ID
): boolean {
  return (
    shortID(getSemanticID(knowledgeDBs, node)) === shortID(requestedSemanticID)
  );
}

function getAuthorCandidateNodes(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  semanticID: ID
): GraphNode[] {
  const authorDB = knowledgeDBs.get(author, newDB());
  return getIndexedNodesForKeys(knowledgeDBs, authorDB, [shortID(semanticID)]);
}

function getNewestStandaloneRootBySemanticID(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  semanticID: ID
): GraphNode | undefined {
  return getAuthorCandidateNodes(knowledgeDBs, author, semanticID)
    .filter((node) => node.author === author && isStandaloneRoot(node))
    .sort((left, right) => right.updated - left.updated)
    .find((node) =>
      nodeMatchesRequestedSemanticID(knowledgeDBs, node, semanticID)
    );
}

function getStandaloneRootByRootID(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  root: ID
): GraphNode | undefined {
  return knowledgeDBs
    .get(author, newDB())
    .nodes.valueSeq()
    .filter(
      (node) =>
        node.author === author && node.root === root && isStandaloneRoot(node)
    )
    .sort((left, right) => right.updated - left.updated)
    .first();
}

function getMatchingChildNode(
  knowledgeDBs: KnowledgeDBs,
  parentNode: GraphNode,
  requestedSemanticID: ID
): GraphNode | undefined {
  return getChildNodes(knowledgeDBs, parentNode, parentNode.author).find(
    (node): node is GraphNode =>
      nodeMatchesRequestedSemanticID(knowledgeDBs, node, requestedSemanticID)
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
  if (
    !nodeMatchesRequestedSemanticID(
      knowledgeDBs,
      rootNode,
      requestedStack[0] as ID
    )
  ) {
    return undefined;
  }

  let currentNode: GraphNode | undefined = rootNode;
  const actualStack: ID[] = [getSemanticID(knowledgeDBs, rootNode)];

  for (let index = 1; index < requestedStack.length; index += 1) {
    if (!currentNode) {
      return undefined;
    }
    const nextNode = getMatchingChildNode(
      knowledgeDBs,
      currentNode,
      requestedStack[index] as ID
    );
    if (!nextNode) {
      return undefined;
    }
    actualStack.push(getSemanticID(knowledgeDBs, nextNode));
    currentNode = nextNode;
  }

  return { actualStack, node: currentNode };
}

function buildRequestedSemanticPath(
  semanticContext: Context,
  nodeID: ID
): ID[] {
  return [...semanticContext.toArray(), shortID(nodeID) as ID];
}

function resolveNodeFromKnownRoot(
  knowledgeDBs: KnowledgeDBs,
  paneAuthor: PublicKey,
  semanticPath: ID[],
  preferredRoot: ID
): GraphNode | undefined {
  const root = getStandaloneRootByRootID(
    knowledgeDBs,
    paneAuthor,
    preferredRoot
  );
  return root
    ? resolveRequestedStackFromRoot(knowledgeDBs, root, semanticPath)?.node
    : undefined;
}

function resolveStandaloneNodeFromSemanticPath(
  knowledgeDBs: KnowledgeDBs,
  paneAuthor: PublicKey,
  semanticPath: ID[]
): GraphNode | undefined {
  return resolveSemanticStackToActualIDs(knowledgeDBs, paneAuthor, semanticPath)
    ?.node;
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

  const standaloneRoot = getNewestStandaloneRootBySemanticID(
    knowledgeDBs,
    author,
    requestedStack[0] as ID
  );
  if (!standaloneRoot) {
    return undefined;
  }

  return resolveRequestedStackFromRoot(
    knowledgeDBs,
    standaloneRoot,
    requestedStack
  );
}

export function resolveSemanticNodeInCurrentTree(
  knowledgeDBs: KnowledgeDBs,
  paneAuthor: PublicKey,
  nodeID: ID,
  semanticContext: Context,
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

  const semanticPath = buildRequestedSemanticPath(semanticContext, nodeID);
  const preferredRoot =
    currentRoot ||
    (rootNodeId
      ? getNode(knowledgeDBs, rootNodeId, paneAuthor)?.root
      : undefined);

  if (preferredRoot) {
    return resolveNodeFromKnownRoot(
      knowledgeDBs,
      paneAuthor,
      semanticPath,
      preferredRoot
    );
  }

  if (!isRootNode) {
    return undefined;
  }

  return resolveStandaloneNodeFromSemanticPath(
    knowledgeDBs,
    paneAuthor,
    semanticPath
  );
}
