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

export function hasImageUrl(node: KnowNode): node is TextNode | ProjectNode {
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

// Get the navigation stack for a reference ID (context + target as array)
export function getRefTargetStack(
  refId: ID | LongID
): (ID | LongID)[] | undefined {
  const parsed = parseRefId(refId);
  if (!parsed) {
    return undefined;
  }
  return [...parsed.targetContext.toArray(), parsed.targetNode];
}

// Extract the target node's relation info from a ref ID
// For ref:ctx1:ctx2:target -> returns { head: target, context: [ctx1, ctx2] }
// This is used to look up the target node's children in that context
export function getRefTargetRelationInfo(
  refId: ID | LongID
): { head: ID; context: Context } | undefined {
  const parsed = parseRefId(refId);
  if (!parsed) {
    return undefined;
  }
  const { targetNode, targetContext } = parsed;

  return {
    head: targetNode,
    context: targetContext,
  };
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
  pathKey: string;
};

export function getReferencedByRelations(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  nodeID: LongID | ID
): Relations | undefined {
  const rel = newRelations(nodeID, List<ID>(), myself);
  const targetShortID = shortID(nodeID);

  // Collect all (head, context) pairs where nodeID is referenced
  // We use short IDs - getNodeFromID will search across all DBs to find actual nodes
  const referencePaths = knowledgeDBs.reduce((acc, knowledgeDB) => {
    return knowledgeDB.relations.reduce((rdx, relations) => {
      // Case 1: nodeID appears in another node's items
      const isInItems = relations.items.some((item) => item.nodeID === nodeID);

      // Case 2: nodeID is the head of a list with empty context (has direct children)
      const isHeadWithEmptyContext =
        relations.head === targetShortID &&
        relations.context.size === 0 &&
        relations.items.size > 0;

      if (isInItems || isHeadWithEmptyContext) {
        // Use short IDs for the path - getNodeFromID will search across all DBs
        const headShort = shortID(relations.head) as ID;
        const contextShorts = relations.context.map(
          (ctxId) => shortID(ctxId) as ID
        );

        // Deduplicate using short IDs (logical node identity)
        const pathKey = `${headShort}:${contextShorts.join(",")}`;

        const existingPath = rdx.find((p) => p.pathKey === pathKey);
        if (!existingPath) {
          return rdx.push({
            head: headShort as ID,
            context: contextShorts,
            updated: relations.updated,
            pathKey,
          });
        }
        // Update if this version is newer
        if (relations.updated > existingPath.updated) {
          const idx = rdx.indexOf(existingPath);
          return rdx.set(idx, {
            head: headShort as ID,
            context: contextShorts,
            updated: relations.updated,
            pathKey,
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
    items: sortedPaths.map((path) => {
      // If context is empty and head equals the nodeID, this is a list with no context
      // Create ref with empty context so it displays as just the node name
      const isOwnList =
        path.context.size === 0 && shortID(path.head) === targetShortID;
      if (isOwnList) {
        return {
          nodeID: createRefId(List<ID>(), nodeID as ID),
          relevance: "" as Relevance,
        };
      }
      return {
        nodeID: createRefId(path.context.push(path.head), nodeID as ID),
        relevance: "" as Relevance,
      };
    }),
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

export function markItemsAsNotRelevant(
  relations: Relations,
  indices: Set<number>
): Relations {
  const items = relations.items.map((item, index) => {
    if (!indices.has(index)) {
      return item;
    }
    return {
      ...item,
      relevance: "not_relevant" as Relevance,
    };
  });
  return {
    ...relations,
    items,
  };
}

export function updateItemRelevance(
  relations: Relations,
  index: number,
  relevance: Relevance
): Relations {
  const item = relations.items.get(index);
  if (!item) {
    return relations;
  }
  const items = relations.items.set(index, {
    ...item,
    relevance,
  });
  return {
    ...relations,
    items,
  };
}

export function updateItemArgument(
  relations: Relations,
  index: number,
  argument: Argument
): Relations {
  const item = relations.items.get(index);
  if (!item) {
    return relations;
  }
  const items = relations.items.set(index, {
    ...item,
    argument,
  });
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

// Check if an item matches a filter type (relevance or argument)
export function itemMatchesType(
  item: RelationItem,
  filterType: Relevance | Argument
): boolean {
  if (filterType === "confirms" || filterType === "contra") {
    return item.argument === filterType;
  }
  // Default relevance to "" (relevant) if undefined
  const relevance = item.relevance ?? "";
  return relevance === filterType;
}

export function aggregateWeightedVotes(
  listsOfVotes: List<{ items: List<RelationItem>; weight: number }>,
  filterType: Relevance | Argument
): Map<LongID | ID, number> {
  const votesPerItem = listsOfVotes.reduce((rdx, v) => {
    const { weight } = v;
    // Filter items by type
    const filteredItems = v.items.filter((item) =>
      itemMatchesType(item, filterType)
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
  filterType: Relevance | Argument
): Map<LongID | ID, number> {
  const votesPerItem = listsOfVotes.reduce((rdx, v) => {
    const { weight } = v;
    // Filter items by type
    const filteredItems = v.items.filter((item) =>
      itemMatchesType(item, filterType)
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
  type: Relevance | Argument
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
  relevance: Relevance = "",
  argument?: Argument,
  ord?: number
): Relations {
  const newItem: RelationItem = {
    nodeID: objectID,
    relevance,
    argument,
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
  relevance: Relevance = "",
  argument?: Argument,
  startPos?: number
): Relations {
  return objectIDs.reduce((rdx, id, currentIndex) => {
    const ord = startPos !== undefined ? startPos + currentIndex : undefined;
    return addRelationToRelations(rdx, id, relevance, argument, ord);
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
