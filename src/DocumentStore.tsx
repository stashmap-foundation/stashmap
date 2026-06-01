import React from "react";
import { List, Map as ImmutableMap } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import type { StoredSnapshotRecord } from "./infra/nostr/cache/indexedDB";
import {
  toStoredSnapshotRecord,
  materializeSnapshot,
} from "./infra/snapshotStore";
import {
  GraphDataFields,
  createEmptyGraphData,
  deleteDocument as deleteGraphDocument,
  projectKnowledgeDBs,
  replaceDocument,
} from "./core/graphData";
import { eventToParsed, eventToDocumentDelete } from "./nostrEvents";
import {
  Document,
  DocumentDelete,
  ParsedDocument,
  documentKeyOf,
} from "./core/Document";

export type { Document, DocumentDelete, ParsedDocument };

type DocumentSnapshot = GraphDataFields & {
  deletes: ImmutableMap<DocumentKey, DocumentDelete>;
};

type DocumentStoreState = GraphDataFields & {
  snapshotNodes: SnapshotNodes;
  upsertDocument: (parsed: ParsedDocument) => void;
  deleteDocument: (del: DocumentDelete) => void;
  addEvents: (events: ImmutableMap<string, Event | UnsignedEvent>) => void;
};

const DocumentStoreContext = React.createContext<
  DocumentStoreState | undefined
>(undefined);

function createEmptySnapshot(): DocumentSnapshot {
  return {
    ...createEmptyGraphData(),
    deletes: ImmutableMap<DocumentKey, DocumentDelete>(),
  };
}

function applyDocumentToSnapshot(
  snapshot: DocumentSnapshot,
  parsed: ParsedDocument
): DocumentSnapshot {
  const doc = parsed.document;
  const key = documentKeyOf(doc.author, doc.docId);
  const existingDocument = snapshot.documents.get(key);
  const existingDelete = snapshot.deletes.get(key);

  if (existingDelete && existingDelete.deletedAt >= doc.updatedMs) {
    return snapshot;
  }
  if (existingDocument && existingDocument.updatedMs > doc.updatedMs) {
    return snapshot;
  }

  const nextDeletes =
    existingDelete && doc.updatedMs > existingDelete.deletedAt
      ? snapshot.deletes.remove(key)
      : snapshot.deletes;
  return {
    ...replaceDocument(snapshot, parsed),
    deletes: nextDeletes,
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

  return {
    ...deleteGraphDocument(snapshot, key),
    deletes: snapshot.deletes.set(key, deletion),
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
      nodesByID: activeSnapshot.nodesByID,
      documents: activeSnapshot.documents,
      documentsByFilePath: activeSnapshot.documentsByFilePath,
      incomingCrefs: activeSnapshot.incomingCrefs,
      incomingFileLinks: activeSnapshot.incomingFileLinks,
      basedOnIndex: activeSnapshot.basedOnIndex,
      semantic: activeSnapshot.semantic,
      nodeKeysByDocument: activeSnapshot.nodeKeysByDocument,
      snapshotNodes,
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

export function useDocumentGraphData(): GraphDataFields {
  const ctx = React.useContext(DocumentStoreContext);
  if (!ctx) {
    return createEmptyGraphData();
  }
  return {
    nodesByID: ctx.nodesByID,
    documents: ctx.documents,
    documentsByFilePath: ctx.documentsByFilePath,
    incomingCrefs: ctx.incomingCrefs,
    incomingFileLinks: ctx.incomingFileLinks,
    basedOnIndex: ctx.basedOnIndex,
    semantic: ctx.semantic,
    nodeKeysByDocument: ctx.nodeKeysByDocument,
  };
}

export function useDocumentKnowledgeDBs(): KnowledgeDBs {
  return projectKnowledgeDBs(useDocumentGraphData());
}

export function useDocumentSnapshotNodes(): SnapshotNodes {
  return (
    React.useContext(DocumentStoreContext)?.snapshotNodes || ImmutableMap()
  );
}

export function useDocuments(): ImmutableMap<DocumentKey, Document> {
  return (
    React.useContext(DocumentStoreContext)?.documents ||
    ImmutableMap<DocumentKey, Document>()
  );
}
