/* eslint-disable @typescript-eslint/no-use-before-define, functional/immutable-data, functional/no-let */
import { List, Set, Map } from "immutable";
import { SEARCH_PREFIX } from "./constants";
import {
  getBlockFileLinkPath,
  getBlockLinkTarget,
  isBlockFileLink,
  isBlockLink,
  nodeText,
} from "./nodeSpans";
import { Document, documentKeyOf } from "./Document";
import { displayTextOf } from "./ical";
import { resolveLinkPath } from "./linkPath";

// Empty text remains the sentinel for an empty placeholder row
export const EMPTY_SEMANTIC_ID = "" as ID;

export type TextSeed = {
  id: ID;
  text: string;
};

export type RefTargetSeed = {
  targetID: ID;
  linkText?: string;
};

export type DocumentLinkTargetSeed = {
  sourceId: SourceId;
  docId: string;
  filePath?: string;
  linkText?: string;
};

export function createRefTarget(
  targetID: ID,
  linkText?: string
): RefTargetSeed {
  return { targetID, linkText };
}

export function createDocumentLinkTarget(
  sourceId: SourceId,
  docId: string,
  filePath?: string,
  linkText?: string
): DocumentLinkTargetSeed {
  return {
    sourceId,
    docId,
    ...(filePath !== undefined ? { filePath } : {}),
    linkText,
  };
}

export const isRefNode = isBlockLink;

function getTargetNode(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode | undefined,
  sourceId: SourceId
): GraphNode | undefined {
  const targetID = getBlockLinkTarget(node);
  return targetID && node
    ? getNode(knowledgeDBs, targetID, sourceId)
    : undefined;
}

export function resolveNode(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode | undefined,
  sourceId: SourceId
): GraphNode | undefined {
  if (!node) {
    return undefined;
  }
  return isBlockLink(node) ? getTargetNode(knowledgeDBs, node, sourceId) : node;
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

export function getNodeText(node: GraphNode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }
  const text = nodeText(node);
  if (text !== "") {
    return text;
  }
  return isSearchId(node.id) ? parseSearchId(node.id) || "" : undefined;
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
  if (isSearchId(node.id)) {
    return node.id;
  }
  return nodeText(node) as ID;
}

export function getSemanticID(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode,
  sourceId: SourceId
): ID {
  const targetNode = getTargetNode(knowledgeDBs, node, sourceId);
  if (targetNode) {
    return getSemanticID(knowledgeDBs, targetNode, sourceId);
  }
  return getNodeSemanticID(node);
}

export function getNodeContext(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode,
  sourceId: SourceId
): Context {
  const db = knowledgeDBs.get(sourceId);
  const nodeKey = node.id;
  if (db) {
    const cached = getNodeContextIndex(db).get(nodeKey);
    if (cached) {
      return cached;
    }
  }

  const fallbackContext = List<ID>();
  if (!node.parent) {
    if (db) {
      getNodeContextIndex(db).set(nodeKey, fallbackContext);
    }
    return fallbackContext;
  }

  const visited = new globalThis.Set<string>([nodeKey]);
  const parentChain: GraphNode[] = [];
  let currentParentID: ID | undefined = node.parent;

  while (currentParentID) {
    const parentKey = currentParentID;
    if (visited.has(parentKey)) {
      if (db) {
        getNodeContextIndex(db).set(nodeKey, fallbackContext);
      }
      return fallbackContext;
    }
    visited.add(parentKey);

    const parentNode = getNode(knowledgeDBs, currentParentID, sourceId);
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
      context.push(getSemanticID(knowledgeDBs, parentNode, sourceId)),
    parentChain.length > 0
      ? getNodeContext(knowledgeDBs, parentChain[0] as GraphNode, sourceId)
      : List<ID>()
  );
  if (db) {
    getNodeContextIndex(db).set(nodeKey, derivedContext);
  }
  return derivedContext;
}

export function getNodeStack(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode,
  sourceId: SourceId
): ID[] {
  return [
    ...getNodeContext(knowledgeDBs, node, sourceId).toArray(),
    getSemanticID(knowledgeDBs, node, sourceId),
  ];
}

// The breadcrumb label used as persisted link text: every segment in
// display form. A calendar feed's raw text is a markdown link carrying
// the feed URL — verbatim inside link text it nests links and makes the
// new row read as the calendar itself.
export function nodePathLabel(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode,
  sourceId: SourceId
): string {
  return getNodeStack(knowledgeDBs, node, sourceId)
    .map((segment) => displayTextOf(segment))
    .join(" / ");
}

export function getNodeDepth(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode,
  sourceId: SourceId
): number {
  return getNodeContext(knowledgeDBs, node, sourceId).size;
}

export function getNode(
  knowledgeDBs: KnowledgeDBs,
  nodeID: ID | undefined,
  sourceId: SourceId
): GraphNode | undefined {
  if (!nodeID) {
    return undefined;
  }
  return knowledgeDBs.get(sourceId)?.nodes.get(nodeID);
}

export function getChildNodes(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode,
  sourceId: SourceId
): List<GraphNode> {
  return node.children.reduce((acc, childID) => {
    const childNode = getNode(knowledgeDBs, childID, sourceId);
    return childNode ? acc.push(childNode) : acc;
  }, List<GraphNode>());
}

export type RefTargetInfo = {
  stack: ID[];
  sourceId: SourceId;
  rootNodeId?: ID;
  scrollToId?: string;
};

export function getRefTargetInfo(
  refId: ID,
  knowledgeDBs: KnowledgeDBs,
  effectiveAuthor: SourceId
): RefTargetInfo | undefined {
  const node = resolveNode(
    knowledgeDBs,
    getNode(knowledgeDBs, refId, effectiveAuthor),
    effectiveAuthor
  );
  if (!node) {
    return undefined;
  }

  const stack = getNodeStack(knowledgeDBs, node, effectiveAuthor);
  return {
    stack,
    sourceId: effectiveAuthor,
    rootNodeId: node.id,
  };
}

function resolveAnyLink(
  knowledgeDBs: KnowledgeDBs,
  documents: Map<string, Document> | undefined,
  documentByFilePath: Map<string, Document> | undefined,
  source: GraphNode | undefined,
  sourceId: SourceId
): { node: GraphNode; sourceId: SourceId } | undefined {
  if (!source) {
    return undefined;
  }
  if (isBlockLink(source)) {
    const target = getTargetNode(knowledgeDBs, source, sourceId);
    return target ? { node: target, sourceId } : undefined;
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
      source,
      sourceId
    );
  }
  return { node: source, sourceId };
}

function resolveFileLinkRootByDocs(
  knowledgeDBs: KnowledgeDBs,
  documents: Map<string, Document>,
  documentByFilePath: Map<string, Document>,
  source: GraphNode,
  sourceId: SourceId
): { node: GraphNode; sourceId: SourceId } | undefined {
  const linkPath = getBlockFileLinkPath(source);
  if (!linkPath) return undefined;
  const sourceRoot =
    source.id === source.root
      ? source
      : getNode(knowledgeDBs, source.root, sourceId);
  const sourceFilePath = sourceRoot?.docId
    ? documents.get(documentKeyOf(sourceId, sourceRoot.docId))?.filePath
    : undefined;
  const resolved = resolveLinkPath(linkPath, sourceFilePath);
  const targetDoc = documentByFilePath.get(resolved);
  if (!targetDoc) return undefined;
  const topNodeShortId = targetDoc.topNodeShortIds[0];
  const targetRoot = topNodeShortId
    ? getNode(knowledgeDBs, topNodeShortId as ID, targetDoc.sourceId)
    : undefined;
  return targetRoot
    ? { node: targetRoot, sourceId: targetDoc.sourceId }
    : undefined;
}

export function getRefLinkTargetInfo(
  refId: ID,
  knowledgeDBs: KnowledgeDBs,
  effectiveAuthor: SourceId,
  documents?: Map<string, Document>,
  documentByFilePath?: Map<string, Document>
): RefTargetInfo | undefined {
  const source = getNode(knowledgeDBs, refId, effectiveAuthor);
  const resolved = resolveAnyLink(
    knowledgeDBs,
    documents,
    documentByFilePath,
    source,
    effectiveAuthor
  );
  if (!resolved) {
    return undefined;
  }
  const { node } = resolved;

  const parentNode = node.parent
    ? getNode(knowledgeDBs, node.parent, resolved.sourceId)
    : undefined;
  const targetRoot = parentNode || node;

  return {
    stack: getNodeStack(knowledgeDBs, targetRoot, resolved.sourceId),
    sourceId: resolved.sourceId,
    rootNodeId: targetRoot.id,
    scrollToId: targetRoot.id === node.id ? undefined : node.id,
  };
}

export function ensureNodeNativeFields(
  db: KnowledgeData,
  node: GraphNode
): GraphNode {
  const existingNode = db.nodes.get(node.id);
  const parent = node.parent || existingNode?.parent;

  if (node.parent === parent) {
    return node;
  }

  return {
    ...node,
    parent,
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
): Map<ID, EmptyNodeData> {
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
  }, Map<ID, EmptyNodeData>());
}

// Inject empty nodes back into nodes based on temporaryEvents
// This is called after processEvents to add empty placeholder nodes
export function injectEmptyNodesIntoKnowledgeDBs(
  knowledgeDBs: KnowledgeDBs,
  temporaryEvents: List<TemporaryEvent>,
  myself: SourceId
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
    const existingNodeID = nodeID;
    const existingNodes = nodes.get(existingNodeID);
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
    return nodes.set(existingNodeID, {
      ...existingNodes,
      children: updatedItems,
    });
  }, myDB.nodes);

  return knowledgeDBs.set(myself, {
    ...myDB,
    nodes: updatedNodes,
  });
}
