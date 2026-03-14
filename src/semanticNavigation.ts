/* eslint-disable @typescript-eslint/no-use-before-define, functional/no-let, functional/immutable-data */
import { newDB } from "./knowledge";
import {
  getIndexedRelationsForKeys,
  getRelationChildNodes,
  getRelationSemanticID,
  getNode,
  shortID,
} from "./connections";
import { isStandaloneRoot } from "./systemRoots";

function relationMatchesRequestedSemanticID(
  relation: GraphNode,
  requestedSemanticID: ID
): boolean {
  return (
    shortID(getRelationSemanticID(relation)) === shortID(requestedSemanticID)
  );
}

function getAuthorCandidateRelations(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  semanticID: ID
): GraphNode[] {
  const authorDB = knowledgeDBs.get(author, newDB());
  return getIndexedRelationsForKeys(authorDB, [shortID(semanticID)]);
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
      relationMatchesRequestedSemanticID(relation, semanticID)
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
  return getRelationChildNodes(
    knowledgeDBs,
    parentRelation,
    parentRelation.author
  ).find((relation): relation is GraphNode =>
    relationMatchesRequestedSemanticID(relation, requestedSemanticID)
  );
}

function resolveRequestedStackFromRoot(
  knowledgeDBs: KnowledgeDBs,
  rootRelation: GraphNode,
  requestedStack: ID[]
): ResolvedStack | undefined {
  if (requestedStack.length === 0) {
    return { actualStack: [] };
  }
  if (
    !relationMatchesRequestedSemanticID(rootRelation, requestedStack[0] as ID)
  ) {
    return undefined;
  }

  let currentRelation: GraphNode | undefined = rootRelation;
  const actualStack: ID[] = [getRelationSemanticID(rootRelation)];

  for (let index = 1; index < requestedStack.length; index += 1) {
    if (!currentRelation) {
      return undefined;
    }
    const nextRelation = getMatchingChildRelation(
      knowledgeDBs,
      currentRelation,
      requestedStack[index] as ID
    );
    if (!nextRelation) {
      return undefined;
    }
    actualStack.push(getRelationSemanticID(nextRelation));
    currentRelation = nextRelation;
  }

  return { actualStack, relation: currentRelation };
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
    ? resolveRequestedStackFromRoot(knowledgeDBs, root, semanticPath)?.relation
    : undefined;
}

function resolveStandaloneRelationFromSemanticPath(
  knowledgeDBs: KnowledgeDBs,
  paneAuthor: PublicKey,
  semanticPath: ID[]
): GraphNode | undefined {
  return resolveSemanticStackToActualIDs(knowledgeDBs, paneAuthor, semanticPath)
    ?.relation;
}

export type ResolvedStack = {
  actualStack: ID[];
  relation?: GraphNode;
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

export function resolveSemanticRelationInCurrentTree(
  knowledgeDBs: KnowledgeDBs,
  paneAuthor: PublicKey,
  itemID: ID,
  semanticContext: Context,
  rootRelation: LongID | undefined,
  isRootNode: boolean,
  currentRoot?: ID
): GraphNode | undefined {
  if (isRootNode && rootRelation) {
    const relation = getNode(knowledgeDBs, rootRelation, paneAuthor);
    if (relation) {
      return relation;
    }
  }

  const semanticPath = buildRequestedSemanticPath(semanticContext, itemID);
  const preferredRoot =
    currentRoot ||
    (rootRelation
      ? getNode(knowledgeDBs, rootRelation, paneAuthor)?.root
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
