/* eslint-disable @typescript-eslint/no-use-before-define, functional/immutable-data, functional/no-let */
import { List, Set, Map } from "immutable";
import { newRelations } from "./relationFactory";
import { SEARCH_PREFIX } from "./constants";
import { getRootAnchorContext, rootAnchorsEqual } from "./rootAnchor";

// Empty text remains the sentinel for an empty placeholder row
export const EMPTY_SEMANTIC_ID = "" as ID;

export type TextSeed = {
  id: ID;
  text: string;
};

const CONCRETE_REF_PREFIX = "cref:";

function createInlineNode(
  parent: GraphNode,
  id: ID,
  relevance?: Relevance,
  argument?: Argument
): GraphNode {
  return {
    children: List<GraphNode>(),
    id,
    text: "",
    parent: parent.id as LongID,
    updated: parent.updated,
    author: parent.author,
    root: parent.root,
    relevance,
    argument,
  };
}

function createInlineRefNode(
  parent: GraphNode,
  targetID: LongID,
  relevance?: Relevance,
  argument?: Argument,
  linkText?: string
): GraphNode {
  return {
    ...createInlineNode(
      parent,
      createConcreteRefId(targetID),
      relevance,
      argument
    ),
    isRef: true,
    isCref: true,
    targetID,
    linkText,
  };
}

function findNodeInTree(node: GraphNode, id: ID): GraphNode | undefined {
  if (node.id === id) {
    return node;
  }
  return node.children
    .toArray()
    .reduce<GraphNode | undefined>(
      (found, child) => found || findNodeInTree(child, id),
      undefined
    );
}

function findEmbeddedNodeById(
  knowledgeDBs: KnowledgeDBs,
  id: ID
): GraphNode | undefined {
  return knowledgeDBs
    .valueSeq()
    .toArray()
    .reduce<GraphNode | undefined>(
      (foundInDbs, db) =>
        foundInDbs ||
        db.nodes
          .valueSeq()
          .toArray()
          .reduce<GraphNode | undefined>(
            (foundInNodes, relation) =>
              foundInNodes || findNodeInTree(relation, id),
            undefined
          ),
      undefined
    );
}

export function isRefNode(
  node: GraphNode | undefined
): node is GraphNode & { targetID: LongID } {
  return !!node && (node.isRef === true || node.targetID !== undefined);
}

export function getRefTargetID(
  node: GraphNode | undefined
): LongID | undefined {
  if (!node) {
    return undefined;
  }
  if (node.targetID) {
    return node.targetID;
  }
  if (isConcreteRefId(node.id)) {
    return parseConcreteRefId(node.id)?.relationID;
  }
  return undefined;
}

export function createSemanticID(text: string, id?: ID): ID {
  return (id ?? text) as ID;
}

export function semanticIDFromSeed(seed: string): ID {
  return seed as ID;
}

export function isRefId(id: ID): boolean {
  return id.startsWith(CONCRETE_REF_PREFIX);
}

export function isConcreteRefId(id: ID): boolean {
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

export function createConcreteRefId(relationID: LongID): LongID {
  return `${CONCRETE_REF_PREFIX}${relationID}` as LongID;
}

export function parseConcreteRefId(
  refId: ID
): { relationID: LongID } | undefined {
  if (!isConcreteRefId(refId)) {
    return undefined;
  }
  return { relationID: refId.slice(CONCRETE_REF_PREFIX.length) as LongID };
}

export function getConcreteRefTargetRelation(
  knowledgeDBs: KnowledgeDBs,
  refId: ID,
  myself: PublicKey
): GraphNode | undefined {
  const parsed = parseConcreteRefId(refId);
  if (parsed) {
    return getRelationsNoReferencedBy(knowledgeDBs, parsed.relationID, myself);
  }
  const refNode = findEmbeddedNodeById(knowledgeDBs, refId);
  const targetID = getRefTargetID(refNode);
  return targetID
    ? getRelationsNoReferencedBy(knowledgeDBs, targetID, myself)
    : undefined;
}

export function splitID(id: ID): [PublicKey | undefined, string] {
  if (!id) {
    return [undefined, ""];
  }
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
  if (!id) {
    return "";
  }
  if (isSearchId(id) || isConcreteRefId(id)) {
    return id;
  }
  return splitID(id)[1];
}

function getFallbackRelationText(head?: ID): string {
  if (!head) {
    return "";
  }
  const localHead = head as ID;
  if (localHead === EMPTY_SEMANTIC_ID) {
    return "";
  }
  if (isSearchId(localHead)) {
    return parseSearchId(localHead) || "";
  }
  return localHead;
}

export function getRelationText(
  relation: GraphNode | undefined
): string | undefined {
  if (!relation) {
    return undefined;
  }
  const fallback = getFallbackRelationText(getRelationSemanticID(relation));
  if (relation.text !== "") {
    return relation.text;
  }
  return fallback || undefined;
}

type RelationLookupIndex = globalThis.Map<string, GraphNode[]>;

const relationLookupIndexCache = new WeakMap<
  KnowledgeData,
  RelationLookupIndex
>();
const relationContextCache = new WeakMap<
  KnowledgeData,
  globalThis.Map<string, Context>
>();

function getRelationLookupIndex(db: KnowledgeData): RelationLookupIndex {
  const cached = relationLookupIndexCache.get(db);
  if (cached) {
    return cached;
  }

  const index = new globalThis.Map<string, GraphNode[]>();
  const addToIndex = (key: string, relation: GraphNode): void => {
    const existing = index.get(key);
    if (existing) {
      existing.push(relation);
      return;
    }
    index.set(key, [relation]);
  };

  db.nodes.valueSeq().forEach((relation) => {
    const relationSemanticID = getRelationSemanticID(relation);
    addToIndex(relationSemanticID, relation);
  });

  index.forEach((nodes) => {
    nodes.sort((left, right) => right.updated - left.updated);
  });

  relationLookupIndexCache.set(db, index);
  return index;
}

function getRelationContextIndex(
  db: KnowledgeData
): globalThis.Map<string, Context> {
  const cached = relationContextCache.get(db);
  if (cached) {
    return cached;
  }
  const index = new globalThis.Map<string, Context>();
  relationContextCache.set(db, index);
  return index;
}

export function getIndexedRelationsForKeys(
  db: KnowledgeData,
  keys: string[]
): GraphNode[] {
  const uniqueKeys = Array.from(new globalThis.Set(keys));
  const seen = new globalThis.Set<string>();
  return uniqueKeys.flatMap((key) =>
    (getRelationLookupIndex(db).get(key) || []).filter((relation) => {
      const relationKey = shortID(relation.id);
      if (seen.has(relationKey)) {
        return false;
      }
      seen.add(relationKey);
      return true;
    })
  );
}

export function getRelationSemanticID(relation: GraphNode): ID {
  const relationID = shortID(relation.id) as ID;
  if (isSearchId(relationID)) {
    return relationID;
  }
  return relation.text as ID;
}

export function getRelationContext(
  knowledgeDBs: KnowledgeDBs,
  relation: GraphNode
): Context {
  const db = knowledgeDBs.get(relation.author);
  const relationKey = shortID(relation.id);
  if (db) {
    const cached = getRelationContextIndex(db).get(relationKey);
    if (cached) {
      return cached;
    }
  }

  const fallbackContext = getRootAnchorContext(relation);
  if (!relation.parent) {
    if (db) {
      getRelationContextIndex(db).set(relationKey, fallbackContext);
    }
    return fallbackContext;
  }

  const visited = new globalThis.Set<string>([relationKey]);
  const parentChain: GraphNode[] = [];
  let currentParentID: LongID | undefined = relation.parent;

  while (currentParentID) {
    const parentKey = shortID(currentParentID);
    if (visited.has(parentKey)) {
      if (db) {
        getRelationContextIndex(db).set(relationKey, fallbackContext);
      }
      return fallbackContext;
    }
    visited.add(parentKey);

    const parentRelation = getRelationsNoReferencedBy(
      knowledgeDBs,
      currentParentID,
      relation.author
    );
    if (!parentRelation) {
      if (db) {
        getRelationContextIndex(db).set(relationKey, fallbackContext);
      }
      return fallbackContext;
    }
    parentChain.unshift(parentRelation);
    currentParentID = parentRelation.parent;
  }

  const derivedContext = parentChain.reduce(
    (context, parentRelation) =>
      context.push(getRelationSemanticID(parentRelation)),
    parentChain.length > 0
      ? getRelationContext(knowledgeDBs, parentChain[0] as GraphNode)
      : List<ID>()
  );
  if (db) {
    getRelationContextIndex(db).set(relationKey, derivedContext);
  }
  return derivedContext;
}

export function getRelationStack(
  knowledgeDBs: KnowledgeDBs,
  relation: GraphNode
): ID[] {
  return [
    ...getRelationContext(knowledgeDBs, relation).toArray(),
    getRelationSemanticID(relation),
  ];
}

export function getRelationDepth(
  knowledgeDBs: KnowledgeDBs,
  relation: GraphNode
): number {
  return getRelationContext(knowledgeDBs, relation).size;
}

export function createTextNodeFromRelation(relation: GraphNode): TextSeed {
  return {
    id: getRelationSemanticID(relation),
    text: getRelationText(relation) || "",
  };
}

export function buildTextNodesFromRelations(
  nodes: Iterable<GraphNode>
): Map<string, TextSeed> {
  const relationList = Array.from(nodes);
  const knowledgeDBs = relationList.reduce((acc, relation) => {
    const authorDB = acc.get(relation.author, {
      nodes: Map<string, GraphNode>(),
    });
    return acc.set(relation.author, {
      nodes: authorDB.nodes.set(shortID(relation.id), relation),
    });
  }, Map<PublicKey, KnowledgeData>());

  const latestByHead = relationList.reduce((acc, relation) => {
    const semanticID = getRelationSemanticID(relation);
    const existing = acc.get(semanticID);
    const isNewer = !existing || relation.updated > existing.updated;
    const isSameVersionNewerDisplay =
      !!existing &&
      relation.updated === existing.updated &&
      getRelationDepth(knowledgeDBs, relation) <
        getRelationDepth(knowledgeDBs, existing);
    if (isNewer || isSameVersionNewerDisplay) {
      return acc.set(semanticID, relation);
    }
    return acc;
  }, Map<ID, GraphNode>());

  return latestByHead.map((relation) =>
    createTextNodeFromRelation(relation)
  ) as Map<string, TextSeed>;
}

export function getRelationsNoReferencedBy(
  knowledgeDBs: KnowledgeDBs,
  relationID: ID | undefined,
  myself: PublicKey
): GraphNode | undefined {
  if (!relationID) {
    return undefined;
  }
  const [remote, id] = splitID(relationID);
  if (remote) {
    return (
      knowledgeDBs.get(remote)?.nodes.get(id) ||
      findEmbeddedNodeById(knowledgeDBs, relationID)
    );
  }

  const ownRelation = knowledgeDBs.get(myself)?.nodes.get(relationID);
  if (ownRelation) {
    return ownRelation;
  }

  return (
    knowledgeDBs
      .valueSeq()
      .map((db) => db.nodes.get(relationID))
      .find((relation) => relation !== undefined) ||
    findEmbeddedNodeById(knowledgeDBs, relationID)
  );
}

export function getRelationItemRelation(
  knowledgeDBs: KnowledgeDBs,
  item: GraphNode,
  myself: PublicKey
): GraphNode | undefined {
  const targetID = getRefTargetID(item);
  if (targetID) {
    return getRelationsNoReferencedBy(knowledgeDBs, targetID, myself);
  }
  return getRelationsNoReferencedBy(knowledgeDBs, item.id, myself);
}

export function getRelationItemSemanticID(
  knowledgeDBs: KnowledgeDBs,
  item: GraphNode,
  myself: PublicKey
): ID {
  const relation = getRelationItemRelation(knowledgeDBs, item, myself);
  return relation ? getRelationSemanticID(relation) : item.id;
}

type RefTargetInfo = {
  stack: ID[];
  author: PublicKey;
  rootRelation?: LongID;
  scrollToId?: string;
};

export function getRelationRouteTargetInfo(
  relationID: LongID,
  knowledgeDBs: KnowledgeDBs,
  effectiveAuthor: PublicKey
): RefTargetInfo | undefined {
  const relation = getRelationsNoReferencedBy(
    knowledgeDBs,
    relationID,
    effectiveAuthor
  );
  if (!relation) {
    return undefined;
  }
  return {
    stack: getRelationStack(knowledgeDBs, relation),
    author: relation.author,
    rootRelation: relation.id,
  };
}

export function getRefTargetInfo(
  refId: ID,
  knowledgeDBs: KnowledgeDBs,
  effectiveAuthor: PublicKey
): RefTargetInfo | undefined {
  const relation = getConcreteRefTargetRelation(
    knowledgeDBs,
    refId,
    effectiveAuthor
  );
  if (!relation) {
    return undefined;
  }

  const stack = getRelationStack(knowledgeDBs, relation);
  return {
    stack,
    author: relation.author,
    rootRelation: relation.id,
  };
}

export function getRefLinkTargetInfo(
  refId: ID,
  knowledgeDBs: KnowledgeDBs,
  effectiveAuthor: PublicKey
): RefTargetInfo | undefined {
  const relation = getConcreteRefTargetRelation(
    knowledgeDBs,
    refId,
    effectiveAuthor
  );
  if (!relation) {
    return undefined;
  }

  const containingParent = knowledgeDBs
    .get(relation.author)
    ?.nodes.valueSeq()
    .find((candidate) =>
      candidate.children.some((child) => child.id === relation.id)
    );
  const parentRelation =
    (relation.parent
      ? getRelationsNoReferencedBy(
          knowledgeDBs,
          relation.parent,
          relation.author
        )
      : undefined) || containingParent;
  const targetRoot = parentRelation || relation;

  return {
    stack: getRelationStack(knowledgeDBs, targetRoot),
    author: targetRoot.author,
    rootRelation: targetRoot.id,
    scrollToId: targetRoot.id === relation.id ? undefined : relation.id,
  };
}

export function ensureRelationNativeFields(
  knowledgeDBs: KnowledgeDBs,
  relation: GraphNode
): GraphNode {
  const existingRelation = knowledgeDBs
    .get(relation.author)
    ?.nodes.get(shortID(relation.id));
  const text =
    relation.text || existingRelation?.text || getFallbackRelationText();
  const parent = relation.parent || existingRelation?.parent;
  const anchor = parent
    ? undefined
    : relation.anchor ?? existingRelation?.anchor;

  if (
    relation.text === text &&
    relation.parent === parent &&
    rootAnchorsEqual(relation.anchor, anchor)
  ) {
    return relation;
  }

  return {
    ...relation,
    text,
    parent,
    anchor,
  };
}

export function getSearchRelations(
  searchId: ID,
  foundNodeIDs: List<ID>,
  myself: PublicKey
): GraphNode {
  const rel = newRelations("", List<ID>(), myself);
  const uniqueNodeIDs = foundNodeIDs.toSet().toList();
  const children = uniqueNodeIDs.map(
    (semanticID): GraphNode => ({
      children: List<GraphNode>(),
      id: semanticID,
      text: "",
      parent: rel.id as LongID,
      updated: rel.updated,
      author: rel.author,
      root: rel.root,
      relevance: undefined,
      virtualType: "search",
    })
  );
  return { ...rel, id: searchId as LongID, children };
}

export function getRelations(
  knowledgeDBs: KnowledgeDBs,
  relationID: ID | undefined,
  myself: PublicKey
): GraphNode | undefined {
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
  nodes: GraphNode,
  indices: Set<number>
): GraphNode {
  const children = indices
    .sortBy((index) => -index)
    .reduce((r, deleteIndex) => r.delete(deleteIndex), nodes.children);
  return {
    ...nodes,
    children,
  };
}

export function markItemsAsNotRelevant(
  nodes: GraphNode,
  indices: Set<number>
): GraphNode {
  const children = nodes.children.map((item, index) => {
    if (!indices.has(index)) {
      return item;
    }
    return {
      ...item,
      relevance: "not_relevant" as Relevance,
    };
  });
  return {
    ...nodes,
    children,
  };
}

export function updateItemRelevance(
  nodes: GraphNode,
  index: number,
  relevance: Relevance
): GraphNode {
  const item = nodes.children.get(index);
  if (!item) {
    return nodes;
  }
  const children = nodes.children.set(index, {
    ...item,
    relevance,
  });
  return {
    ...nodes,
    children,
  };
}

export function updateItemArgument(
  nodes: GraphNode,
  index: number,
  argument: Argument
): GraphNode {
  const item = nodes.children.get(index);
  if (!item) {
    return nodes;
  }
  const children = nodes.children.set(index, {
    ...item,
    argument,
  });
  return {
    ...nodes,
    children,
  };
}

export function isRemote(
  remote: PublicKey | undefined,
  myself: PublicKey
): boolean {
  return remote !== undefined && remote !== myself;
}

export function moveRelations(
  nodes: GraphNode,
  indices: Array<number>,
  startPosition: number
): GraphNode {
  const itemsToMove = nodes.children.filter((_, i) => indices.includes(i));
  const itemsBeforeStartPos = indices.filter((i) => i < startPosition).length;
  const updatedItems = nodes.children
    .filterNot((_, i) => indices.includes(i))
    .splice(startPosition - itemsBeforeStartPos, 0, ...itemsToMove.toArray());
  return {
    ...nodes,
    children: updatedItems,
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getSharesFromPublicKey(publicKey: PublicKey): number {
  return 10000; // TODO: implement
}

function filterVoteRelationLists(
  nodes: List<GraphNode>,
  head: ID
): List<GraphNode> {
  return nodes.filter((relation) => {
    return shortID(getRelationSemanticID(relation)) === shortID(head);
  });
}

function getLatestvoteRelationListPerAuthor(
  nodes: List<GraphNode>
): Map<PublicKey, GraphNode> {
  return nodes.reduce((acc, relation) => {
    const isFound = acc.get(relation.author);
    if (!!isFound && isFound.updated > relation.updated) {
      return acc;
    }
    return acc.set(relation.author, relation);
  }, Map<PublicKey, GraphNode>());
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
  item: GraphNode,
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

export function isEmptySemanticID(semanticID: ID): boolean {
  return semanticID === EMPTY_SEMANTIC_ID;
}

export function itemPassesFilters(
  item: GraphNode,
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
  if (isEmptySemanticID(item.id)) {
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
  listsOfVotes: List<{ children: List<GraphNode>; weight: number }>,
  filterType: Relevance | Argument | "contains"
): Map<ID, number> {
  const votesPerItem = listsOfVotes.reduce((rdx, v) => {
    const { weight } = v;
    // Filter children by type
    const filteredItems = v.children.filter((item) =>
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
      const initialVotes = rdx.get(item.id) || 0;
      return { id: item.id, votes: initialVotes + newVotes };
    });
    return updatedVotes.reduce((red, { id, votes }) => {
      return red.set(id, votes);
    }, rdx);
  }, Map<ID, number>());
  return votesPerItem;
}

export function aggregateNegativeWeightedVotes(
  listsOfVotes: List<{ children: List<GraphNode>; weight: number }>,
  filterType: Relevance | Argument | "contains"
): Map<ID, number> {
  const votesPerItem = listsOfVotes.reduce((rdx, v) => {
    const { weight } = v;
    // Filter children by type
    const filteredItems = v.children.filter((item) =>
      itemMatchesType(item, filterType)
    );
    const length = filteredItems.size;
    if (length === 0) {
      return rdx;
    }
    const updatedVotes = filteredItems.map((item) => {
      // vote negative with half of the weight on each item
      const newVotes = -weight / 2;
      const initialVotes = rdx.get(item.id) || 0;
      return { id: item.id, votes: initialVotes + newVotes };
    });
    return updatedVotes.reduce((red, { id, votes }) => {
      return red.set(id, votes);
    }, rdx);
  }, Map<ID, number>());
  return votesPerItem;
}

export function countRelationVotes(
  nodes: List<GraphNode>,
  head: ID,
  type: Relevance | Argument | "contains"
): Map<ID, number> {
  const filteredVoteRelations = filterVoteRelationLists(nodes, head);
  const latestVotesPerAuthor = getLatestvoteRelationListPerAuthor(
    filteredVoteRelations
  );
  const listsOfVotes = latestVotesPerAuthor
    .map((relation) => {
      return {
        children: relation.children,
        weight: getSharesFromPublicKey(relation.author),
      };
    })
    .toList();
  return type === "not_relevant"
    ? aggregateNegativeWeightedVotes(listsOfVotes, type)
    : aggregateWeightedVotes(listsOfVotes, type);
}

export function countRelevanceVoting(
  nodes: List<GraphNode>,
  head: ID
): Map<ID, number> {
  const positiveVotes = countRelationVotes(nodes, head, "contains");
  const negativeVotes = countRelationVotes(nodes, head, "not_relevant");
  return negativeVotes.reduce((rdx, negativeVote, key) => {
    const positiveVote = positiveVotes.get(key, 0);
    return rdx.set(key, positiveVote + negativeVote);
  }, positiveVotes);
}

export function addRelationToRelations(
  nodes: GraphNode,
  objectID: ID,
  relevance?: Relevance,
  argument?: Argument,
  ord?: number
): GraphNode {
  const newItem = isConcreteRefId(objectID)
    ? createInlineRefNode(
        nodes,
        parseConcreteRefId(objectID)?.relationID ?? (objectID as LongID),
        relevance,
        argument
      )
    : createInlineNode(nodes, objectID, relevance, argument);
  const defaultOrder = nodes.children.size;
  const children = nodes.children.push(newItem);
  const relationsWithItems = {
    ...nodes,
    children,
  };
  return ord !== undefined
    ? moveRelations(relationsWithItems, [defaultOrder], ord)
    : relationsWithItems;
}

export function bulkAddRelations(
  nodes: GraphNode,
  objectIDs: Array<ID>,
  relevance?: Relevance,
  argument?: Argument,
  startPos?: number
): GraphNode {
  return objectIDs.reduce((rdx, id, currentIndex) => {
    const ord = startPos !== undefined ? startPos + currentIndex : undefined;
    return addRelationToRelations(rdx, id, relevance, argument, ord);
  }, nodes);
}

export type EmptyNodeData = {
  index: number;
  relationItem: GraphNode;
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

// Inject empty nodes back into nodes based on temporaryEvents
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

  // For each empty node, insert into the corresponding nodes with its metadata
  const updatedRelations = emptyNodeMetadata.reduce(
    (nodes, data, relationsID) => {
      const shortRelationsID = splitID(relationsID)[1];
      const existingRelations = nodes.get(shortRelationsID);
      if (!existingRelations) {
        return nodes;
      }

      // Check if empty node is already injected (from parent MergeKnowledgeDB)
      const alreadyHasEmpty = existingRelations.children.some(
        (item) => item.id === EMPTY_SEMANTIC_ID
      );
      if (alreadyHasEmpty) {
        return nodes;
      }

      // Insert empty node at the specified index with its metadata (relevance, argument)
      const updatedItems = existingRelations.children.insert(
        data.index,
        data.relationItem
      );
      return nodes.set(shortRelationsID, {
        ...existingRelations,
        children: updatedItems,
      });
    },
    myDB.nodes
  );

  return knowledgeDBs.set(myself, {
    ...myDB,
    nodes: updatedRelations,
  });
}
