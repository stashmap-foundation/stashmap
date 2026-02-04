import { List, Set, Map } from "immutable";
import crypto from "crypto";
import {
  newRelations,
  getNodeFromID,
  getVersionedDisplayText,
  isSuggestion,
} from "./ViewContext";
import { REFERENCED_BY, REF_PREFIX, SEARCH_PREFIX } from "./constants";

// Content-addressed node ID generation
// Node ID = sha256(text).slice(0, 32) - no author prefix
export function hashText(text: string): ID {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 32);
}

// Pre-computed hash for the ~Versions node
export const VERSIONS_NODE_ID = hashText("~Versions");

// Pre-computed hash for the ~Log node (home page, linked to root-level notes)
export const LOG_NODE_ID = hashText("~Log");

// Pre-computed hash for empty node (used as placeholder when creating new nodes)
export const EMPTY_NODE_ID = hashText("") as ID;

// Type guards for KnowNode union type
export function isTextNode(node: KnowNode): node is TextNode {
  return node.type === "text";
}

export function isReferenceNode(node: KnowNode): node is ReferenceNode {
  return node.type === "reference";
}

// Reference ID utilities
// Abstract format: "ref:context0:context1:nodeID" - groups all versions for (context, node)
// Concrete format: "cref:relationID" - specific version/list (relation has context, head, author)
const CONCRETE_REF_PREFIX = "cref:";

export function isRefId(id: ID | LongID): boolean {
  return id.startsWith(REF_PREFIX) || id.startsWith(CONCRETE_REF_PREFIX);
}

export function isAbstractRefId(id: ID | LongID): boolean {
  return id.startsWith(REF_PREFIX);
}

export function isConcreteRefId(id: ID | LongID): boolean {
  return id.startsWith(CONCRETE_REF_PREFIX);
}

export function createAbstractRefId(context: Context, targetNode: ID): LongID {
  const parts = [REF_PREFIX.slice(0, -1), ...context.toArray(), targetNode];
  return parts.join(":") as LongID;
}

export function isSearchId(id: ID): boolean {
  return id.startsWith(SEARCH_PREFIX);
}

export function createSearchId(query: string): ID {
  return `${SEARCH_PREFIX}${query}` as ID;
}

export function parseSearchId(id: ID): string | undefined {
  if (!isSearchId(id)) {
    return undefined;
  }
  return id.slice(SEARCH_PREFIX.length);
}

export function createConcreteRefId(
  relationID: LongID,
  targetNode?: ID
): LongID {
  if (targetNode) {
    return `${CONCRETE_REF_PREFIX}${relationID}:${targetNode}` as LongID;
  }
  return `${CONCRETE_REF_PREFIX}${relationID}` as LongID;
}

export function parseAbstractRefId(
  refId: ID | LongID
): { targetNode: ID; targetContext: Context } | undefined {
  if (!isAbstractRefId(refId)) {
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

export function parseConcreteRefId(
  refId: ID | LongID
): { relationID: LongID; targetNode?: ID } | undefined {
  if (!isConcreteRefId(refId)) {
    return undefined;
  }
  const content = refId.slice(CONCRETE_REF_PREFIX.length);
  const colonIndex = content.indexOf(":");
  if (colonIndex === -1) {
    return { relationID: content as LongID };
  }
  const relationID = content.slice(0, colonIndex) as LongID;
  const targetNode = content.slice(colonIndex + 1) as ID;
  return { relationID, targetNode };
}

export function extractNodeIdsFromRefId(refId: ID | LongID): List<ID> {
  const parsed = parseAbstractRefId(refId);
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
  const parsed = parseAbstractRefId(refId);
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
  const parsed = parseAbstractRefId(refId);
  if (!parsed) {
    return undefined;
  }
  const { targetNode, targetContext } = parsed;

  return {
    head: targetNode,
    context: targetContext,
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
  if (isSearchId(id)) {
    return id;
  }
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
  return knowledgeDBs.get(myself)?.relations.get(relationID);
}

function buildRefDisplayText(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  targetNode: ID,
  targetContext: Context,
  targetOnly?: boolean
): string {
  const getNodeTextWithVersion = (
    nodeId: ID,
    contextUpToNode: List<ID>
  ): string => {
    const versionedText = getVersionedDisplayText(
      knowledgeDBs,
      myself,
      nodeId,
      contextUpToNode
    );
    if (versionedText) {
      return versionedText;
    }
    const node = getNodeFromID(knowledgeDBs, nodeId, myself);
    return node?.text || "Loading...";
  };

  const targetText = getNodeTextWithVersion(targetNode, targetContext);

  if (targetOnly) {
    return targetText;
  }

  const contextTexts = targetContext.reduce((acc, nodeId, index) => {
    const contextUpToHere = targetContext.slice(0, index);
    const text = getNodeTextWithVersion(nodeId, contextUpToHere);
    return acc.push(text);
  }, List<string>());

  return contextTexts.push(targetText).join(" → ");
}

export function buildReferenceNode(
  refId: LongID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  parentRelation?: Relations
): ReferenceNode | undefined {
  if (isConcreteRefId(refId)) {
    const parsed = parseConcreteRefId(refId);
    if (!parsed) return undefined;
    const { relationID, targetNode } = parsed;
    const relation = getRelationsNoReferencedBy(
      knowledgeDBs,
      relationID,
      myself
    );
    if (!relation) return undefined;

    const relationContext = relation.context.map((id) => shortID(id) as ID);
    const itemCount = relation.items.size;
    const showTargetOnly = isSuggestion(refId, parentRelation);

    if (!targetNode) {
      const head = relation.head as ID;
      const baseText = buildRefDisplayText(
        knowledgeDBs,
        myself,
        head,
        relationContext,
        showTargetOnly
      );
      const displayText = showTargetOnly
        ? baseText
        : `${baseText} (${itemCount})`;
      return {
        id: refId,
        type: "reference",
        text: displayText,
        targetNode: head,
        targetContext: relationContext,
      };
    }

    const contextWithHead = relationContext.push(relation.head as ID);
    const headText = buildRefDisplayText(
      knowledgeDBs,
      myself,
      relation.head as ID,
      relationContext
    );
    const targetText = buildRefDisplayText(
      knowledgeDBs,
      myself,
      targetNode,
      contextWithHead,
      true
    );
    const displayText = showTargetOnly
      ? targetText
      : `${headText} (${itemCount}) → ${targetText}`;

    return {
      id: refId,
      type: "reference",
      text: displayText,
      targetNode,
      targetContext: contextWithHead,
    };
  }

  const parsed = parseAbstractRefId(refId);
  if (!parsed) {
    return undefined;
  }
  const { targetNode, targetContext } = parsed;
  const displayText = buildRefDisplayText(
    knowledgeDBs,
    myself,
    targetNode,
    targetContext
  );

  return {
    id: refId,
    type: "reference",
    text: displayText,
    targetNode,
    targetContext,
  };
}

type RefTargetInfo = {
  stack: (ID | LongID)[];
  author: PublicKey;
  rootRelation?: LongID;
};

export function getRefTargetInfo(
  refId: ID | LongID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): RefTargetInfo | undefined {
  if (isConcreteRefId(refId)) {
    const parsed = parseConcreteRefId(refId);
    if (!parsed) return undefined;
    const { relationID, targetNode } = parsed;
    const relation = getRelationsNoReferencedBy(
      knowledgeDBs,
      relationID,
      myself
    );
    if (!relation) return undefined;
    const stack = targetNode
      ? [...relation.context.toArray(), relation.head, targetNode]
      : [...relation.context.toArray(), relation.head];
    // Only lock to rootRelation when opening the relation head directly.
    // When targetNode exists, we're navigating TO that node - use its own relations for children.
    return {
      stack,
      author: relation.author,
      rootRelation: targetNode ? undefined : relationID,
    };
  }

  const parsed = parseAbstractRefId(refId);
  if (!parsed) return undefined;
  return {
    stack: [...parsed.targetContext.toArray(), parsed.targetNode],
    author: myself,
  };
}

type ReferencedByRef = {
  relationID: LongID;
  context: Context;
  updated: number;
  isInItems: boolean;
};

export function getConcreteRefs(
  knowledgeDBs: KnowledgeDBs,
  nodeID: LongID | ID,
  filterContext?: Context
): List<ReferencedByRef> {
  const targetShortID = shortID(nodeID);
  const rawRefs = knowledgeDBs.reduce((acc, knowledgeDB) => {
    return knowledgeDB.relations.reduce((rdx, relation) => {
      // Skip search relations - they're virtual and shouldn't be shown as refs
      if (
        isSearchId(relation.head as ID) ||
        relation.context.some((id) => isSearchId(id as ID))
      ) {
        return rdx;
      }
      const relationContext = relation.context;
      const isInItems = relation.items.some((item) => item.nodeID === nodeID);
      const isHeadWithChildren =
        relation.head === targetShortID && relation.items.size > 0;

      if (isHeadWithChildren) {
        return rdx.push({
          relationID: relation.id,
          context: relationContext,
          updated: relation.updated,
          isInItems: false,
        });
      }
      if (isInItems) {
        // HEAD case: relation.head = ~Versions, target in items
        // context = [Holiday Destinations, BCN], head = ~Versions
        // Need: context = [Holiday Destinations], head = BCN (as HEAD ref)
        if (relation.head === VERSIONS_NODE_ID && relationContext.size > 0) {
          const parentNodeID = relationContext.last() as ID;
          const parentContext = relationContext.butLast().toList() as Context;
          const parentRelation = knowledgeDB.relations.find(
            (r) =>
              r.head === parentNodeID &&
              r.context.equals(parentContext) &&
              r.author === relation.author
          );
          if (parentRelation) {
            return rdx.push({
              relationID: parentRelation.id,
              context: parentContext,
              updated: relation.updated,
              isInItems: false,
            });
          }
          return rdx;
        }
        // IN case: ~Versions is last in context
        // context = [Holiday Destinations, BCN, ~Versions], head = Barcelona
        // Need: context = [Holiday Destinations], head = BCN (as HEAD ref)
        if (
          relationContext.last() === VERSIONS_NODE_ID &&
          relationContext.size >= 2
        ) {
          const parentNodeID = relationContext.get(
            relationContext.size - 2
          ) as ID;
          const parentContext = relationContext
            .slice(0, relationContext.size - 2)
            .toList() as Context;
          const parentRelation = knowledgeDB.relations.find(
            (r) =>
              r.head === parentNodeID &&
              r.context.equals(parentContext) &&
              r.author === relation.author
          );
          if (parentRelation) {
            return rdx.push({
              relationID: parentRelation.id,
              context: parentContext,
              updated: relation.updated,
              isInItems: false,
            });
          }
          return rdx;
        }
        return rdx.push({
          relationID: relation.id,
          context: relationContext.push(relation.head as ID),
          updated: relation.updated,
          isInItems: true,
        });
      }
      return rdx;
    }, acc);
  }, List<ReferencedByRef>());

  const allRefs = filterContext
    ? rawRefs.filter((ref) => ref.context.equals(filterContext))
    : rawRefs;

  // Dedupe by relationID (same relation can be reached via multiple paths, e.g. direct + via ~Versions)
  const dedupedByRelationID = allRefs
    .groupBy((ref) => ref.relationID)
    .map((grp) => grp.first()!)
    .valueSeq()
    .toList();

  // Filter out IN refs when HEAD refs exist for the same context
  const grouped = dedupedByRelationID.groupBy((ref) => ref.context.join(":"));
  return grouped
    .map((grp) => {
      const hasHead = grp.some((r) => !r.isInItems);
      return hasHead ? grp.filter((r) => !r.isInItems).toList() : grp.toList();
    })
    .valueSeq()
    .flatMap((grp): List<ReferencedByRef> => grp)
    .toList();
}

export function groupConcreteRefs(
  refs: List<ReferencedByRef>,
  targetShortID: ID
): List<{ nodeID: LongID; relevance: Relevance }> {
  const grouped = refs.groupBy((ref) => ref.context.join(":"));

  return grouped
    .map((grp) => grp.sortBy((r) => -r.updated).toList())
    .valueSeq()
    .flatMap((grp) => {
      if (grp.size === 1) {
        const ref = grp.first()!;
        return List([
          {
            nodeID: ref.isInItems
              ? createConcreteRefId(ref.relationID, targetShortID)
              : createConcreteRefId(ref.relationID),
            relevance: undefined as Relevance,
          },
        ]);
      }
      const abstractId = createAbstractRefId(
        grp.first()!.context,
        targetShortID
      );
      return List([{ nodeID: abstractId, relevance: undefined as Relevance }]);
    })
    .toList();
}

export function getReferencedByRelations(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  nodeID: LongID | ID
): Relations | undefined {
  const rel = newRelations(nodeID, List<ID>(), myself);
  const targetShortID = shortID(nodeID) as ID;
  const allRefs = getConcreteRefs(knowledgeDBs, nodeID);
  const items = groupConcreteRefs(allRefs, targetShortID);

  return {
    ...rel,
    id: REFERENCED_BY,
    items,
  };
}

export function getConcreteRefsForAbstract(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  abstractRefId: LongID
): Relations | undefined {
  const parsed = parseAbstractRefId(abstractRefId);
  if (!parsed) return undefined;
  const { targetNode, targetContext } = parsed;

  const rel = newRelations(targetNode, List<ID>(), myself);
  const allRefs = getConcreteRefs(knowledgeDBs, targetNode, targetContext);

  const items = allRefs
    .sortBy((r) => -r.updated)
    .map((ref) => ({
      nodeID: ref.isInItems
        ? createConcreteRefId(ref.relationID, targetNode)
        : createConcreteRefId(ref.relationID),
      relevance: undefined as Relevance,
    }))
    .toList();

  return { ...rel, id: abstractRefId, items };
}

export function getSearchRelations(
  searchId: ID,
  foundNodeIDs: List<ID>,
  myself: PublicKey
): Relations {
  const rel = newRelations(searchId, List<ID>(), myself);
  const uniqueNodeIDs = foundNodeIDs.toSet().toList();
  const items = uniqueNodeIDs.map((nodeID) => ({
    nodeID: nodeID as LongID,
    relevance: undefined as Relevance,
  }));
  return { ...rel, id: searchId as LongID, items };
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
  if (relationID && isAbstractRefId(relationID)) {
    return getConcreteRefsForAbstract(
      knowledgeDBs,
      myself,
      relationID as LongID
    );
  }
  if (relationID && isConcreteRefId(relationID)) {
    const parsed = parseConcreteRefId(relationID);
    if (parsed) {
      return getRelationsNoReferencedBy(
        knowledgeDBs,
        parsed.relationID,
        myself
      );
    }
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

// Check if an item matches a filter type (relevance, argument, or contains)
export function itemMatchesType(
  item: RelationItem,
  filterType: Relevance | Argument | "contains"
): boolean {
  if (filterType === "confirms" || filterType === "contra") {
    return item.argument === filterType;
  }
  if (filterType === "contains") {
    return item.relevance === undefined && item.argument === undefined;
  }
  return item.relevance === filterType;
}

export function aggregateWeightedVotes(
  listsOfVotes: List<{ items: List<RelationItem>; weight: number }>,
  filterType: Relevance | Argument | "contains"
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
  filterType: Relevance | Argument | "contains"
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
  type: Relevance | Argument | "contains"
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
  const positiveVotes = countRelationVotes(relations, head, "contains");
  const negativeVotes = countRelationVotes(relations, head, "not_relevant");
  return negativeVotes.reduce((rdx, negativeVote, key) => {
    const positiveVote = positiveVotes.get(key, 0);
    return rdx.set(key, positiveVote + negativeVote);
  }, positiveVotes);
}

export function addRelationToRelations(
  relations: Relations,
  objectID: LongID | ID,
  relevance?: Relevance,
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
  relevance?: Relevance,
  argument?: Argument,
  startPos?: number
): Relations {
  return objectIDs.reduce((rdx, id, currentIndex) => {
    const ord = startPos !== undefined ? startPos + currentIndex : undefined;
    return addRelationToRelations(rdx, id, relevance, argument, ord);
  }, relations);
}

export function newNode(text: string): KnowNode {
  return {
    text,
    id: hashText(text), // Content-addressed: ID = hash(text)
    type: "text",
  };
}

// Check if a node ID is the empty placeholder node
export function isEmptyNodeID(id: LongID | ID): boolean {
  return id === EMPTY_NODE_ID;
}

export type EmptyNodeData = {
  index: number;
  relationItem: RelationItem;
  paneIndex: number;
};

// Compute current empty node data from temporary events
// Events are processed in order: ADD sets data, REMOVE clears it
export function computeEmptyNodeMetadata(
  temporaryEvents: List<TemporaryEvent>
): Map<LongID, EmptyNodeData> {
  return temporaryEvents.reduce((metadata, event) => {
    if (event.type === "ADD_EMPTY_NODE") {
      return metadata.set(event.relationsID, {
        index: event.index,
        relationItem: event.relationItem,
        paneIndex: event.paneIndex,
      });
    }
    if (event.type === "REMOVE_EMPTY_NODE") {
      return metadata.delete(event.relationsID);
    }
    return metadata;
  }, Map<LongID, EmptyNodeData>());
}

// Convenience function for when only positions are needed
export function computeEmptyNodePositions(
  temporaryEvents: List<TemporaryEvent>
): Map<LongID, number> {
  return computeEmptyNodeMetadata(temporaryEvents).map((data) => data.index);
}

// Inject empty nodes back into relations based on temporaryEvents
// This is called after processEvents to add empty placeholder nodes
export function injectEmptyNodesIntoKnowledgeDBs(
  knowledgeDBs: KnowledgeDBs,
  temporaryEvents: List<TemporaryEvent>,
  myself: PublicKey
): KnowledgeDBs {
  // Compute current metadata from event stream
  const emptyNodeMetadata = computeEmptyNodeMetadata(temporaryEvents);

  if (emptyNodeMetadata.size === 0) {
    return knowledgeDBs;
  }

  const myDB = knowledgeDBs.get(myself);
  if (!myDB) {
    return knowledgeDBs;
  }

  // For each empty node, insert into the corresponding relations with its metadata
  const updatedRelations = emptyNodeMetadata.reduce(
    (relations, data, relationsID) => {
      const shortRelationsID = splitID(relationsID)[1];
      const existingRelations = relations.get(shortRelationsID);
      if (!existingRelations) {
        return relations;
      }

      // Check if empty node is already injected (from parent MergeKnowledgeDB)
      const alreadyHasEmpty = existingRelations.items.some(
        (item) => item.nodeID === EMPTY_NODE_ID
      );
      if (alreadyHasEmpty) {
        return relations;
      }

      // Insert empty node at the specified index with its metadata (relevance, argument)
      const updatedItems = existingRelations.items.insert(
        data.index,
        data.relationItem
      );
      return relations.set(shortRelationsID, {
        ...existingRelations,
        items: updatedItems,
      });
    },
    myDB.relations
  );

  // Also add the empty node to the nodes map so useNode() can find it
  const emptyNode = newNode("");
  const updatedNodes = myDB.nodes.set(shortID(EMPTY_NODE_ID), emptyNode);

  return knowledgeDBs.set(myself, {
    ...myDB,
    nodes: updatedNodes,
    relations: updatedRelations,
  });
}
