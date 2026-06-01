/* eslint-disable functional/immutable-data */
import { Map as ImmutableMap, Set as ImmutableSet } from "immutable";
import { getAllFileLinks, getAllLinks, nodeText } from "./nodeSpans";
import { resolveLinkPath } from "./linkPath";
import { Document, ParsedDocument, documentKeyOf } from "./Document";
import { newDB } from "./knowledge";
import { shortID } from "./connections";

export type GraphDataFields = Pick<
  Data,
  | "nodesByID"
  | "documents"
  | "documentsByFilePath"
  | "incomingCrefs"
  | "incomingFileLinks"
  | "basedOnIndex"
  | "semantic"
  | "nodeKeysByDocument"
>;

export function nodeKeyOf(sourceId: SourceId, id: ID): NodeKey {
  return JSON.stringify([sourceId, shortID(id) as ID]) as NodeKey;
}

export function nodeKeyOfNode(node: GraphNode): NodeKey {
  return nodeKeyOf(node.author as SourceId, node.id as ID);
}

export function parseNodeKey(key: NodeKey): { sourceId: SourceId; id: ID } {
  const [sourceId, id] = JSON.parse(key) as [SourceId, ID];
  return { sourceId, id };
}

export function filePathKeyOf(sourceId: SourceId, path: string): FilePathKey {
  return JSON.stringify([sourceId, path]) as FilePathKey;
}

export function parseFilePathKey(key: FilePathKey): {
  sourceId: SourceId;
  path: string;
} {
  const [sourceId, path] = JSON.parse(key) as [SourceId, string];
  return { sourceId, path };
}

function cloneSetMap<K extends string, V extends string>(
  map: globalThis.Map<K, globalThis.Set<V>>
): globalThis.Map<K, globalThis.Set<V>> {
  return new globalThis.Map<K, globalThis.Set<V>>(
    [...map.entries()].map(([key, values]) => [
      key,
      new globalThis.Set<V>(values),
    ])
  );
}

export function createEmptyGraphData(): GraphDataFields {
  return {
    nodesByID: ImmutableMap<ID, ImmutableMap<SourceId, GraphNode>>(),
    documents: ImmutableMap<DocumentKey, Document>(),
    documentsByFilePath: ImmutableMap<FilePathKey, DocumentKey>(),
    incomingCrefs: new globalThis.Map<NodeKey, globalThis.Set<NodeKey>>(),
    incomingFileLinks: new globalThis.Map<FilePathKey, globalThis.Set<NodeKey>>(),
    basedOnIndex: new globalThis.Map<NodeKey, globalThis.Set<NodeKey>>(),
    semantic: new globalThis.Map<string, globalThis.Set<NodeKey>>(),
    nodeKeysByDocument: new globalThis.Map<DocumentKey, globalThis.Set<NodeKey>>(),
  };
}

function cloneGraphDataIndexFields<T extends GraphDataFields>(data: T): T {
  return {
    ...data,
    incomingCrefs: cloneSetMap(data.incomingCrefs),
    incomingFileLinks: cloneSetMap(data.incomingFileLinks),
    basedOnIndex: cloneSetMap(data.basedOnIndex),
    semantic: cloneSetMap(data.semantic),
    nodeKeysByDocument: cloneSetMap(data.nodeKeysByDocument),
  };
}

function withEmptyIndexFields<T extends GraphDataFields>(data: T): T {
  return {
    ...data,
    incomingCrefs: new globalThis.Map<NodeKey, globalThis.Set<NodeKey>>(),
    incomingFileLinks: new globalThis.Map<FilePathKey, globalThis.Set<NodeKey>>(),
    basedOnIndex: new globalThis.Map<NodeKey, globalThis.Set<NodeKey>>(),
    semantic: new globalThis.Map<string, globalThis.Set<NodeKey>>(),
    nodeKeysByDocument: new globalThis.Map<DocumentKey, globalThis.Set<NodeKey>>(),
  };
}

function reindexAll<T extends GraphDataFields>(data: T): T {
  const next = withEmptyIndexFields(data);
  next.nodesByID.forEach((bySource) => {
    bySource.forEach((node) => addNodeIndexEntries(next, node));
  });
  return next;
}

function addToSetMap<K extends string, V extends string>(
  map: globalThis.Map<K, globalThis.Set<V>>,
  key: K,
  value: V
): void {
  const existing = map.get(key);
  if (existing) {
    existing.add(value);
    return;
  }
  map.set(key, new globalThis.Set<V>([value]));
}

function removeFromSetMap<K extends string, V extends string>(
  map: globalThis.Map<K, globalThis.Set<V>>,
  key: K,
  value: V
): void {
  const existing = map.get(key);
  if (!existing) {
    return;
  }
  existing.delete(value);
  if (existing.size === 0) {
    map.delete(key);
  }
}

export function getNodeFromGraphData(
  data: Pick<GraphDataFields, "nodesByID">,
  id: ID | undefined,
  sourceId: SourceId
): GraphNode | undefined {
  if (!id) {
    return undefined;
  }
  return data.nodesByID.get(shortID(id) as ID)?.get(sourceId);
}

export function getNodeByKey(
  data: Pick<GraphDataFields, "nodesByID">,
  key: NodeKey
): GraphNode | undefined {
  const { sourceId, id } = parseNodeKey(key);
  return getNodeFromGraphData(data, id, sourceId);
}

export function getSourceNodeCandidates(
  data: Pick<GraphDataFields, "nodesByID">,
  id: ID
): { sourceId: SourceId; node: GraphNode }[] {
  return (data.nodesByID.get(shortID(id) as ID) ?? ImmutableMap())
    .entrySeq()
    .map(([sourceId, node]) => ({ sourceId, node }))
    .toArray();
}

export function getNodesForSource(
  data: Pick<GraphDataFields, "nodesByID">,
  sourceId: SourceId
): ImmutableMap<ID, GraphNode> {
  return data.nodesByID.reduce(
    (acc, bySource, id) => {
      const node = bySource.get(sourceId);
      return node ? acc.set(id, node) : acc;
    },
    ImmutableMap<ID, GraphNode>()
  );
}

export function projectKnowledgeDBs(
  data: Pick<GraphDataFields, "nodesByID">
): KnowledgeDBs {
  return data.nodesByID.reduce((dbs, bySource) => {
    return bySource.reduce((acc, node, sourceId) => {
      const db = acc.get(sourceId as PublicKey) ?? newDB();
      return acc.set(sourceId as PublicKey, {
        ...db,
        nodes: db.nodes.set(shortID(node.id), node),
      });
    }, dbs);
  }, ImmutableMap<PublicKey, KnowledgeData>());
}

export function graphDataFromKnowledgeDBs(
  knowledgeDBs: KnowledgeDBs,
  existing: Partial<GraphDataFields> = {}
): GraphDataFields {
  const base: GraphDataFields = {
    ...createEmptyGraphData(),
    ...existing,
    nodesByID: ImmutableMap<ID, ImmutableMap<SourceId, GraphNode>>(),
    incomingCrefs: new globalThis.Map<NodeKey, globalThis.Set<NodeKey>>(),
    incomingFileLinks: new globalThis.Map<FilePathKey, globalThis.Set<NodeKey>>(),
    basedOnIndex: new globalThis.Map<NodeKey, globalThis.Set<NodeKey>>(),
    semantic: new globalThis.Map<string, globalThis.Set<NodeKey>>(),
    nodeKeysByDocument: new globalThis.Map<DocumentKey, globalThis.Set<NodeKey>>(),
  };
  const withNodes = knowledgeDBs.reduce((acc, db) => {
    return db.nodes.reduce((inner, node) => upsertNode(inner, node), acc);
  }, base);
  return reindexAll(withNodes);
}

export function projectDocumentByFilePath(
  data: Pick<
    GraphDataFields,
    "documents" | "documentsByFilePath"
  >
): ImmutableMap<string, Document> {
  return data.documentsByFilePath.reduce((acc, documentKey, filePathKey) => {
    const document = data.documents.get(documentKey);
    if (!document) {
      return acc;
    }
    const { path } = parseFilePathKey(filePathKey);
    return acc.set(path, document);
  }, ImmutableMap<string, Document>());
}

function rootDocumentKeyForNode(
  data: Pick<GraphDataFields, "nodesByID" | "documents">,
  node: GraphNode
): DocumentKey | undefined {
  const docId =
    node.docId ??
    getNodeFromGraphData(data, node.root as ID, node.author as SourceId)?.docId;
  if (docId) {
    return documentKeyOf(node.author, docId);
  }

  const rootShortID = shortID(node.root) as ID;
  return data.documents
    .entrySeq()
    .find(
      ([, document]) =>
        document.author === node.author &&
        document.topNodeShortIds.includes(rootShortID)
    )?.[0];
}

function filePathForNode(
  data: Pick<GraphDataFields, "nodesByID" | "documents">,
  node: GraphNode
): string | undefined {
  const documentKey = rootDocumentKeyForNode(data, node);
  return documentKey ? data.documents.get(documentKey)?.filePath : undefined;
}

function linkTargetNodeKeys<T extends GraphDataFields>(
  data: T,
  node: GraphNode,
  targetID: LongID
): NodeKey[] {
  const target = shortID(targetID) as ID;
  const sourceId = node.author as SourceId;
  const keys: NodeKey[] = [];
  const addKey = (key: NodeKey): void => {
    if (!keys.includes(key)) {
      keys.push(key);
    }
  };
  const exact = getNodeFromGraphData(data, target, sourceId);
  if (exact) {
    addKey(nodeKeyOf(sourceId, target));
  }
  getSourceNodeCandidates(data, target).forEach((candidate) => {
    addKey(nodeKeyOf(candidate.sourceId, target));
  });
  (data.semantic.get(target) ?? new globalThis.Set<NodeKey>()).forEach(
    (key) => {
      if (getNodeByKey(data, key)) {
        addKey(key);
      }
    }
  );
  return keys.length > 0 ? keys : [nodeKeyOf(sourceId, target)];
}

function addNodeLinkEntries<T extends GraphDataFields>(
  data: T,
  node: GraphNode,
  sourceFilePath: string | undefined,
  linkOwnerKey: NodeKey
): void {
  const sourceId = node.author as SourceId;
  getAllLinks(node).forEach(({ targetID }) => {
    linkTargetNodeKeys(data, node, targetID).forEach((targetKey) => {
      addToSetMap(data.incomingCrefs, targetKey, linkOwnerKey);
    });
  });
  getAllFileLinks(node).forEach(({ path }) => {
    const resolved = resolveLinkPath(path, sourceFilePath);
    addToSetMap(
      data.incomingFileLinks,
      filePathKeyOf(sourceId, resolved),
      linkOwnerKey
    );
  });
}

function removeNodeLinkEntries<T extends GraphDataFields>(
  data: T,
  _node: GraphNode,
  _sourceFilePath: string | undefined,
  linkOwnerKey: NodeKey
): void {
  data.incomingCrefs.forEach((_, targetKey) => {
    removeFromSetMap(data.incomingCrefs, targetKey, linkOwnerKey);
  });
  data.incomingFileLinks.forEach((_, filePathKey) => {
    removeFromSetMap(data.incomingFileLinks, filePathKey, linkOwnerKey);
  });
}

function basedOnNodeKeys(
  data: Pick<GraphDataFields, "nodesByID">,
  node: GraphNode
): NodeKey[] {
  if (!node.basedOn) {
    return [];
  }
  const basedOnId = shortID(node.basedOn) as ID;
  const explicitSourceId = node.basedOnSource ?? node.anchor?.sourceAuthor;
  if (explicitSourceId) {
    return [nodeKeyOf(explicitSourceId as SourceId, basedOnId)];
  }
  const candidateKeys = getSourceNodeCandidates(data, basedOnId).map(
    (candidate) => nodeKeyOf(candidate.sourceId, basedOnId)
  );
  return candidateKeys.length > 0
    ? candidateKeys
    : [nodeKeyOf(node.author as SourceId, basedOnId)];
}

function addNodeIndexEntries<T extends GraphDataFields>(
  data: T,
  node: GraphNode
): void {
  const key = nodeKeyOfNode(node);
  const sourceFilePath = filePathForNode(data, node);
  addToSetMap(data.semantic, nodeText(node), key);
  basedOnNodeKeys(data, node).forEach((basedOnKey) => {
    addToSetMap(data.basedOnIndex, basedOnKey, key);
  });

  const documentKey = rootDocumentKeyForNode(data, node);
  if (documentKey) {
    addToSetMap(data.nodeKeysByDocument, documentKey, key);
  }

  if (node.relevance !== "not_relevant") {
    addNodeLinkEntries(data, node, sourceFilePath, key);
  }
}

function removeNodeIndexEntries<T extends GraphDataFields>(
  data: T,
  node: GraphNode
): void {
  const key = nodeKeyOfNode(node);
  const sourceFilePath = filePathForNode(data, node);
  removeFromSetMap(data.semantic, nodeText(node), key);
  basedOnNodeKeys(data, node).forEach((basedOnKey) => {
    removeFromSetMap(data.basedOnIndex, basedOnKey, key);
  });

  const documentKey = rootDocumentKeyForNode(data, node);
  if (documentKey) {
    removeFromSetMap(data.nodeKeysByDocument, documentKey, key);
  }

  if (node.relevance !== "not_relevant") {
    removeNodeLinkEntries(data, node, sourceFilePath, key);
  }
}

function removeNodeFromBasedOnIndex<T extends GraphDataFields>(
  data: T,
  node: GraphNode
): void {
  const key = nodeKeyOfNode(node);
  data.basedOnIndex.forEach((derivedKeys, basedOnKey) => {
    if (derivedKeys.has(key)) {
      removeFromSetMap(data.basedOnIndex, basedOnKey, key);
    }
  });
}

function reindexImplicitBasedOnDependents<T extends GraphDataFields>(
  data: T,
  targetNode: GraphNode
): void {
  const targetID = shortID(targetNode.id);
  data.nodesByID.forEach((bySource) => {
    bySource.forEach((candidate) => {
      if (
        (candidate.basedOn ? shortID(candidate.basedOn) : "") !== targetID ||
        candidate.basedOnSource ||
        candidate.anchor?.sourceAuthor
      ) {
        return;
      }
      removeNodeFromBasedOnIndex(data, candidate);
      basedOnNodeKeys(data, candidate).forEach((basedOnKey) => {
        addToSetMap(data.basedOnIndex, basedOnKey, nodeKeyOfNode(candidate));
      });
    });
  });
}

export function upsertNode<T extends GraphDataFields>(data: T, node: GraphNode): T {
  const sourceId = node.author as SourceId;
  const id = shortID(node.id) as ID;
  const existing = getNodeFromGraphData(data, id, sourceId);
  const withoutExisting = existing ? removeNode(data, nodeKeyOfNode(existing)) : data;
  const next = cloneGraphDataIndexFields(withoutExisting);
  const bySource = next.nodesByID.get(id) ?? ImmutableMap<SourceId, GraphNode>();
  const nodesByID = next.nodesByID.set(id, bySource.set(sourceId, node));
  const withNode = { ...next, nodesByID };
  addNodeIndexEntries(withNode, node);
  reindexImplicitBasedOnDependents(withNode, node);
  return withNode;
}

export function removeNode<T extends GraphDataFields>(data: T, key: NodeKey): T {
  const node = getNodeByKey(data, key);
  if (!node) {
    return data;
  }
  const next = cloneGraphDataIndexFields(data);
  removeNodeIndexEntries(next, node);
  const { sourceId, id } = parseNodeKey(key);
  const bySource = next.nodesByID.get(id);
  const updatedBySource = bySource?.remove(sourceId) ?? ImmutableMap();
  return {
    ...next,
    nodesByID:
      updatedBySource.size === 0
        ? next.nodesByID.remove(id)
        : next.nodesByID.set(id, updatedBySource),
  };
}

export function upsertDocumentMetadata<T extends GraphDataFields>(
  data: T,
  document: Document
): T {
  const key = documentKeyOf(document.author, document.docId);
  const existing = data.documents.get(key);
  const withoutOldPath = existing?.filePath
    ? {
        ...data,
        documentsByFilePath: data.documentsByFilePath.remove(
          filePathKeyOf(existing.author as SourceId, existing.filePath)
        ),
      }
    : data;
  const withDocument = {
    ...withoutOldPath,
    documents: withoutOldPath.documents.set(key, document),
  };
  return document.filePath
    ? {
        ...withDocument,
        documentsByFilePath: withDocument.documentsByFilePath.set(
          filePathKeyOf(document.author as SourceId, document.filePath),
          key
        ),
      }
    : withDocument;
}

export function deleteDocument<T extends GraphDataFields>(
  data: T,
  documentKey: DocumentKey
): T {
  const document = data.documents.get(documentKey);
  const nodeKeys = data.nodeKeysByDocument.get(documentKey);
  const withoutNodes = nodeKeys
    ? [...nodeKeys].reduce((acc, nodeKey) => removeNode(acc, nodeKey), data)
    : data;
  const next = cloneGraphDataIndexFields(withoutNodes);
  next.nodeKeysByDocument.delete(documentKey);
  return {
    ...next,
    documents: next.documents.remove(documentKey),
    documentsByFilePath: document?.filePath
      ? next.documentsByFilePath.remove(
          filePathKeyOf(document.author as SourceId, document.filePath)
        )
      : next.documentsByFilePath,
  };
}

export function replaceDocument<T extends GraphDataFields>(
  data: T,
  parsed: ParsedDocument
): T {
  const key = documentKeyOf(parsed.document.author, parsed.document.docId);
  const withoutExisting = deleteDocument(data, key);
  const withDocument = upsertDocumentMetadata(withoutExisting, parsed.document);
  const withNodes = parsed.nodes.reduce(
    (acc, node) => upsertNode(acc, node),
    withDocument
  );
  return reindexAll(withNodes);
}

export function mergeGraphData(
  left: GraphDataFields,
  right: GraphDataFields
): GraphDataFields {
  const withDocuments = right.documents.reduce(
    (acc, document) => upsertDocumentMetadata(acc, document),
    left
  );
  const withNodes = right.nodesByID.reduce((acc, bySource) => {
    return bySource.reduce((inner, node) => upsertNode(inner, node), acc);
  }, withDocuments);
  return reindexAll(withNodes);
}

export function affectedDocumentsForNodes(
  nodes: Iterable<GraphNode>
): ImmutableSet<string> {
  return ImmutableSet<string>(
    [...nodes].flatMap((node) => (node.docId ? [node.docId] : []))
  );
}
