import { List, Set, Map } from "immutable";
import { v4 } from "uuid";
import { newRelations, getNodeFromID } from "./ViewContext";
import { REFERENCED_BY, REF_PREFIX } from "./constants";

// Type guards for KnowNode union type
export function isTextNode(node: KnowNode): node is TextNode {
  return node.type === "text";
}

export function isProjectNode(node: KnowNode): node is ProjectNode {
  return node.type === "project";
}

export function isReferenceNode(node: KnowNode): node is ReferenceNode {
  return node.type === "reference";
}

export function hasImageUrl(
  node: KnowNode
): node is TextNode | ProjectNode {
  return node.type === "text" || node.type === "project";
}

// Reference ID utilities
// Format: "ref:targetId:context0:context1:..."
export function isRefId(id: ID | LongID): boolean {
  return id.startsWith(REF_PREFIX);
}

export function createRefId(context: Context, targetNode: ID): LongID {
  const parts = [REF_PREFIX.slice(0, -1), ...context.toArray(), targetNode];
  return parts.join(":") as LongID;
}

export function parseRefId(
  refId: ID | LongID
): { targetNode: ID; targetContext: Context } | undefined {
  if (!isRefId(refId)) {
    return undefined;
  }
  const parts = refId.split(":");
  if (parts.length < 2) {
    return undefined;
  }
  const targetNode = parts[parts.length - 1] as ID;
  const targetContext = List(parts.slice(1, -1) as ID[]);
  return { targetNode, targetContext };
}

export function extractNodeIdsFromRefId(refId: ID | LongID): List<ID> {
  const parsed = parseRefId(refId);
  if (!parsed) {
    return List();
  }
  // Return all node IDs: target + context
  return List<ID>([parsed.targetNode]).concat(parsed.targetContext);
}

export function buildReferenceNode(
  refId: LongID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): ReferenceNode | undefined {
  const parsed = parseRefId(refId);
  if (!parsed) {
    return undefined;
  }
  const { targetNode, targetContext } = parsed;

  // Build the display text by looking up each node
  const getNodeText = (nodeId: ID): string => {
    const node = getNodeFromID(knowledgeDBs, nodeId, myself);
    return node?.text || "Loading...";
  };

  const contextTexts = targetContext.map(getNodeText);
  const targetText = getNodeText(targetNode);
  const displayText = contextTexts.push(targetText).join(" → ");

  return {
    id: refId,
    type: "reference",
    text: displayText,
    targetNode,
    targetContext,
  };
}

export function splitID(id: ID): [PublicKey | undefined, string] {
  const split = id.split("_");
  if (split.length === 1) {
    return [undefined, split[0]];
  }
  return [split[0] as PublicKey, split.slice(1).join(":")];
}

export function joinID(remote: PublicKey | string, id: string): LongID {
  return `${remote}_${id}` as LongID;
}

export function shortID(id: ID): string {
  return splitID(id)[1];
}

export function getRelationsNoReferencedBy(
  knowledgeDBs: KnowledgeDBs,
  relationID: ID | undefined,
  myself: PublicKey
): Relations | undefined {
  if (!relationID) {
    return undefined;
  }
  const [remote, id] = splitID(relationID);
  if (remote) {
    return knowledgeDBs.get(remote)?.relations.get(id);
  }
  const res = knowledgeDBs.get(myself)?.relations.get(relationID);
  return res;
}

type ReferencedByPath = {
  head: ID;
  context: Context;
  updated: number;
};

export function getReferencedByRelations(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  nodeID: LongID | ID
): Relations | undefined {
  const rel = newRelations(nodeID, List<ID>(), myself);

  // Collect all (head, context) pairs where nodeID is referenced
  // We need to store FULL IDs (with author prefix) so they can be queried later
  const referencePaths = knowledgeDBs.reduce((acc, knowledgeDB, author) => {
    return knowledgeDB.relations.reduce((rdx, relations) => {
      // Check if any item's nodeID matches
      if (relations.items.some((item) => item.nodeID === nodeID)) {
        // Convert short IDs to full IDs using the author from this knowledgeDB
        const fullHead = relations.head.includes("_")
          ? relations.head
          : joinID(author, relations.head);
        const fullContext = relations.context.map((ctxId) =>
          ctxId.includes("_") ? ctxId : joinID(author, ctxId)
        );

        // Create unique key for deduplication: head + context (using full IDs)
        const pathKey = `${fullHead}:${fullContext.join(",")}`;
        if (!rdx.some((p) => `${p.head}:${p.context.join(",")}` === pathKey)) {
          return rdx.push({
            head: fullHead as ID,
            context: fullContext,
            updated: relations.updated,
          });
        }
      }
      return rdx;
    }, acc);
  }, List<ReferencedByPath>());

  // Sort by updated time (newest first)
  const sortedPaths = referencePaths.sort((a, b) => b.updated - a.updated);

  return {
    ...rel,
    id: REFERENCED_BY,
    items: sortedPaths.map((path) => ({
      nodeID: createRefId(path.context.push(path.head), nodeID as ID),
      types: List<ID>([""]),
    })),
  };
}

export function getRelations(
  knowledgeDBs: KnowledgeDBs,
  relationID: ID | undefined,
  myself: PublicKey,
  nodeID: LongID | ID // for social lookup
): Relations | undefined {
  if (relationID === REFERENCED_BY) {
    return getReferencedByRelations(knowledgeDBs, myself, nodeID);
  }
  return getRelationsNoReferencedBy(knowledgeDBs, relationID, myself);
}

export function deleteRelations(
  relations: Relations,
  indices: Set<number>
): Relations {
  const items = indices
    .sortBy((index) => -index)
    .reduce((r, deleteIndex) => r.delete(deleteIndex), relations.items);
  return {
    ...relations,
    items,
  };
}

export function isRemote(
  remote: PublicKey | undefined,
  myself: PublicKey
): boolean {
  return remote !== undefined && remote !== myself;
}

export function moveRelations(
  relations: Relations,
  indices: Array<number>,
  startPosition: number
): Relations {
  const itemsToMove = relations.items.filter((_, i) => indices.includes(i));
  const itemsBeforeStartPos = indices.filter((i) => i < startPosition).length;
  const updatedItems = relations.items
    .filterNot((_, i) => indices.includes(i))
    .splice(startPosition - itemsBeforeStartPos, 0, ...itemsToMove.toArray());
  return {
    ...relations,
    items: updatedItems,
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getSharesFromPublicKey(publicKey: PublicKey): number {
  return 10000; // TODO: implement
}

function filterVoteRelationLists(
  relations: List<Relations>,
  head: ID
): List<Relations> {
  return relations.filter((relation) => {
    return shortID(relation.head) === shortID(head);
  });
}

function getLatestvoteRelationListPerAuthor(
  relations: List<Relations>
): Map<PublicKey, Relations> {
  return relations.reduce((acc, relation) => {
    const isFound = acc.get(relation.author);
    if (!!isFound && isFound.updated > relation.updated) {
      return acc;
    }
    return acc.set(relation.author, relation);
  }, Map<PublicKey, Relations>());
}

function fib(n: number): number {
  // fibonacci sequence starting with 1,2,3,5,8,13,21,34,55,89,144,233,377,610,987,1597,...
  if (n <= 1) {
    return n;
  }
  if (n === 2) {
    return 2;
  }
  return fib(n - 1) + fib(n - 2);
}

function fibsum(n: number): number {
  // sum of fibonacci sequence
  // sequence starting with 1,3,6,11,19,32,53,87, 142, 231, 375, 608, 985, 1595,...
  // fibsum(n) = fibsum(n - 1) + fib(n), with induction and the definition of fib() it follows that
  // fibsum(n) = fib(n + 2) - 2
  return fib(n + 2) - 2;
}

export function aggregateWeightedVotes(
  listsOfVotes: List<{ items: List<RelationItem>; weight: number }>,
  filterType: ID
): Map<LongID | ID, number> {
  const votesPerItem = listsOfVotes.reduce((rdx, v) => {
    const { weight } = v;
    // Filter items by type
    const filteredItems = v.items.filter((item) =>
      item.types.includes(filterType)
    );
    const length = filteredItems.size;
    const denominator = fibsum(length);
    if (length === 0) {
      return rdx;
    }
    const updatedVotes = filteredItems.map((item, index) => {
      const numerator = fib(length - index);
      const newVotes = (numerator / denominator) * weight;
      const initialVotes = rdx.get(item.nodeID) || 0;
      return { nodeID: item.nodeID, votes: initialVotes + newVotes };
    });
    return updatedVotes.reduce((red, { nodeID, votes }) => {
      return red.set(nodeID, votes);
    }, rdx);
  }, Map<LongID | ID, number>());
  return votesPerItem;
}

export function aggregateNegativeWeightedVotes(
  listsOfVotes: List<{ items: List<RelationItem>; weight: number }>,
  filterType: ID
): Map<LongID | ID, number> {
  const votesPerItem = listsOfVotes.reduce((rdx, v) => {
    const { weight } = v;
    // Filter items by type
    const filteredItems = v.items.filter((item) =>
      item.types.includes(filterType)
    );
    const length = filteredItems.size;
    if (length === 0) {
      return rdx;
    }
    const updatedVotes = filteredItems.map((item) => {
      // vote negative with half of the weight on each item
      const newVotes = -weight / 2;
      const initialVotes = rdx.get(item.nodeID) || 0;
      return { nodeID: item.nodeID, votes: initialVotes + newVotes };
    });
    return updatedVotes.reduce((red, { nodeID, votes }) => {
      return red.set(nodeID, votes);
    }, rdx);
  }, Map<LongID | ID, number>());
  return votesPerItem;
}

export function countRelationVotes(
  relations: List<Relations>,
  head: ID,
  type: ID
): Map<LongID | ID, number> {
  const filteredVoteRelations = filterVoteRelationLists(relations, head);
  const latestVotesPerAuthor = getLatestvoteRelationListPerAuthor(
    filteredVoteRelations
  );
  const listsOfVotes = latestVotesPerAuthor
    .map((relation) => {
      return {
        items: relation.items,
        weight: getSharesFromPublicKey(relation.author),
      };
    })
    .toList();
  return type === "not_relevant"
    ? aggregateNegativeWeightedVotes(listsOfVotes, type)
    : aggregateWeightedVotes(listsOfVotes, type);
}

export function countRelevanceVoting(
  relations: List<Relations>,
  head: ID
): Map<LongID | ID, number> {
  const positiveVotes = countRelationVotes(relations, head, "");
  const negativeVotes = countRelationVotes(relations, head, "not_relevant");
  return negativeVotes.reduce((rdx, negativeVote, key) => {
    const positiveVote = positiveVotes.get(key, 0);
    return rdx.set(key, positiveVote + negativeVote);
  }, positiveVotes);
}

export function addRelationToRelations(
  relations: Relations,
  objectID: LongID | ID,
  types: List<ID> = List([""]), // Default to "relevant" type
  ord: number | undefined = undefined
): Relations {
  const newItem: RelationItem = {
    nodeID: objectID,
    types,
  };
  const defaultOrder = relations.items.size;
  const items = relations.items.push(newItem);
  const relationsWithItems = {
    ...relations,
    items,
  };
  return ord !== undefined
    ? moveRelations(relationsWithItems, [defaultOrder], ord)
    : relationsWithItems;
}

export function bulkAddRelations(
  relations: Relations,
  objectIDs: Array<LongID | ID>,
  types: List<ID> = List([""]),
  startPos: number | undefined = undefined
): Relations {
  return objectIDs.reduce((rdx, id, currentIndex) => {
    const ord = startPos !== undefined ? startPos + currentIndex : undefined;
    return addRelationToRelations(rdx, id, types, ord);
  }, relations);
}

export function newNode(
  text: string,
  myself: PublicKey,
  imageUrl?: string
): KnowNode {
  return {
    text,
    id: joinID(myself, v4()),
    type: "text",
    imageUrl,
  };
}
