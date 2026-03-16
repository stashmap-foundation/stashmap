/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let, functional/immutable-data */
import { newDB } from "./knowledge";
import {
  getIndexedNodesForKeys,
  getChildNodes,
  getSemanticID,
  getNode,
  shortID,
} from "./connections";
import { isStandaloneRoot } from "./systemRoots";

function relationMatchesRequestedSemanticID(
  knowledgeDBs: KnowledgeDBs,
  relation: GraphNode,
  requestedSemanticID: ID
): boolean {
  return (
    shortID(getSemanticID(knowledgeDBs, relation)) ===
    shortID(requestedSemanticID)
  );
}

function getAuthorCandidateRelations(
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
  return getAuthorCandidateRelations(knowledgeDBs, author, semanticID)
    .filter(
      (relation) => relation.author === author && isStandaloneRoot(relation)
    )
    .sort((left, right) => right.updated - left.updated)
    .find((relation) =>
      relationMatchesRequestedSemanticID(knowledgeDBs, relation, semanticID)
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
      (relation) =>
        relation.author === author &&
        relation.root === root &&
        isStandaloneRoot(relation)
    )
    .sort((left, right) => right.updated - left.updated)
    .first();
}

function getMatchingChildRelation(
  knowledgeDBs: KnowledgeDBs,
  parentRelation: GraphNode,
  requestedSemanticID: ID
): GraphNode | undefined {
  return getChildNodes(
    knowledgeDBs,
    parentRelation,
    parentRelation.author
  ).find((relation): relation is GraphNode =>
    relationMatchesRequestedSemanticID(
      knowledgeDBs,
      relation,
      requestedSemanticID
    )
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
    !relationMatchesRequestedSemanticID(
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
    const nextNode = getMatchingChildRelation(
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
  itemID: ID
): ID[] {
  return [...semanticContext.toArray(), shortID(itemID) as ID];
}

function resolveRelationFromKnownRoot(
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

function resolveStandaloneRelationFromSemanticPath(
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
  itemID: ID,
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

  const semanticPath = buildRequestedSemanticPath(semanticContext, itemID);
  const preferredRoot =
    currentRoot ||
    (rootNodeId
      ? getNode(knowledgeDBs, rootNodeId, paneAuthor)?.root
      : undefined);

  if (preferredRoot) {
    return resolveRelationFromKnownRoot(
      knowledgeDBs,
      paneAuthor,
      semanticPath,
      preferredRoot
    );
  }

  if (!isRootNode) {
    return undefined;
  }

  return resolveStandaloneRelationFromSemanticPath(
    knowledgeDBs,
    paneAuthor,
    semanticPath
  );
}
