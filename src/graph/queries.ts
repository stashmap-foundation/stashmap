import { List, Map, Set as ImmutableSet } from "immutable";
import { newNode, newRefNode } from "./nodeFactory";
import { newDB, EMPTY_SEMANTIC_ID } from "./types";
import { rootAnchorsEqual, splitID, shortID } from "./context";

export const LOG_ROOT_ROLE: RootSystemRole = "log";
const LOG_ROOT_TEXT = "~Log";

function mergeKnowledgeData(
  left: KnowledgeData | undefined,
  right: KnowledgeData | undefined
): KnowledgeData {
  const existing = left || newDB();
  if (right === undefined) {
    return existing;
  }
  return {
    nodes: existing.nodes.merge(right.nodes),
  };
}

export function mergeKnowledgeDBs(
  left: KnowledgeDBs,
  right: KnowledgeDBs
): KnowledgeDBs {
  const allUsers = left.keySeq().toSet().union(right.keySeq().toSet());
  return Map<PublicKey, KnowledgeData>(
    allUsers
      .toArray()
      .map((userPK) => [
        userPK,
        mergeKnowledgeData(left.get(userPK), right.get(userPK)),
      ])
  );
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

export function getChildNodes(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode,
  myself: PublicKey
): List<GraphNode> {
  return node.children.reduce((acc, childID) => {
    const childNode = getNode(knowledgeDBs, childID, myself);
    return childNode ? acc.push(childNode) : acc;
  }, List<GraphNode>());
}

export function ensureNodeNativeFields(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode
): GraphNode {
  const existingNode = knowledgeDBs
    .get(node.author)
    ?.nodes.get(shortID(node.id));
  const text = node.text || existingNode?.text || "";
  const parent = node.parent || existingNode?.parent;
  const anchor = parent ? undefined : node.anchor ?? existingNode?.anchor;

  if (
    node.text === text &&
    node.parent === parent &&
    rootAnchorsEqual(node.anchor, anchor)
  ) {
    return node;
  }

  return {
    ...node,
    text,
    parent,
    anchor,
  };
}

export function getSearchNodes(
  searchId: ID,
  foundNodeIDs: List<ID>,
  myself: PublicKey,
  asRefs: boolean = false
): { node: GraphNode; childNodes: List<GraphNode> } {
  const node = {
    ...newNode("", List<ID>(), myself),
    id: searchId as LongID,
    root: searchId as LongID,
  };
  const uniqueNodeIDs = foundNodeIDs.toSet().toList();
  const childNodes = uniqueNodeIDs.map(
    (semanticID): GraphNode =>
      asRefs
        ? {
            ...newRefNode(
              node.author,
              searchId as LongID,
              semanticID as LongID,
              searchId as LongID
            ),
            updated: node.updated,
            virtualType: "search",
          }
        : {
            children: List<ID>(),
            id: semanticID,
            text: "",
            parent: searchId as LongID,
            updated: node.updated,
            author: node.author,
            root: searchId as LongID,
            relevance: undefined,
            virtualType: "search",
          }
  );
  return {
    node: {
      ...node,
      children: childNodes.map((childNode) => childNode.id).toList(),
    },
    childNodes,
  };
}

export function deleteNodes(
  node: GraphNode,
  indices: ImmutableSet<number>
): GraphNode {
  const children = indices
    .sortBy((index) => -index)
    .reduce((result, deleteIndex) => result.delete(deleteIndex), node.children);
  return {
    ...node,
    children,
  };
}

export function moveNodes(
  node: GraphNode,
  indices: Array<number>,
  startPosition: number
): GraphNode {
  const childrenToMove = node.children.filter((_, i) => indices.includes(i));
  const itemsBeforeStartPos = indices.filter((i) => i < startPosition).length;
  const updatedChildren = node.children
    .filterNot((_, i) => indices.includes(i))
    .splice(
      startPosition - itemsBeforeStartPos,
      0,
      ...childrenToMove.toArray()
    );
  return {
    ...node,
    children: updatedChildren,
  };
}

export function nodeMatchesType(
  node: GraphNode,
  filterType: Relevance | Argument | "contains"
): boolean {
  if (filterType === "confirms" || filterType === "contra") {
    return node.argument === filterType;
  }
  if (filterType === "contains") {
    return node.relevance === undefined && node.argument === undefined;
  }
  return node.relevance === filterType;
}

export function nodePassesFilters(
  node: GraphNode,
  activeFilters: (
    | Relevance
    | Argument
    | "suggestions"
    | "versions"
    | "incoming"
    | "contains"
  )[]
): boolean {
  if (node.id === EMPTY_SEMANTIC_ID) {
    return true;
  }

  const relevanceFilter =
    node.relevance === undefined ? "contains" : node.relevance;
  if (!activeFilters.includes(relevanceFilter)) {
    return false;
  }

  const hasArgumentFilter =
    activeFilters.includes("confirms") || activeFilters.includes("contra");
  if (hasArgumentFilter) {
    if (!node.argument || !activeFilters.includes(node.argument)) {
      return false;
    }
  }

  return true;
}

type EmptyNodeData = {
  index: number;
  emptyNode: GraphNode;
  paneIndex: number;
};

export function computeEmptyNodeMetadata(
  temporaryEvents: import("immutable").List<TemporaryEvent>
): Map<LongID, EmptyNodeData> {
  return temporaryEvents.reduce((metadata, event) => {
    if (event.type === "ADD_EMPTY_NODE") {
      return metadata.set(event.nodeID, {
        index: event.index,
        emptyNode: event.emptyNode,
        paneIndex: event.paneIndex,
      });
    }
    if (event.type === "REMOVE_EMPTY_NODE") {
      return metadata.delete(event.nodeID);
    }
    return metadata;
  }, Map<LongID, EmptyNodeData>());
}

export function injectEmptyNodesIntoKnowledgeDBs(
  knowledgeDBs: KnowledgeDBs,
  temporaryEvents: import("immutable").List<TemporaryEvent>,
  myself: PublicKey
): KnowledgeDBs {
  const emptyNodeMetadata = computeEmptyNodeMetadata(temporaryEvents);

  if (emptyNodeMetadata.size === 0) {
    return knowledgeDBs;
  }

  const myDB = knowledgeDBs.get(myself);
  if (!myDB) {
    return knowledgeDBs;
  }

  const updatedNodes = emptyNodeMetadata.reduce((nodes, data, nodeID) => {
    const shortNodeID = splitID(nodeID)[1];
    const existingNode = nodes.get(shortNodeID);
    if (!existingNode) {
      return nodes;
    }

    const alreadyHasEmpty = existingNode.children.some(
      (childID) => childID === EMPTY_SEMANTIC_ID
    );
    if (alreadyHasEmpty) {
      return nodes;
    }

    const updatedChildren = existingNode.children.insert(
      data.index,
      EMPTY_SEMANTIC_ID
    );
    return nodes.set(shortNodeID, {
      ...existingNode,
      children: updatedChildren,
    });
  }, myDB.nodes);

  return knowledgeDBs.set(myself, {
    ...myDB,
    nodes: updatedNodes,
  });
}

export function isStandaloneRoot(node: GraphNode): boolean {
  return !node.parent && node.root === node.id;
}

export function getOwnSystemRoot(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  systemRole: RootSystemRole
): GraphNode | undefined {
  return knowledgeDBs
    .get(author)
    ?.nodes.valueSeq()
    .filter(
      (node) =>
        node.author === author &&
        node.systemRole === systemRole &&
        isStandaloneRoot(node)
    )
    .sortBy((node) => -node.updated)
    .first();
}

export function getOwnLogRoot(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey
): GraphNode | undefined {
  return getOwnSystemRoot(knowledgeDBs, author, LOG_ROOT_ROLE);
}

export function getSystemRoleText(systemRole: RootSystemRole): string {
  switch (systemRole) {
    case LOG_ROOT_ROLE:
    default:
      return LOG_ROOT_TEXT;
  }
}
