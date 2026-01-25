import { List, Set, Map } from "immutable";
import crypto from "crypto";
import {
  newRelations,
  getNodeFromID,
  getVersionedDisplayText,
} from "./ViewContext";
import { REFERENCED_BY, REF_PREFIX } from "./constants";

// Content-addressed node ID generation
// Node ID = sha256(text).slice(0, 32) - no author prefix
export function hashText(text: string): ID {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 32);
}

// Pre-computed hash for the ~Versions node
export const VERSIONS_NODE_ID = hashText("~Versions");

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

export function createConcreteRefId(relationID: LongID): LongID {
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

export function parseConcreteRefId(refId: ID | LongID): LongID | undefined {
  if (!isConcreteRefId(refId)) {
    return undefined;
  }
  return refId.slice(CONCRETE_REF_PREFIX.length) as LongID;
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

export function buildReferenceNode(
  refId: LongID,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): ReferenceNode | undefined {
  const parsed = parseAbstractRefId(refId);
  if (!parsed) {
    return undefined;
  }
  const { targetNode, targetContext } = parsed;

  // Build the display text by looking up each node
  // Use versioned text if available, walking through context incrementally
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

  // Build context incrementally as we walk through the path
  const contextTexts = targetContext.reduce((acc, nodeId, index) => {
    const contextUpToHere = targetContext.slice(0, index);
    const text = getNodeTextWithVersion(nodeId, contextUpToHere);
    return acc.push(text);
  }, List<string>());

  const targetText = getNodeTextWithVersion(targetNode, targetContext);
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
    items: sortedPaths
      .map((path) => {
        // If context is empty and head equals the nodeID, this is a list with no context
        // Create ref with empty context so it displays as just the node name
        const isOwnList =
          path.context.size === 0 && shortID(path.head) === targetShortID;
        if (isOwnList) {
          return createAbstractRefId(List<ID>(), nodeID as ID);
        }

        // If the node is inside ~Versions, point to the parent node instead
        // This also deduplicates: all versions inside ~Versions map to the same parent
        if (path.head === VERSIONS_NODE_ID && path.context.size > 0) {
          const parentNode = path.context.last() as ID;
          const parentContext = path.context.slice(0, -1);
          return createAbstractRefId(parentContext, parentNode);
        }

        return createAbstractRefId(path.context.push(path.head), nodeID as ID);
      })
      // Deduplicate refIds (multiple versions inside ~Versions map to the same parent)
      .toOrderedSet()
      .toList()
      .map((refId) => ({
        nodeID: refId,
        relevance: "" as Relevance,
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
  // Default relevance to "" (maybe relevant) if undefined
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
  relevance?: Relevance,
  argument?: Argument,
  ord?: number
): Relations {
  const newItem: RelationItem = {
    nodeID: objectID,
    relevance: relevance ?? "",
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
