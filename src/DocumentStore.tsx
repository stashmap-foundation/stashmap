import React from "react";
import { List, Map as ImmutableMap } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import type { StoredSnapshotRecord } from "./infra/nostr/cache/indexedDB";
import { buildKnowledgeDBFromDocumentNodes } from "./documentMaterialization";
import { parseDocumentContent } from "./markdownNodes";
import {
  toStoredSnapshotRecord,
  materializeSnapshot,
} from "./infra/snapshotStore";
import {
  addNodesToSemanticIndex,
  createEmptySemanticIndex,
  removeNodesFromSemanticIndex,
} from "./semanticIndex";
import { eventToDocument, eventToDocumentDelete } from "./nostrEvents";
import { Document, DocumentDelete, documentKeyOf } from "./Document";

export type { Document, DocumentDelete };

type DocumentSnapshot = {
  documents: ImmutableMap<string, Document>;
  documentByFilePath: ImmutableMap<string, Document>;
  deletes: ImmutableMap<string, DocumentDelete>;
  nodesByDocumentKey: ImmutableMap<string, ImmutableMap<string, GraphNode>>;
  knowledgeDBs: KnowledgeDBs;
  semanticIndex: SemanticIndex;
};

type DocumentStoreState = {
  knowledgeDBs: KnowledgeDBs;
  semanticIndex: SemanticIndex;
  snapshotNodes: SnapshotNodes;
  documents: ImmutableMap<string, Document>;
  documentByFilePath: ImmutableMap<string, Document>;
  upsertDocument: (doc: Document) => void;
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
    nodesByDocumentKey: ImmutableMap<string, ImmutableMap<string, GraphNode>>(),
    knowledgeDBs: ImmutableMap<PublicKey, KnowledgeData>(),
    semanticIndex: createEmptySemanticIndex(),
  };
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

function parseDocumentNodes(doc: Document): ImmutableMap<string, GraphNode> {
  return parseDocumentContent({
    content: doc.content,
    author: doc.author,
    docId: doc.docId,
    updatedMs: doc.updatedMs,
    ...(doc.systemRole !== undefined && { systemRole: doc.systemRole }),
  });
}

function getAuthorDocumentNodes(
  snapshot: DocumentSnapshot,
  author: PublicKey
): ImmutableMap<string, GraphNode> {
  return snapshot.documents.entrySeq().reduce((acc, [key, doc]) => {
    if (doc.author !== author) {
      return acc;
    }
    return acc.merge(
      snapshot.nodesByDocumentKey.get(key) || ImmutableMap<string, GraphNode>()
    );
  }, ImmutableMap<string, GraphNode>());
}

function rebuildAuthors(
  snapshot: DocumentSnapshot,
  authors: ReadonlyArray<PublicKey>
): KnowledgeDBs {
  const authorSet = new Set(authors);
  return [...authorSet].reduce((acc, author) => {
    const authorNodes = getAuthorDocumentNodes(snapshot, author);
    const nextKnowledgeDB = buildKnowledgeDBFromDocumentNodes(
      author,
      authorNodes
    );
    return nextKnowledgeDB
      ? acc.set(author, nextKnowledgeDB)
      : acc.remove(author);
  }, snapshot.knowledgeDBs);
}

function applyDocumentToSnapshot(
  snapshot: DocumentSnapshot,
  doc: Document
): DocumentSnapshot {
  const key = documentKeyOf(doc.author, doc.docId);
  const nextNodes = parseDocumentNodes(doc);
  const existingDocument = snapshot.documents.get(key);
  const existingDelete = snapshot.deletes.get(key);
  const existingNodes =
    snapshot.nodesByDocumentKey.get(key) || ImmutableMap<string, GraphNode>();

  if (existingDelete && existingDelete.deletedAt >= doc.updatedMs) {
    return snapshot;
  }
  if (existingDocument && existingDocument.updatedMs >= doc.updatedMs) {
    return snapshot;
  }

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
  const nextSnapshotBase = {
    ...snapshot,
    documents: snapshot.documents.set(key, doc),
    documentByFilePath: withDocumentInFilePathIndex(
      documentByFilePathAfterRemove,
      doc
    ),
    deletes: nextDeletes,
    nodesByDocumentKey: snapshot.nodesByDocumentKey.set(key, nextNodes),
    semanticIndex: addNodesToSemanticIndex(
      withoutExistingNodes,
      nextNodes,
      doc.filePath
    ),
  };
  const knowledgeDBs = rebuildAuthors(nextSnapshotBase, [doc.author]);
  return {
    ...nextSnapshotBase,
    knowledgeDBs,
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
  const nextSnapshot = {
    ...snapshot,
    documents: willDelete ? snapshot.documents.remove(key) : snapshot.documents,
    documentByFilePath: willDelete
      ? withoutDocumentInFilePathIndex(
          snapshot.documentByFilePath,
          existingDocument
        )
      : snapshot.documentByFilePath,
    deletes: snapshot.deletes.set(key, deletion),
    nodesByDocumentKey: willDelete
      ? snapshot.nodesByDocumentKey.remove(key)
      : snapshot.nodesByDocumentKey,
    semanticIndex: willDelete
      ? removeNodesFromSemanticIndex(
          snapshot.semanticIndex,
          snapshot.nodesByDocumentKey.get(key) ||
            ImmutableMap<string, GraphNode>(),
          existingDocument?.filePath
        )
      : snapshot.semanticIndex,
  };
  const affectedAuthor = existingDocument?.author || deletion.author;
  return {
    ...nextSnapshot,
    knowledgeDBs: rebuildAuthors(nextSnapshot, [affectedAuthor]),
  };
}

function applyRecordsToSnapshot(
  snapshot: DocumentSnapshot,
  documents: ReadonlyArray<Document>,
  deletes: ReadonlyArray<DocumentDelete>
): DocumentSnapshot {
  const withDocuments = documents.reduce(
    (acc, doc) => applyDocumentToSnapshot(acc, doc),
    snapshot
  );
  return deletes.reduce(
    (acc, deletion) => applyDeleteToSnapshot(acc, deletion),
    withDocuments
  );
}

function eventsToDocuments(events: ReadonlyArray<Event | UnsignedEvent>): {
  readonly documents: ReadonlyArray<Document>;
  readonly deletes: ReadonlyArray<DocumentDelete>;
} {
  return {
    documents: events
      .map((event) => eventToDocument(event))
      .filter((doc): doc is Document => doc !== undefined),
    deletes: events
      .map((event) => eventToDocumentDelete(event))
      .filter((del): del is DocumentDelete => del !== undefined),
  };
}

export function DocumentStoreProvider({
  children,
  unpublishedEvents = List<UnsignedEvent>(),
}: {
  children: React.ReactNode;
  unpublishedEvents?: List<UnsignedEvent>;
}): JSX.Element {
  const [snapshot, setSnapshot] =
    React.useState<DocumentSnapshot>(createEmptySnapshot);
  const [snapshotNodes, setSnapshotNodes] = React.useState<SnapshotNodes>(
    ImmutableMap()
  );

  const upsertDocument = React.useCallback((doc: Document) => {
    setSnapshot((current) => applyDocumentToSnapshot(current, doc));
  }, []);

  const deleteDocument = React.useCallback((del: DocumentDelete) => {
    setSnapshot((current) => applyDeleteToSnapshot(current, del));
  }, []);

  const addEvents = React.useCallback(
    (events: ImmutableMap<string, Event | UnsignedEvent>) => {
      const eventList = events.valueSeq().toArray();
      const { documents, deletes } = eventsToDocuments(eventList);

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

      if (documents.length === 0 && deletes.length === 0) {
        return;
      }

      setSnapshot((current) =>
        applyRecordsToSnapshot(current, documents, deletes)
      );
    },
    []
  );

  const activeSnapshot = React.useMemo(() => {
    const eventList = unpublishedEvents.toArray();
    const { documents, deletes } = eventsToDocuments(eventList);
    return applyRecordsToSnapshot(snapshot, documents, deletes);
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
