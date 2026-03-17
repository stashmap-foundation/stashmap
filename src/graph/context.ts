/* eslint-disable @typescript-eslint/no-use-before-define, functional/immutable-data, functional/no-let */
import { List, Map } from "immutable";
import { decodePublicKeyInputSync } from "./publicKeys";
import { EMPTY_SEMANTIC_ID, type TextSeed } from "./types";
import { getNode } from "./queries";
import { isRefNode } from "./references";

export const SEARCH_PREFIX = "~Search:";

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

export function createRootAnchor(
  snapshotContext?: Context,
  sourceNode?: GraphNode,
  snapshotLabels?: string[]
): RootAnchor | undefined {
  const normalizedContext = snapshotContext ?? List<ID>();
  if (normalizedContext.size === 0 && !sourceNode) {
    return undefined;
  }

  return {
    snapshotContext: normalizedContext,
    ...(snapshotLabels?.length ? { snapshotLabels } : {}),
    ...(sourceNode
      ? {
          sourceAuthor: sourceNode.author,
          sourceRootID: sourceNode.root,
          sourceNodeID: sourceNode.id,
          ...(sourceNode.parent
            ? { sourceParentNodeID: sourceNode.parent }
            : {}),
        }
      : {}),
  };
}

export function getRootAnchorContext(node: GraphNode): Context {
  return node.anchor?.snapshotContext ?? List<ID>();
}

export function rootAnchorsEqual(
  left?: RootAnchor,
  right?: RootAnchor
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.snapshotContext.equals(right.snapshotContext) &&
    JSON.stringify(left.snapshotLabels ?? []) ===
      JSON.stringify(right.snapshotLabels ?? []) &&
    left.sourceAuthor === right.sourceAuthor &&
    left.sourceRootID === right.sourceRootID &&
    left.sourceNodeID === right.sourceNodeID &&
    left.sourceParentNodeID === right.sourceParentNodeID
  );
}

export function getNodeUserPublicKey(
  node?: GraphNode,
  text = node?.text
): PublicKey | undefined {
  return (
    decodePublicKeyInputSync(text) ||
    node?.userPublicKey ||
    decodePublicKeyInputSync(node?.text)
  );
}

export function withUsersEntryPublicKey(
  node: GraphNode,
  text = node.text
): GraphNode {
  const userPublicKey = getNodeUserPublicKey(node, text);
  if (!userPublicKey) {
    return node;
  }

  return {
    ...node,
    userPublicKey,
  };
}

type NodeLookupIndex = globalThis.Map<string, GraphNode[]>;

const nodeContextCache = new WeakMap<
  KnowledgeData,
  globalThis.Map<string, Context>
>();

function getNodeLookupIndex(
  knowledgeDBs: KnowledgeDBs,
  db: KnowledgeData
): NodeLookupIndex {
  const index = new globalThis.Map<string, GraphNode[]>();
  const addToIndex = (key: string, node: GraphNode): void => {
    const existing = index.get(key);
    if (existing) {
      existing.push(node);
      return;
    }
    index.set(key, [node]);
  };

  db.nodes.valueSeq().forEach((node) => {
    addToIndex(getSemanticID(knowledgeDBs, node), node);
  });

  index.forEach((nodes) => {
    nodes.sort((left, right) => right.updated - left.updated);
  });

  return index;
}

function getNodeContextIndex(
  db: KnowledgeData
): globalThis.Map<string, Context> {
  const cached = nodeContextCache.get(db);
  if (cached) {
    return cached;
  }
  const index = new globalThis.Map<string, Context>();
  nodeContextCache.set(db, index);
  return index;
}

export function getIndexedNodesForKeys(
  knowledgeDBs: KnowledgeDBs,
  db: KnowledgeData,
  keys: string[]
): GraphNode[] {
  const uniqueKeys = Array.from(new globalThis.Set(keys));
  const seen = new globalThis.Set<string>();
  return uniqueKeys.flatMap((key) =>
    (getNodeLookupIndex(knowledgeDBs, db).get(key) || []).filter((node) => {
      const nodeKey = shortID(node.id);
      if (seen.has(nodeKey)) {
        return false;
      }
      seen.add(nodeKey);
      return true;
    })
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
  const targetNode = isRefNode(node)
    ? getNode(knowledgeDBs, node.targetID, node.author)
    : undefined;
  if (targetNode) {
    return getSemanticID(knowledgeDBs, targetNode);
  }
  return getNodeSemanticID(node);
}

export function getNodeContext(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode
): Context {
  const db = knowledgeDBs.get(node.author);
  const nodeKey = shortID(node.id);
  if (db) {
    const cached = getNodeContextIndex(db).get(nodeKey);
    if (cached) {
      return cached;
    }
  }

  const fallbackContext = getRootAnchorContext(node);
  if (!node.parent) {
    if (db) {
      getNodeContextIndex(db).set(nodeKey, fallbackContext);
    }
    return fallbackContext;
  }

  const visited = new globalThis.Set<string>([nodeKey]);
  const parentChain: GraphNode[] = [];
  let currentParentID: LongID | undefined = node.parent;

  while (currentParentID) {
    const parentKey = shortID(currentParentID);
    if (visited.has(parentKey)) {
      if (db) {
        getNodeContextIndex(db).set(nodeKey, fallbackContext);
      }
      return fallbackContext;
    }
    visited.add(parentKey);

    const parentNode = getNode(knowledgeDBs, currentParentID, node.author);
    if (!parentNode) {
      if (db) {
        getNodeContextIndex(db).set(nodeKey, fallbackContext);
      }
      return fallbackContext;
    }
    parentChain.unshift(parentNode);
    currentParentID = parentNode.parent;
  }

  const derivedContext = parentChain.reduce(
    (context, parentNode) =>
      context.push(getSemanticID(knowledgeDBs, parentNode)),
    parentChain.length > 0
      ? getNodeContext(knowledgeDBs, parentChain[0] as GraphNode)
      : List<ID>()
  );
  if (db) {
    getNodeContextIndex(db).set(nodeKey, derivedContext);
  }
  return derivedContext;
}

export function getNodeStack(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode
): ID[] {
  return [
    ...getNodeContext(knowledgeDBs, node).toArray(),
    getSemanticID(knowledgeDBs, node),
  ];
}

export function getNodeDepth(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode
): number {
  return getNodeContext(knowledgeDBs, node).size;
}

function createTextNodeFromGraphNode(node: GraphNode): TextSeed {
  return {
    id: getNodeSemanticID(node),
    text: getNodeText(node) || "",
  };
}

export function buildTextNodesFromGraphNodes(
  nodes: Iterable<GraphNode>
): Map<string, TextSeed> {
  const nodeList = Array.from(nodes).filter((node) => !isRefNode(node));
  const knowledgeDBs = nodeList.reduce((acc, node) => {
    const authorDB = acc.get(node.author, {
      nodes: Map<string, GraphNode>(),
    });
    return acc.set(node.author, {
      nodes: authorDB.nodes.set(shortID(node.id), node),
    });
  }, Map<PublicKey, KnowledgeData>());

  const latestByHead = nodeList.reduce((acc, node) => {
    const semanticID = getNodeSemanticID(node);
    const existing = acc.get(semanticID);
    const isNewer = !existing || node.updated > existing.updated;
    const isSameVersionNewerDisplay =
      !!existing &&
      node.updated === existing.updated &&
      getNodeDepth(knowledgeDBs, node) < getNodeDepth(knowledgeDBs, existing);
    if (isNewer || isSameVersionNewerDisplay) {
      return acc.set(semanticID, node);
    }
    return acc;
  }, Map<ID, GraphNode>());

  return latestByHead.map((node) => createTextNodeFromGraphNode(node)) as Map<
    string,
    TextSeed
  >;
}

export function isEmptySemanticID(semanticID: ID): boolean {
  return semanticID === EMPTY_SEMANTIC_ID;
}
