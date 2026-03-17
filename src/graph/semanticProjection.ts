import { List } from "immutable";
import type {
  Context,
  GraphNode,
  KnowledgeDBs,
  KnowledgeData,
  SemanticIndex,
} from "./types";
import {
  shortID,
  splitID,
  isSearchId,
  parseSearchId,
  getNodeSemanticID,
  getSemanticID,
  getNodeContext,
  getNodeText,
} from "./context";
import { getNode } from "./queries";
import { isRefNode } from "./references";
import { EMPTY_SEMANTIC_ID as EMPTY_NODE_ID } from "./types";

type ReferencedByRef = {
  nodeID: LongID;
  context: Context;
  updated: number;
};

function getFallbackSemanticText(semanticID?: ID): string {
  if (!semanticID) {
    return "";
  }
  const localID = shortID(semanticID as ID) as ID;
  if (localID === EMPTY_NODE_ID) {
    return "";
  }
  if (isSearchId(localID)) {
    return parseSearchId(localID) || "";
  }
  return "";
}

function getConcreteNodesForSemanticID(
  knowledgeDBs: KnowledgeDBs,
  semanticID: ID,
  author: PublicKey
): GraphNode[] {
  if (isSearchId(semanticID as ID)) {
    return [];
  }

  const directNode = getNode(knowledgeDBs, semanticID, author);
  if (directNode) {
    if (isRefNode(directNode)) {
      return [];
    }
    return [directNode];
  }

  const [remote, localID] = splitID(semanticID as ID);
  const preferredAuthor = remote || author;
  const preferredDB = knowledgeDBs.get(preferredAuthor);
  const otherDBs = remote
    ? []
    : knowledgeDBs
        .filter((_, pk) => pk !== preferredAuthor)
        .valueSeq()
        .toArray();
  const candidateDBs = [preferredDB, ...otherDBs].filter(
    (db): db is KnowledgeData => db !== undefined
  );

  return List(
    candidateDBs.flatMap((db) =>
      db.nodes
        .valueSeq()
        .filter(
          (node) =>
            !isRefNode(node) &&
            (shortID(getNodeSemanticID(node)) === localID ||
              node.text === localID)
        )
        .toArray()
    )
  )
    .sort((left, right) => {
      const leftExact = shortID(getNodeSemanticID(left)) === localID ? 0 : 1;
      const rightExact = shortID(getNodeSemanticID(right)) === localID ? 0 : 1;
      if (leftExact !== rightExact) {
        return leftExact - rightExact;
      }
      const leftPreferred = left.author === preferredAuthor ? 0 : 1;
      const rightPreferred = right.author === preferredAuthor ? 0 : 1;
      if (leftPreferred !== rightPreferred) {
        return leftPreferred - rightPreferred;
      }
      return right.updated - left.updated;
    })
    .toArray();
}

function getConcreteNodeForSemanticID(
  knowledgeDBs: KnowledgeDBs,
  semanticID: ID,
  author: PublicKey
): GraphNode | undefined {
  return getConcreteNodesForSemanticID(knowledgeDBs, semanticID, author)[0];
}

export function getTextForSemanticID(
  knowledgeDBs: KnowledgeDBs,
  semanticID: ID,
  author: PublicKey
): string | undefined {
  const localID = shortID(semanticID as ID) as ID;
  if (isSearchId(localID)) {
    return parseSearchId(localID) || "";
  }

  const directNode = getNode(knowledgeDBs, semanticID, author);
  if (directNode) {
    if (isRefNode(directNode)) {
      return undefined;
    }
    return getNodeText(directNode);
  }

  const node = getConcreteNodeForSemanticID(knowledgeDBs, semanticID, author);
  const nodeText = getNodeText(node);
  if (nodeText !== undefined) {
    return nodeText;
  }

  const fallbackText = getFallbackSemanticText(semanticID);
  return fallbackText !== "" || localID === EMPTY_NODE_ID
    ? fallbackText
    : undefined;
}

function getContextKey(context: Context): string {
  return context.join(":");
}

function contextsSemanticallyMatch(
  leftContext: Context,
  rightContext: Context
): boolean {
  return getContextKey(leftContext) === getContextKey(rightContext);
}

function getSemanticCandidates(
  semanticIndex: SemanticIndex,
  semanticKey: string
): List<GraphNode> {
  const nodeIDs = semanticIndex.semantic.get(semanticKey);
  if (!nodeIDs) {
    return List<GraphNode>();
  }

  return List(
    [...nodeIDs]
      .map((nodeID) => semanticIndex.nodeByID.get(nodeID))
      .filter((node): node is GraphNode => node !== undefined)
      .sort((left, right) => right.updated - left.updated)
  );
}

export function findRefsToNode(
  knowledgeDBs: KnowledgeDBs,
  semanticIndex: SemanticIndex,
  semanticID: ID,
  filterContext?: Context,
  targetAuthor?: PublicKey,
  targetRoot?: ID
): List<ReferencedByRef> {
  const targetSemanticKey =
    targetAuthor && targetRoot ? semanticID : (shortID(semanticID as ID) as ID);
  const resolvedRefs = getSemanticCandidates(semanticIndex, targetSemanticKey)
    .filter((node) => !isSearchId(getSemanticID(knowledgeDBs, node)))
    .filter(
      (node) =>
        !getNodeContext(knowledgeDBs, node).some((id) => isSearchId(id as ID))
    )
    .map((node) => ({
      ref: {
        nodeID: node.id,
        context: getNodeContext(knowledgeDBs, node),
        updated: node.updated,
      },
      author: node.author,
      root: node.root,
    }))
    .toList();

  const allRefs = filterContext
    ? resolvedRefs
        .filter(({ ref, author, root }) =>
          targetAuthor !== undefined &&
          targetRoot !== undefined &&
          author === targetAuthor &&
          root === targetRoot
            ? ref.context.equals(filterContext)
            : contextsSemanticallyMatch(ref.context, filterContext)
        )
        .map(({ ref }) => ref)
        .toList()
    : resolvedRefs.map(({ ref }) => ref).toList();

  return allRefs
    .groupBy((ref) => ref.nodeID)
    .map((grp) => grp.first()!)
    .valueSeq()
    .toList();
}

function getRefContextKey(
  _knowledgeDBs: KnowledgeDBs,
  ref: ReferencedByRef
): string {
  return getContextKey(ref.context);
}

export function deduplicateRefsByContext(
  refs: List<ReferencedByRef>,
  knowledgeDBs: KnowledgeDBs,
  preferAuthor?: PublicKey
): List<ReferencedByRef> {
  return refs
    .groupBy((ref) => getRefContextKey(knowledgeDBs, ref))
    .map(
      (group) =>
        group
          .sortBy((ref) => {
            const [author] = splitID(ref.nodeID);
            const isOther =
              preferAuthor && author !== undefined && author !== preferAuthor
                ? 1
                : 0;
            return [isOther, -ref.updated];
          })
          .first()!
    )
    .valueSeq()
    .toList();
}
