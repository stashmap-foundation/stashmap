import { List, Set, Map } from "immutable";
import crypto from "crypto";
import { newRelations } from "./ViewContext";
import { SEARCH_PREFIX } from "./constants";

// Content-addressed node ID generation
// Node ID = sha256(text).slice(0, 32) - no author prefix
export function hashText(text: string): ID {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 32);
}

// Pre-computed hash for the ~versions node
export const VERSIONS_NODE_ID = hashText("~versions");

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

const CONCRETE_REF_PREFIX = "cref:";
const SHORT_NODE_ID_RE = /^[a-f0-9]{32}$/;

export function isRefId(id: ID | LongID): boolean {
  return id.startsWith(CONCRETE_REF_PREFIX);
}

export function isConcreteRefId(id: ID | LongID): boolean {
  return id.startsWith(CONCRETE_REF_PREFIX);
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

export function parseConcreteRefId(
  refId: ID | LongID
): { relationID: LongID; targetNode?: ID } | undefined {
  if (!isConcreteRefId(refId)) {
    return undefined;
  }
  const content = refId.slice(CONCRETE_REF_PREFIX.length);
  const colonIndex = content.lastIndexOf(":");
  if (colonIndex === -1) {
    return { relationID: content as LongID };
  }
  const possibleTargetNode = content.slice(colonIndex + 1) as ID;
  if (!SHORT_NODE_ID_RE.test(possibleTargetNode)) {
    return { relationID: content as LongID };
  }
  const relationID = content.slice(0, colonIndex) as LongID;
  return { relationID, targetNode: possibleTargetNode };
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
  if (isSearchId(id) || isConcreteRefId(id)) {
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

  const ownRelation = knowledgeDBs.get(myself)?.relations.get(relationID);
  if (ownRelation) {
    return ownRelation;
  }

  return knowledgeDBs
    .valueSeq()
    .map((db) => db.relations.get(relationID))
    .find((relation) => relation !== undefined);
}

type RefTargetInfo = {
  stack: (ID | LongID)[];
  author: PublicKey;
  rootRelation?: LongID;
  scrollTo?: ID;
};

export function getRefTargetInfo(
  refId: ID | LongID,
  knowledgeDBs: KnowledgeDBs,
  effectiveAuthor: PublicKey
): RefTargetInfo | undefined {
  if (isConcreteRefId(refId)) {
    const parsed = parseConcreteRefId(refId);
    if (!parsed) {
      return undefined;
    }
    const { relationID, targetNode } = parsed;
    const relation = getRelationsNoReferencedBy(
      knowledgeDBs,
      relationID,
      effectiveAuthor
    );
    if (!relation) {
      return undefined;
    }
    const stack = [...relation.context.toArray(), relation.head];
    return {
      stack,
      author: relation.author,
      rootRelation: relationID,
      scrollTo: targetNode,
    };
  }

  return undefined;
}

export type ReferencedByRef = {
  relationID: LongID;
  context: Context;
  updated: number;
  targetNode?: ID;
};

export function deduplicateRefsByContext(
  refs: List<ReferencedByRef>,
  preferAuthor?: PublicKey
): List<ReferencedByRef> {
  const grouped = refs.groupBy((ref) => ref.context.join(":"));
  return grouped
    .map(
      (grp) =>
        grp
          .sortBy((r) => {
            const [author] = splitID(r.relationID);
            const isOther =
              preferAuthor && author !== undefined && author !== preferAuthor
                ? 1
                : 0;
            return [isOther, -r.updated];
          })
          .first()!
    )
    .valueSeq()
    .toList();
}

type RawAppearance = {
  relation: Relations;
  knowledgeDB: KnowledgeData;
  isHead: boolean;
};

function findNodeAppearances(
  knowledgeDBs: KnowledgeDBs,
  nodeID: LongID | ID
): List<RawAppearance> {
  const targetShortID = shortID(nodeID);
  return knowledgeDBs.reduce((acc, knowledgeDB) => {
    return knowledgeDB.relations.reduce((rdx, relation) => {
      if (
        isSearchId(relation.head as ID) ||
        relation.context.some((id) => isSearchId(id as ID))
      ) {
        return rdx;
      }
      const isInItems = relation.items.some(
        (item) => item.nodeID === nodeID && item.relevance !== "not_relevant"
      );
      const isHeadWithChildren =
        relation.head === targetShortID && relation.items.size > 0;
      if (isHeadWithChildren || isInItems) {
        return rdx.push({
          relation,
          knowledgeDB,
          isHead: isHeadWithChildren && !isInItems,
        });
      }
      return rdx;
    }, acc);
  }, List<RawAppearance>());
}

function resolveVersionsParent(
  relation: Relations
): { parentNodeID: ID; parentContext: Context } | undefined {
  const ctx = relation.context;
  if (relation.head === VERSIONS_NODE_ID && ctx.size > 0) {
    return {
      parentNodeID: ctx.last() as ID,
      parentContext: ctx.butLast().toList() as Context,
    };
  }
  if (ctx.last() === VERSIONS_NODE_ID && ctx.size >= 2) {
    return {
      parentNodeID: ctx.get(ctx.size - 2) as ID,
      parentContext: ctx.slice(0, ctx.size - 2).toList() as Context,
    };
  }
  return undefined;
}

function findAncestorRef(
  knowledgeDB: KnowledgeData,
  parentNodeID: ID,
  parentContext: Context,
  author: PublicKey,
  updated: number
): ReferencedByRef | undefined {
  if (parentContext.size > 0) {
    const grandparentHead = parentContext.last() as ID;
    const grandparentContext = parentContext.butLast().toList() as Context;
    const grandparentRelation = knowledgeDB.relations.find(
      (r) =>
        r.head === grandparentHead &&
        r.context.equals(grandparentContext) &&
        r.author === author
    );
    if (grandparentRelation) {
      return {
        relationID: grandparentRelation.id,
        context: parentContext,
        updated,
        targetNode: parentNodeID,
      };
    }
  } else {
    const parentRelation = knowledgeDB.relations.find(
      (r) =>
        r.head === parentNodeID && r.context.size === 0 && r.author === author
    );
    if (parentRelation) {
      return {
        relationID: parentRelation.id,
        context: List<ID>() as Context,
        updated,
      };
    }
  }
  return undefined;
}

function resolveAppearance(
  app: RawAppearance,
  targetShortID: ID
): ReferencedByRef | undefined {
  const { relation, knowledgeDB, isHead } = app;
  if (isHead) {
    return {
      relationID: relation.id,
      context: relation.context,
      updated: relation.updated,
    };
  }
  const versions = resolveVersionsParent(relation);
  if (versions) {
    return findAncestorRef(
      knowledgeDB,
      versions.parentNodeID,
      versions.parentContext,
      relation.author,
      relation.updated
    );
  }
  return {
    relationID: relation.id,
    context: relation.context.push(relation.head as ID),
    updated: relation.updated,
    targetNode: targetShortID,
  };
}

export function findRefsToNode(
  knowledgeDBs: KnowledgeDBs,
  nodeID: LongID | ID,
  filterContext?: Context
): List<ReferencedByRef> {
  const targetShortID = shortID(nodeID);
  const appearances = findNodeAppearances(knowledgeDBs, nodeID);
  const rawRefs = appearances
    .map((app) => resolveAppearance(app, targetShortID))
    .filter((ref): ref is ReferencedByRef => ref !== undefined)
    .toList();

  const allRefs = filterContext
    ? rawRefs.filter((ref) => ref.context.equals(filterContext))
    : rawRefs;

  return allRefs
    .groupBy((ref) => ref.relationID)
    .map((grp) => grp.first()!)
    .valueSeq()
    .toList();
}

function contextKeyForCref(
  knowledgeDBs: KnowledgeDBs,
  crefID: LongID | ID,
  effectiveAuthor: PublicKey
): string | undefined {
  const parsed = parseConcreteRefId(crefID);
  if (!parsed) return undefined;
  const rel = getRelationsNoReferencedBy(
    knowledgeDBs,
    parsed.relationID,
    effectiveAuthor
  );
  if (!rel) return undefined;
  return parsed.targetNode
    ? rel.context.push(rel.head as ID).join(":")
    : rel.context.join(":");
}

function coveredContextKeys(
  knowledgeDBs: KnowledgeDBs,
  crefIDs: List<LongID | ID>,
  effectiveAuthor: PublicKey
): Set<string> {
  return crefIDs.reduce((acc, crefID) => {
    const key = contextKeyForCref(knowledgeDBs, crefID, effectiveAuthor);
    return key !== undefined ? acc.add(key) : acc;
  }, List<string>().toSet());
}

export function getOccurrencesForNode(
  knowledgeDBs: KnowledgeDBs,
  nodeID: LongID | ID,
  currentRelationID: LongID | undefined,
  effectiveAuthor: PublicKey,
  currentContext: Context,
  currentItems?: List<RelationItem>,
  incomingCrefIDs?: List<LongID>
): List<LongID> {
  const allRefs = findRefsToNode(knowledgeDBs, nodeID);
  const contextRoot = currentContext.first();
  const outgoingCrefIDs = currentItems
    ? currentItems
        .map((item) => item.nodeID)
        .filter(isConcreteRefId)
        .toList()
    : List<LongID | ID>();
  const covered = coveredContextKeys(
    knowledgeDBs,
    outgoingCrefIDs.concat(incomingCrefIDs || List<LongID>()),
    effectiveAuthor
  );
  const filtered = allRefs
    .filter((ref) => ref.relationID !== currentRelationID)
    .filter((ref) =>
      ref.targetNode
        ? !contextRoot || ref.context.first() !== contextRoot
        : currentContext.size > 0 && ref.context.size === 0
    )
    .filter((ref) => !covered.has(ref.context.join(":")));
  const deduped = deduplicateRefsByContext(filtered, effectiveAuthor);
  return deduped
    .sortBy((ref) => -ref.updated)
    .map((ref) => createConcreteRefId(ref.relationID, ref.targetNode))
    .toList();
}

export function getIncomingCrefsForNode(
  knowledgeDBs: KnowledgeDBs,
  currentNodeID: LongID | ID,
  parentRelationID: LongID | undefined,
  currentRelationID: LongID | undefined,
  effectiveAuthor: PublicKey,
  currentItems?: List<RelationItem>
): List<LongID> {
  const currentShortNodeID = shortID(currentNodeID);
  const outgoingTargetRelIDs = (currentItems || List<RelationItem>()).reduce(
    (acc, item) => {
      const parsed = parseConcreteRefId(item.nodeID);
      if (!parsed) return acc;
      const withTarget = acc.add(parsed.relationID);
      if (!parsed.targetNode) return withTarget;
      const targetRelation = getRelationsNoReferencedBy(
        knowledgeDBs,
        parsed.relationID,
        effectiveAuthor
      );
      if (!targetRelation) return withTarget;
      const childContext = targetRelation.context.push(
        targetRelation.head as ID
      );
      const childRelation = knowledgeDBs
        .valueSeq()
        .flatMap((db) => db.relations.valueSeq())
        .find(
          (r) => r.head === parsed.targetNode && r.context.equals(childContext)
        );
      return childRelation ? withTarget.add(childRelation.id) : withTarget;
    },
    Set<LongID>()
  );

  const refs = knowledgeDBs.reduce((acc, knowledgeDB) => {
    return knowledgeDB.relations.reduce((rdx, relation) => {
      if (relation.id === parentRelationID) return rdx;
      if (relation.id === currentRelationID) return rdx;
      if (relation.head === LOG_NODE_ID) return rdx;
      if (outgoingTargetRelIDs.has(relation.id)) return rdx;

      const hasCrefToUs = relation.items.some((item) => {
        if (!isConcreteRefId(item.nodeID)) return false;
        if (item.relevance === "not_relevant") return false;
        const parsed = parseConcreteRefId(item.nodeID);
        if (!parsed) return false;
        const matchesItem =
          !!parentRelationID &&
          parsed.targetNode === currentShortNodeID &&
          parsed.relationID === parentRelationID;
        const matchesHead =
          !!currentRelationID &&
          !parsed.targetNode &&
          parsed.relationID === currentRelationID;
        return matchesItem || matchesHead;
      });

      if (!hasCrefToUs) return rdx;

      return rdx.push({
        relationID: relation.id,
        context: relation.context,
        updated: relation.updated,
      });
    }, acc);
  }, List<ReferencedByRef>());

  const deduped = deduplicateRefsByContext(refs, effectiveAuthor);
  return deduped
    .sortBy((ref) => -ref.updated)
    .map((ref) => createConcreteRefId(ref.relationID))
    .toList();
}

export function getSearchRelations(
  searchId: ID,
  foundNodeIDs: List<ID>,
  myself: PublicKey
): Relations {
  const rel = newRelations(searchId, List<ID>(), myself);
  const uniqueNodeIDs = foundNodeIDs.toSet().toList();
  const items = uniqueNodeIDs.map(
    (nodeID): RelationItem => ({
      nodeID,
      relevance: undefined as Relevance,
    })
  );
  return { ...rel, id: searchId as LongID, items };
}

export function getRelations(
  knowledgeDBs: KnowledgeDBs,
  relationID: ID | undefined,
  myself: PublicKey
): Relations | undefined {
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

export function isEmptyNodeID(id: LongID | ID): boolean {
  return id === EMPTY_NODE_ID;
}

export function itemPassesFilters(
  item: RelationItem,
  activeFilters: (
    | Relevance
    | Argument
    | "suggestions"
    | "versions"
    | "incoming"
    | "occurrence"
    | "contains"
  )[]
): boolean {
  if (isEmptyNodeID(item.nodeID)) {
    return true;
  }

  const relevanceFilter =
    item.relevance === undefined ? "contains" : item.relevance;
  if (!activeFilters.includes(relevanceFilter)) {
    return false;
  }

  const hasArgumentFilter =
    activeFilters.includes("confirms") || activeFilters.includes("contra");
  if (hasArgumentFilter) {
    if (!item.argument || !activeFilters.includes(item.argument)) {
      return false;
    }
  }

  return true;
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

export function findUniqueText(
  text: string,
  existingIDs: ID[],
  n: number = 1
): string {
  const candidate = `${text} (${n})`;
  return existingIDs.includes(hashText(candidate))
    ? findUniqueText(text, existingIDs, n + 1)
    : candidate;
}
