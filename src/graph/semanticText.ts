import { List } from "immutable";
import type { GraphNode, KnowledgeDBs, KnowledgeData } from "./types";
import {
  shortID,
  splitID,
  isSearchId,
  parseSearchId,
  getNodeSemanticID,
  getNodeText,
} from "./context";
import { getNode } from "./queries";
import { isRefNode } from "./references";
import { EMPTY_SEMANTIC_ID } from "./types";

function getFallbackSemanticText(semanticID?: ID): string {
  if (!semanticID) {
    return "";
  }
  const localID = shortID(semanticID as ID) as ID;
  if (localID === EMPTY_SEMANTIC_ID) {
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
        .filter((_, publicKey) => publicKey !== preferredAuthor)
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

  const node = getConcreteNodesForSemanticID(
    knowledgeDBs,
    semanticID,
    author
  )[0];
  const nodeText = getNodeText(node);
  if (nodeText !== undefined) {
    return nodeText;
  }

  const fallbackText = getFallbackSemanticText(semanticID);
  return fallbackText !== "" || localID === EMPTY_SEMANTIC_ID
    ? fallbackText
    : undefined;
}
