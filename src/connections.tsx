/* eslint-disable @typescript-eslint/no-use-before-define, functional/immutable-data, functional/no-let */
import { List, Set, Map } from "immutable";
import { newRefNode, newNode } from "./nodeFactory";
import { SEARCH_PREFIX } from "./constants";
import { getRootAnchorContext, rootAnchorsEqual } from "./rootAnchor";
import {
  getBlockFileLinkPath,
  getBlockLinkTarget,
  isBlockFileLink,
  isBlockLink,
  nodeText,
  plainSpans,
} from "./nodeSpans";
import { Document, documentKeyOf } from "./Document";
import { resolveLinkPath } from "./linkPath";

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

export const isRefNode = isBlockLink;

function getTargetNode(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode | undefined
): GraphNode | undefined {
  const targetID = getBlockLinkTarget(node);
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
  return isBlockLink(node) ? getTargetNode(knowledgeDBs, node) : node;
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
  const text = nodeText(node);
  if (text !== "") {
    return text;
  }
  const nodeID = shortID(node.id) as ID;
  return isSearchId(nodeID) ? parseSearchId(nodeID) || "" : undefined;
}

const nodeContextCache = new WeakMap<
  KnowledgeData,
  globalThis.Map<string, Context>
>();

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

export function getNodeSemanticID(node: GraphNode): ID {
  const nodeID = shortID(node.id) as ID;
  if (isSearchId(nodeID)) {
    return nodeID;
  }
  return node.id as ID;
}

export function getSemanticID(knowledgeDBs: KnowledgeDBs, node: GraphNode): ID {
  const targetNode = getTargetNode(knowledgeDBs, node);
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

type RefTargetInfo = {
  stack: ID[];
  author: PublicKey;
  rootNodeId?: LongID;
  scrollToId?: string;
};

export function getNodeRouteTargetInfo(
  nodeID: LongID,
  knowledgeDBs: KnowledgeDBs,
  effectiveAuthor: PublicKey
): RefTargetInfo | undefined {
  const node = getNode(knowledgeDBs, nodeID, effectiveAuthor);
  if (!node) {
    return undefined;
  }
  return {
    stack: getNodeStack(knowledgeDBs, node),
    author: node.author,
    rootNodeId: node.id,
  };
}

export function getRefTargetInfo(
  refId: ID,
  knowledgeDBs: KnowledgeDBs,
  effectiveAuthor: PublicKey
): RefTargetInfo | undefined {
  const node = resolveNode(
    knowledgeDBs,
    getNode(knowledgeDBs, refId, effectiveAuthor)
  );
  if (!node) {
    return undefined;
  }

  const stack = getNodeStack(knowledgeDBs, node);
  return {
    stack,
    author: node.author,
    rootNodeId: node.id,
  };
}

export function getFileLinkTargetInfo(
  resolvedPath: string,
  documentByFilePath: Map<string, Document>,
  knowledgeDBs: KnowledgeDBs
): RefTargetInfo | undefined {
  const targetDoc = documentByFilePath.get(resolvedPath);
  if (!targetDoc) {
    return undefined;
  }
  const targetKey = documentKeyOf(targetDoc.author, targetDoc.docId);
  const targetRoot = knowledgeDBs
    .get(targetDoc.author)
    ?.nodes.valueSeq()
    .find((node) => node.docId === targetDoc.docId && !node.parent);
  if (!targetRoot) {
    return undefined;
  }
  return {
    stack: getNodeStack(knowledgeDBs, targetRoot),
    author: targetRoot.author,
    rootNodeId: targetRoot.id as LongID,
    scrollToId: targetKey ? undefined : undefined,
  };
}

function resolveAnyLink(
  knowledgeDBs: KnowledgeDBs,
  documents: Map<string, Document> | undefined,
  documentByFilePath: Map<string, Document> | undefined,
  source: GraphNode | undefined
): GraphNode | undefined {
  if (!source) {
    return undefined;
  }
  if (isBlockLink(source)) {
    return getTargetNode(knowledgeDBs, source);
  }
  if (
    isBlockFileLink(source) &&
    documents !== undefined &&
    documentByFilePath !== undefined
  ) {
    return resolveFileLinkRootByDocs(
      knowledgeDBs,
      documents,
      documentByFilePath,
      source
    );
  }
  return source;
}

function resolveFileLinkRootByDocs(
  knowledgeDBs: KnowledgeDBs,
  documents: Map<string, Document>,
  documentByFilePath: Map<string, Document>,
  source: GraphNode
): GraphNode | undefined {
  const linkPath = getBlockFileLinkPath(source);
  if (!linkPath) return undefined;
  const sourceRoot =
    source.id === source.root
      ? source
      : getNode(knowledgeDBs, source.root, source.author);
  const sourceFilePath = sourceRoot?.docId
    ? documents.get(documentKeyOf(sourceRoot.author, sourceRoot.docId))
        ?.filePath
    : undefined;
  const resolved = resolveLinkPath(linkPath, sourceFilePath);
  const targetDoc = documentByFilePath.get(resolved);
  if (!targetDoc) return undefined;
  return knowledgeDBs
    .get(targetDoc.author)
    ?.nodes.valueSeq()
    .find((node) => node.docId === targetDoc.docId && !node.parent);
}

export function getRefLinkTargetInfo(
  refId: ID,
  knowledgeDBs: KnowledgeDBs,
  effectiveAuthor: PublicKey,
  documents?: Map<string, Document>,
  documentByFilePath?: Map<string, Document>
): RefTargetInfo | undefined {
  const source = getNode(knowledgeDBs, refId, effectiveAuthor);
  const node = resolveAnyLink(
    knowledgeDBs,
    documents,
    documentByFilePath,
    source
  );
  if (!node) {
    return undefined;
  }

  const containingParent = knowledgeDBs
    .get(node.author)
    ?.nodes.valueSeq()
    .find((candidate) =>
      candidate.children.some((childID) => childID === node.id)
    );
  const parentNode =
    (node.parent
      ? getNode(knowledgeDBs, node.parent, node.author)
      : undefined) || containingParent;
  const targetRoot = parentNode || node;

  return {
    stack: getNodeStack(knowledgeDBs, targetRoot),
    author: targetRoot.author,
    rootNodeId: targetRoot.id,
    scrollToId: targetRoot.id === node.id ? undefined : node.id,
  };
}

export function ensureNodeNativeFields(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode
): GraphNode {
  const existingNode = knowledgeDBs
    .get(node.author)
    ?.nodes.get(shortID(node.id));
  const parent = node.parent || existingNode?.parent;
  const anchor = parent ? undefined : node.anchor ?? existingNode?.anchor;

  if (node.parent === parent && rootAnchorsEqual(node.anchor, anchor)) {
    return node;
  }

  return {
    ...node,
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
  const rel = {
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
            spans: plainSpans(""),
            parent: searchId as LongID,
            updated: rel.updated,
            author: rel.author,
            root: searchId as LongID,
            relevance: undefined,
            virtualType: "search",
          }
  );
  return {
    node: {
      ...rel,
      children: childNodes.map((child) => child.id).toList(),
    },
    childNodes,
  };
}

export function deleteNodes(nodes: GraphNode, indices: Set<number>): GraphNode {
  const children = indices
    .sortBy((index) => -index)
    .reduce((r, deleteIndex) => r.delete(deleteIndex), nodes.children);
  return {
    ...nodes,
    children,
  };
}

export function moveNodes(
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

export function isEmptySemanticID(semanticID: ID): boolean {
  return semanticID === EMPTY_SEMANTIC_ID;
}

export function itemPassesFilters(
  item: GraphNode,
  activeFilters: (
    | Relevance
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

  return true;
}

type EmptyNodeData = {
  index: number;
  nodeItem: GraphNode;
  paneIndex: number;
};

// Compute current empty node data from temporary events
// Events are processed in order: ADD sets data, REMOVE clears it
export function computeEmptyNodeMetadata(
  temporaryEvents: List<TemporaryEvent>
): Map<LongID, EmptyNodeData> {
  return temporaryEvents.reduce((metadata, event) => {
    if (event.type === "ADD_EMPTY_NODE") {
      return metadata.set(event.nodeID, {
        index: event.index,
        nodeItem: event.nodeItem,
        paneIndex: event.paneIndex,
      });
    }
    if (event.type === "REMOVE_EMPTY_NODE") {
      return metadata.delete(event.nodeID);
    }
    return metadata;
  }, Map<LongID, EmptyNodeData>());
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
  const updatedNodes = emptyNodeMetadata.reduce((nodes, data, nodeID) => {
    const shortNodesID = splitID(nodeID)[1];
    const existingNodes = nodes.get(shortNodesID);
    if (!existingNodes) {
      return nodes;
    }

    // Check if empty node is already injected (from parent MergeKnowledgeDB)
    const alreadyHasEmpty = existingNodes.children.some(
      (itemID) => itemID === EMPTY_SEMANTIC_ID
    );
    if (alreadyHasEmpty) {
      return nodes;
    }

    // Insert empty node at the specified index with its metadata (relevance, argument)
    const updatedItems = existingNodes.children.insert(
      data.index,
      EMPTY_SEMANTIC_ID
    );
    return nodes.set(shortNodesID, {
      ...existingNodes,
      children: updatedItems,
    });
  }, myDB.nodes);

  return knowledgeDBs.set(myself, {
    ...myDB,
    nodes: updatedNodes,
  });
}
