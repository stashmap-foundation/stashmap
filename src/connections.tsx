/* eslint-disable @typescript-eslint/no-use-before-define, functional/immutable-data, functional/no-let */
import { List, Set, Map } from "immutable";
import { newRefNode, newRelations } from "./relationFactory";
import { SEARCH_PREFIX } from "./constants";
import { getRootAnchorContext, rootAnchorsEqual } from "./rootAnchor";

// Empty text remains the sentinel for an empty placeholder row
export const EMPTY_SEMANTIC_ID = "" as ID;

export type TextSeed = {
  id: ID;
  text: string;
};

export type RefTargetSeed = {
  targetID: LongID;
  linkText?: string;
};

export function createRefTarget(
  targetID: LongID,
  linkText?: string
): RefTargetSeed {
  return { targetID, linkText };
}

export function isRefNode(
  node: GraphNode | undefined
): node is GraphNode & { targetID: LongID } {
  return !!node && (node.isRef === true || node.targetID !== undefined);
}

export function getTargetNode(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode | undefined
): GraphNode | undefined {
  const targetID = node?.targetID;
  return targetID && node
    ? getNode(knowledgeDBs, targetID, node.author)
    : undefined;
}

export function resolveNode(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode | undefined
): GraphNode | undefined {
  if (!node) {
    return undefined;
  }
  return isRefNode(node) ? getTargetNode(knowledgeDBs, node) : node;
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
  if (isSearchId(id)) {
    return id;
  }
  return splitID(id)[1];
}

export function getNodeText(node: GraphNode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }
  if (node.text !== "") {
    return node.text;
  }
  const nodeID = shortID(node.id) as ID;
  return isSearchId(nodeID) ? parseSearchId(nodeID) || "" : undefined;
}

type RelationLookupIndex = globalThis.Map<string, GraphNode[]>;

const relationContextCache = new WeakMap<
  KnowledgeData,
  globalThis.Map<string, Context>
>();

function getRelationLookupIndex(
  knowledgeDBs: KnowledgeDBs,
  db: KnowledgeData
): RelationLookupIndex {
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
    addToIndex(getSemanticID(knowledgeDBs, relation), relation);
  });

  index.forEach((nodes) => {
    nodes.sort((left, right) => right.updated - left.updated);
  });

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
  knowledgeDBs: KnowledgeDBs,
  db: KnowledgeData,
  keys: string[]
): GraphNode[] {
  const uniqueKeys = Array.from(new globalThis.Set(keys));
  const seen = new globalThis.Set<string>();
  return uniqueKeys.flatMap((key) =>
    (getRelationLookupIndex(knowledgeDBs, db).get(key) || []).filter(
      (relation) => {
        const relationKey = shortID(relation.id);
        if (seen.has(relationKey)) {
          return false;
        }
        seen.add(relationKey);
        return true;
      }
    )
  );
}

export function getNodeSemanticID(node: GraphNode): ID {
  const nodeID = shortID(node.id) as ID;
  if (isSearchId(nodeID)) {
    return nodeID;
  }
  return node.text as ID;
}

export function getSemanticID(knowledgeDBs: KnowledgeDBs, node: GraphNode): ID {
  const targetNode = getTargetNode(knowledgeDBs, node);
  if (targetNode) {
    return getSemanticID(knowledgeDBs, targetNode);
  }
  return getNodeSemanticID(node);
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

    const parentRelation = getNode(
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
      context.push(getSemanticID(knowledgeDBs, parentRelation)),
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
    getSemanticID(knowledgeDBs, relation),
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
    id: getNodeSemanticID(relation),
    text: getNodeText(relation) || "",
  };
}

export function buildTextNodesFromRelations(
  nodes: Iterable<GraphNode>
): Map<string, TextSeed> {
  const relationList = Array.from(nodes).filter(
    (relation) => !isRefNode(relation)
  );
  const knowledgeDBs = relationList.reduce((acc, relation) => {
    const authorDB = acc.get(relation.author, {
      nodes: Map<string, GraphNode>(),
    });
    return acc.set(relation.author, {
      nodes: authorDB.nodes.set(shortID(relation.id), relation),
    });
  }, Map<PublicKey, KnowledgeData>());

  const latestByHead = relationList.reduce((acc, relation) => {
    const semanticID = getNodeSemanticID(relation);
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

export function getNode(
  knowledgeDBs: KnowledgeDBs,
  nodeID: ID | undefined,
  myself: PublicKey
): GraphNode | undefined {
  if (!nodeID) {
    return undefined;
  }
  const [remote, id] = splitID(nodeID);
  if (remote) {
    return knowledgeDBs.get(remote)?.nodes.get(id);
  }
  return knowledgeDBs.get(myself)?.nodes.get(nodeID);
}

export function getRelationChildNodes(
  knowledgeDBs: KnowledgeDBs,
  relation: GraphNode,
  myself: PublicKey
): List<GraphNode> {
  return relation.children.reduce((acc, childID) => {
    const childNode = getNode(knowledgeDBs, childID, myself);
    return childNode ? acc.push(childNode) : acc;
  }, List<GraphNode>());
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
  const relation = getNode(knowledgeDBs, relationID, effectiveAuthor);
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
  const relation = resolveNode(
    knowledgeDBs,
    getNode(knowledgeDBs, refId, effectiveAuthor)
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
  const relation = resolveNode(
    knowledgeDBs,
    getNode(knowledgeDBs, refId, effectiveAuthor)
  );
  if (!relation) {
    return undefined;
  }

  const containingParent = knowledgeDBs
    .get(relation.author)
    ?.nodes.valueSeq()
    .find((candidate) =>
      candidate.children.some((childID) => childID === relation.id)
    );
  const parentRelation =
    (relation.parent
      ? getNode(knowledgeDBs, relation.parent, relation.author)
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
  const text = relation.text || existingRelation?.text || "";
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
  myself: PublicKey,
  asRefs: boolean = false
): { relation: GraphNode; childNodes: List<GraphNode> } {
  const rel = {
    ...newRelations("", List<ID>(), myself),
    id: searchId as LongID,
    root: searchId as LongID,
  };
  const uniqueNodeIDs = foundNodeIDs.toSet().toList();
  const childNodes = uniqueNodeIDs.map(
    (semanticID): GraphNode =>
      asRefs
        ? {
            ...newRefNode(
              rel.author,
              searchId as LongID,
              semanticID as LongID,
              searchId as LongID
            ),
            updated: rel.updated,
            virtualType: "search",
          }
        : {
            children: List<ID>(),
            id: semanticID,
            text: "",
            parent: searchId as LongID,
            updated: rel.updated,
            author: rel.author,
            root: searchId as LongID,
            relevance: undefined,
            virtualType: "search",
          }
  );
  return {
    relation: {
      ...rel,
      children: childNodes.map((child) => child.id).toList(),
    },
    childNodes,
  };
}

export function getRelations(
  knowledgeDBs: KnowledgeDBs,
  relationID: ID | undefined,
  myself: PublicKey
): GraphNode | undefined {
  return getNode(knowledgeDBs, relationID, myself);
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
        (itemID) => itemID === EMPTY_SEMANTIC_ID
      );
      if (alreadyHasEmpty) {
        return nodes;
      }

      // Insert empty node at the specified index with its metadata (relevance, argument)
      const updatedItems = existingRelations.children.insert(
        data.index,
        EMPTY_SEMANTIC_ID
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
