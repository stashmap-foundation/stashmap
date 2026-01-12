import { List, Set, Map } from "immutable";
import { v4 } from "uuid";
import { newRelations } from "./ViewContext";
import { REFERENCED_BY } from "./constants";

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

type ReferencedByHeadAndUpdated = Pick<Relations, "head" | "updated">;

export function getReferencedByRelations(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  nodeID: LongID | ID
): Relations | undefined {
  const rel = newRelations(nodeID, List<ID>(), myself);
  const referencesOfAllDBs = knowledgeDBs.reduce((r, knowledgeDB) => {
    const relationsOfDB = knowledgeDB.relations.reduce((rdx, relations) => {
      // Check if any item's nodeID matches
      if (relations.items.some((item) => item.nodeID === nodeID)) {
        if (!rdx.find((item) => item.head === relations.head)) {
          return rdx.push({
            head: relations.head as LongID,
            updated: relations.updated,
          });
        }
      }
      return rdx;
    }, r);
    return r.merge(relationsOfDB);
  }, List<ReferencedByHeadAndUpdated>());
  const items = referencesOfAllDBs
    .filter(
      (relation, index, self) =>
        index === self.findIndex((t) => t.head === relation.head)
    )
    .sort((a, b) => a.updated - b.updated);
  // This is a Tough one:
  //
  // Alice has a node Bitcoin with ID 1 and a List default-1
  // Bob forks default-1 and references "blockchain" (list, id: default-fork-1, head: 1, items: [blockchain])
  // Carol, who is connected with Bob, counts default-fork-1 as a reference, but will never be able to
  // see the node "Bitcoin" because she doesn't query Alice node. The List default-1, doesn't mention how to
  // get ID 1
  //
  // Simpler Case:
  //
  // Alice is not connected with Bob. Alice forks Bobs Bitcoin List default-1 to default-2.
  // Alice References a new node "blockchain" in default-2.
  //
  // Alice will never see the "Bitcoin" node in references as she is not connected to Bob
  //
  // Why don't we make Head a full path?
  return {
    ...rel,
    id: REFERENCED_BY,
    items: items.map((item) => ({
      nodeID: item.head,
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
