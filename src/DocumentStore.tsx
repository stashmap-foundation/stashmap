import React from "react";
import { List, Map as ImmutableMap } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import type { StoredSnapshotRecord } from "./infra/nostr/cache/indexedDB";
import {
  toStoredSnapshotRecord,
  materializeSnapshot,
} from "./infra/snapshotStore";
import {
  addNodesToSemanticIndex,
  createEmptySemanticIndex,
  removeNodesFromSemanticIndex,
} from "./semanticIndex";
import { eventToParsed, eventToDocumentDelete } from "./nostrEvents";
import {
  Document,
  DocumentDelete,
  ParsedDocument,
  documentKeyOf,
} from "./core/Document";
import { joinID } from "./core/connections";
import { newDB } from "./core/knowledge";

export type { Document, DocumentDelete, ParsedDocument };

type DocumentSnapshot = {
  documents: ImmutableMap<string, Document>;
  documentByFilePath: ImmutableMap<string, Document>;
  deletes: ImmutableMap<string, DocumentDelete>;
  knowledgeDBs: KnowledgeDBs;
  semanticIndex: SemanticIndex;
};

type DocumentStoreState = {
  knowledgeDBs: KnowledgeDBs;
  semanticIndex: SemanticIndex;
  snapshotNodes: SnapshotNodes;
  documents: ImmutableMap<string, Document>;
  documentByFilePath: ImmutableMap<string, Document>;
  upsertDocument: (parsed: ParsedDocument) => void;
  deleteDocument: (del: DocumentDelete) => void;
  addEvents: (events: ImmutableMap<string, Event | UnsignedEvent>) => void;
};

const DocumentStoreContext = React.createContext<
  DocumentStoreState | undefined
>(undefined);

function createEmptySnapshot(): DocumentSnapshot {
  return {
    documents: ImmutableMap<string, Document>(),
    documentByFilePath: ImmutableMap<string, Document>(),
    deletes: ImmutableMap<string, DocumentDelete>(),
    knowledgeDBs: ImmutableMap<PublicKey, KnowledgeData>(),
    semanticIndex: createEmptySemanticIndex(),
  };
}

function nodesForRoot(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  rootShortId: string
): ImmutableMap<string, GraphNode> {
  const nodes = knowledgeDBs.get(author)?.nodes;
  if (!nodes) return ImmutableMap<string, GraphNode>();
  const rootLongId = joinID(author, rootShortId);
  return nodes.filter((node) => node.root === rootLongId);
}

function withoutDocNodes(
  knowledgeDBs: KnowledgeDBs,
  doc: Document | undefined
): KnowledgeDBs {
  if (!doc?.rootShortId) return knowledgeDBs;
  const db = knowledgeDBs.get(doc.author);
  if (!db) return knowledgeDBs;
  const rootLongId = joinID(doc.author, doc.rootShortId);
  const filtered = db.nodes.filter((node) => node.root !== rootLongId);
  return filtered.size === 0
    ? knowledgeDBs.remove(doc.author)
    : knowledgeDBs.set(doc.author, { ...db, nodes: filtered });
}

function withDocNodes(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  nodes: ImmutableMap<string, GraphNode>
): KnowledgeDBs {
  if (nodes.size === 0) return knowledgeDBs;
  const db = knowledgeDBs.get(author) ?? newDB();
  return knowledgeDBs.set(author, { ...db, nodes: db.nodes.merge(nodes) });
}

function withDocumentInFilePathIndex(
  index: ImmutableMap<string, Document>,
  doc: Document
): ImmutableMap<string, Document> {
  return doc.filePath ? index.set(doc.filePath, doc) : index;
}

function withoutDocumentInFilePathIndex(
  index: ImmutableMap<string, Document>,
  doc: Document | undefined
): ImmutableMap<string, Document> {
  if (!doc?.filePath) return index;
  const current = index.get(doc.filePath);
  if (current && current.docId === doc.docId) {
    return index.remove(doc.filePath);
  }
  return index;
}

function applyDocumentToSnapshot(
  snapshot: DocumentSnapshot,
  parsed: ParsedDocument
): DocumentSnapshot {
  const doc = parsed.document;
  const key = documentKeyOf(doc.author, doc.docId);
  const existingDocument = snapshot.documents.get(key);
  const existingDelete = snapshot.deletes.get(key);

  // eslint-disable-next-line no-console
  console.log("[apply]", {
    key,
    docTitle: doc.title,
    docRootShortId: doc.rootShortId,
    existingTitle: existingDocument?.title,
    existingRootShortId: existingDocument?.rootShortId,
    docUpdatedMs: doc.updatedMs,
    existingUpdatedMs: existingDocument?.updatedMs,
    nodeCount: parsed.nodes.size,
  });

  if (existingDelete && existingDelete.deletedAt >= doc.updatedMs) {
    return snapshot;
  }
  if (existingDocument && existingDocument.updatedMs >= doc.updatedMs) {
    return snapshot;
  }

  const existingNodes = existingDocument?.rootShortId
    ? nodesForRoot(
        snapshot.knowledgeDBs,
        existingDocument.author,
        existingDocument.rootShortId
      )
    : ImmutableMap<string, GraphNode>();
  const nextDeletes =
    existingDelete && doc.updatedMs > existingDelete.deletedAt
      ? snapshot.deletes.remove(key)
      : snapshot.deletes;
  const withoutExistingNodes =
    existingNodes.size > 0
      ? removeNodesFromSemanticIndex(
          snapshot.semanticIndex,
          existingNodes,
          existingDocument?.filePath
        )
      : snapshot.semanticIndex;
  const documentByFilePathAfterRemove = withoutDocumentInFilePathIndex(
    snapshot.documentByFilePath,
    existingDocument
  );
  const knowledgeDBsAfterRemove = withoutDocNodes(
    snapshot.knowledgeDBs,
    existingDocument
  );
  const knowledgeDBs = withDocNodes(
    knowledgeDBsAfterRemove,
    doc.author,
    parsed.nodes
  );
  return {
    documents: snapshot.documents.set(key, doc),
    documentByFilePath: withDocumentInFilePathIndex(
      documentByFilePathAfterRemove,
      doc
    ),
    deletes: nextDeletes,
    knowledgeDBs,
    semanticIndex: addNodesToSemanticIndex(
      withoutExistingNodes,
      parsed.nodes,
      doc.filePath
    ),
  };
}

function applyDeleteToSnapshot(
  snapshot: DocumentSnapshot,
  deletion: DocumentDelete
): DocumentSnapshot {
  const key = documentKeyOf(deletion.author, deletion.docId);
  const existingDocument = snapshot.documents.get(key);
  const existingDelete = snapshot.deletes.get(key);

  if (existingDelete && existingDelete.deletedAt >= deletion.deletedAt) {
    return snapshot;
  }

  const willDelete =
    !!existingDocument && existingDocument.updatedMs <= deletion.deletedAt;
  if (!willDelete) {
    return { ...snapshot, deletes: snapshot.deletes.set(key, deletion) };
  }
  const existingNodes = existingDocument.rootShortId
    ? nodesForRoot(
        snapshot.knowledgeDBs,
        existingDocument.author,
        existingDocument.rootShortId
      )
    : ImmutableMap<string, GraphNode>();
  return {
    documents: snapshot.documents.remove(key),
    documentByFilePath: withoutDocumentInFilePathIndex(
      snapshot.documentByFilePath,
      existingDocument
    ),
    deletes: snapshot.deletes.set(key, deletion),
    knowledgeDBs: withoutDocNodes(snapshot.knowledgeDBs, existingDocument),
    semanticIndex:
      existingNodes.size > 0
        ? removeNodesFromSemanticIndex(
            snapshot.semanticIndex,
            existingNodes,
            existingDocument.filePath
          )
        : snapshot.semanticIndex,
  };
}

function applyRecordsToSnapshot(
  snapshot: DocumentSnapshot,
  records: ReadonlyArray<ParsedDocument>,
  deletes: ReadonlyArray<DocumentDelete>
): DocumentSnapshot {
  const withDocuments = records.reduce(
    (acc, parsed) => applyDocumentToSnapshot(acc, parsed),
    snapshot
  );
  return deletes.reduce(
    (acc, deletion) => applyDeleteToSnapshot(acc, deletion),
    withDocuments
  );
}

function eventsToParsed(events: ReadonlyArray<Event | UnsignedEvent>): {
  readonly records: ReadonlyArray<ParsedDocument>;
  readonly deletes: ReadonlyArray<DocumentDelete>;
} {
  return {
    records: events
      .map((event) => eventToParsed(event))
      .filter((parsed): parsed is ParsedDocument => parsed !== undefined),
    deletes: events
      .map((event) => eventToDocumentDelete(event))
      .filter((del): del is DocumentDelete => del !== undefined),
  };
}

export function DocumentStoreProvider({
  children,
  unpublishedEvents = List<UnsignedEvent>(),
  initialDocuments = [],
}: {
  children: React.ReactNode;
  unpublishedEvents?: List<UnsignedEvent>;
  initialDocuments?: ReadonlyArray<ParsedDocument>;
}): JSX.Element {
  const [snapshot, setSnapshot] = React.useState<DocumentSnapshot>(() =>
    applyRecordsToSnapshot(createEmptySnapshot(), initialDocuments, [])
  );
  const [snapshotNodes, setSnapshotNodes] = React.useState<SnapshotNodes>(
    ImmutableMap()
  );

  const upsertDocument = React.useCallback((parsed: ParsedDocument) => {
    setSnapshot((current) => applyDocumentToSnapshot(current, parsed));
  }, []);

  const deleteDocument = React.useCallback((del: DocumentDelete) => {
    setSnapshot((current) => applyDeleteToSnapshot(current, del));
  }, []);

  const addEvents = React.useCallback(
    (events: ImmutableMap<string, Event | UnsignedEvent>) => {
      const eventList = events.valueSeq().toArray();
      const { records, deletes } = eventsToParsed(eventList);

      const snapshotRecords = eventList
        .map((event) => toStoredSnapshotRecord(event))
        .filter(
          (record): record is StoredSnapshotRecord => record !== undefined
        );

      if (snapshotRecords.length > 0) {
        setSnapshotNodes((prev) =>
          snapshotRecords.reduce((acc, record) => {
            if (acc.has(record.dTag)) {
              return acc;
            }
            return acc.set(record.dTag, materializeSnapshot(record));
          }, prev)
        );
      }

      if (records.length === 0 && deletes.length === 0) {
        return;
      }

      setSnapshot((current) =>
        applyRecordsToSnapshot(current, records, deletes)
      );
    },
    []
  );

  const activeSnapshot = React.useMemo(() => {
    const eventList = unpublishedEvents.toArray();
    const { records, deletes } = eventsToParsed(eventList);
    return applyRecordsToSnapshot(snapshot, records, deletes);
  }, [snapshot, unpublishedEvents]);

  React.useEffect(() => {
    setSnapshotNodes((prev) =>
      unpublishedEvents.reduce((acc, event) => {
        const record = toStoredSnapshotRecord(event);
        if (!record || acc.has(record.dTag)) {
          return acc;
        }
        return acc.set(record.dTag, materializeSnapshot(record));
      }, prev)
    );
  }, [unpublishedEvents]);

  const contextValue = React.useMemo(
    () => ({
      knowledgeDBs: activeSnapshot.knowledgeDBs,
      semanticIndex: activeSnapshot.semanticIndex,
      snapshotNodes,
      documents: activeSnapshot.documents,
      documentByFilePath: activeSnapshot.documentByFilePath,
      upsertDocument,
      deleteDocument,
      addEvents,
    }),
    [activeSnapshot, upsertDocument, deleteDocument, addEvents, snapshotNodes]
  );

  return (
    <DocumentStoreContext.Provider value={contextValue}>
      {children}
    </DocumentStoreContext.Provider>
  );
}

export function useDocumentStore(): DocumentStoreState | undefined {
  return React.useContext(DocumentStoreContext);
}

export function useDocumentKnowledgeDBs(): KnowledgeDBs {
  return React.useContext(DocumentStoreContext)?.knowledgeDBs || ImmutableMap();
}

export function useDocumentSemanticIndex(): SemanticIndex {
  return (
    React.useContext(DocumentStoreContext)?.semanticIndex ||
    createEmptySemanticIndex()
  );
}

export function useDocumentSnapshotNodes(): SnapshotNodes {
  return (
    React.useContext(DocumentStoreContext)?.snapshotNodes || ImmutableMap()
  );
}

export function useDocuments(): ImmutableMap<string, Document> {
  return (
    React.useContext(DocumentStoreContext)?.documents ||
    ImmutableMap<string, Document>()
  );
}

export function useDocumentByFilePath(): ImmutableMap<string, Document> {
  const ctx = React.useContext(DocumentStoreContext);
  if (!ctx) {
    throw new Error("useDocumentByFilePath used outside DocumentStoreProvider");
  }
  return ctx.documentByFilePath;
}
