import React from "react";
import { List, Map as ImmutableMap } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import type {
  DocumentStoreChange,
  StashmapDB,
  StoredDeleteRecord,
  StoredDocumentRecord,
} from "./indexedDB";
import {
  getCachedEvents,
  getStoredDeletes,
  getStoredDocuments,
  putCachedEvents,
  subscribeDocumentStore,
} from "./indexedDB";
import {
  buildKnowledgeDBFromDocumentRelations,
  storedDocumentToEvent,
} from "./documentMaterialization";
import {
  applyStoredDelete,
  applyStoredDocument,
  toStoredDeleteRecord,
  toStoredDocumentRecord,
} from "./permanentSync";
import { parseDocumentEvent } from "./markdownRelations";
import {
  addRelationsToSemanticIndex,
  buildSemanticIndexFromDocuments,
  createEmptySemanticIndex,
  removeRelationsFromSemanticIndex,
} from "./semanticIndex";

type DocumentSnapshot = {
  documents: ImmutableMap<string, StoredDocumentRecord>;
  deletes: ImmutableMap<string, StoredDeleteRecord>;
  relationsByDocumentKey: ImmutableMap<string, ImmutableMap<string, Relations>>;
  knowledgeDBs: KnowledgeDBs;
  semanticIndex: SemanticIndex;
};

type DocumentStoreState = {
  knowledgeDBs: KnowledgeDBs;
  semanticIndex: SemanticIndex;
  addEvents: (events: ImmutableMap<string, Event | UnsignedEvent>) => void;
};

const DocumentStoreContext = React.createContext<
  DocumentStoreState | undefined
>(undefined);

function createEmptySnapshot(): DocumentSnapshot {
  return {
    documents: ImmutableMap<string, StoredDocumentRecord>(),
    deletes: ImmutableMap<string, StoredDeleteRecord>(),
    relationsByDocumentKey: ImmutableMap<
      string,
      ImmutableMap<string, Relations>
    >(),
    knowledgeDBs: ImmutableMap<PublicKey, KnowledgeData>(),
    semanticIndex: createEmptySemanticIndex(),
  };
}

function parseStoredDocumentRelations(
  document: StoredDocumentRecord
): ImmutableMap<string, Relations> {
  return parseDocumentEvent(storedDocumentToEvent(document));
}

function getAuthorDocumentRelations(
  snapshot: DocumentSnapshot,
  author: PublicKey
): ImmutableMap<string, Relations> {
  return snapshot.documents.valueSeq().reduce((acc, document) => {
    if (document.author !== author) {
      return acc;
    }
    return acc.merge(
      snapshot.relationsByDocumentKey.get(document.replaceableKey) ||
        ImmutableMap<string, Relations>()
    );
  }, ImmutableMap<string, Relations>());
}

function rebuildAuthors(
  snapshot: DocumentSnapshot,
  authors: ReadonlyArray<PublicKey>
): KnowledgeDBs {
  const authorSet = new Set(authors);
  return [...authorSet].reduce((acc, author) => {
    const authorRelations = getAuthorDocumentRelations(snapshot, author);
    const nextKnowledgeDB = buildKnowledgeDBFromDocumentRelations(
      author,
      authorRelations
    );
    return nextKnowledgeDB
      ? acc.set(author, nextKnowledgeDB)
      : acc.remove(author);
  }, snapshot.knowledgeDBs);
}

function applyDocumentToSnapshot(
  snapshot: DocumentSnapshot,
  document: StoredDocumentRecord
): DocumentSnapshot {
  const nextRelations = parseStoredDocumentRelations(document);
  const existingDocument = snapshot.documents.get(document.replaceableKey);
  const existingDelete = snapshot.deletes.get(document.replaceableKey);
  const existingRelations =
    snapshot.relationsByDocumentKey.get(document.replaceableKey) ||
    ImmutableMap<string, Relations>();

  if (existingDelete && existingDelete.deletedAt >= document.updatedMs) {
    return snapshot;
  }
  if (existingDocument && existingDocument.updatedMs >= document.updatedMs) {
    return snapshot;
  }

  const nextDeletes =
    existingDelete && document.updatedMs > existingDelete.deletedAt
      ? snapshot.deletes.remove(document.replaceableKey)
      : snapshot.deletes;
  const withoutExistingRelations =
    existingRelations.size > 0
      ? removeRelationsFromSemanticIndex(
          snapshot.semanticIndex,
          existingRelations
        )
      : snapshot.semanticIndex;
  const nextSnapshotBase = {
    ...snapshot,
    documents: snapshot.documents.set(document.replaceableKey, document),
    deletes: nextDeletes,
    relationsByDocumentKey: snapshot.relationsByDocumentKey.set(
      document.replaceableKey,
      nextRelations
    ),
    semanticIndex: addRelationsToSemanticIndex(
      withoutExistingRelations,
      nextRelations
    ),
  };
  const knowledgeDBs = rebuildAuthors(nextSnapshotBase, [document.author]);
  return {
    ...nextSnapshotBase,
    knowledgeDBs,
  };
}

function applyDeleteToSnapshot(
  snapshot: DocumentSnapshot,
  deletion: StoredDeleteRecord
): DocumentSnapshot {
  const existingDocument = snapshot.documents.get(deletion.replaceableKey);
  const existingDelete = snapshot.deletes.get(deletion.replaceableKey);

  if (existingDelete && existingDelete.deletedAt >= deletion.deletedAt) {
    return snapshot;
  }

  const nextSnapshot = {
    ...snapshot,
    documents:
      existingDocument && existingDocument.updatedMs <= deletion.deletedAt
        ? snapshot.documents.remove(deletion.replaceableKey)
        : snapshot.documents,
    deletes: snapshot.deletes.set(deletion.replaceableKey, deletion),
    relationsByDocumentKey:
      existingDocument && existingDocument.updatedMs <= deletion.deletedAt
        ? snapshot.relationsByDocumentKey.remove(deletion.replaceableKey)
        : snapshot.relationsByDocumentKey,
    semanticIndex:
      existingDocument && existingDocument.updatedMs <= deletion.deletedAt
        ? removeRelationsFromSemanticIndex(
            snapshot.semanticIndex,
            snapshot.relationsByDocumentKey.get(deletion.replaceableKey) ||
              ImmutableMap<string, Relations>()
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
  documents: ReadonlyArray<StoredDocumentRecord>,
  deletes: ReadonlyArray<StoredDeleteRecord>
): DocumentSnapshot {
  const withDocuments = documents.reduce(
    (acc, document) => applyDocumentToSnapshot(acc, document),
    snapshot
  );
  return deletes.reduce(
    (acc, deletion) => applyDeleteToSnapshot(acc, deletion),
    withDocuments
  );
}

function applyChangeToSnapshot(
  snapshot: DocumentSnapshot,
  change: DocumentStoreChange
): DocumentSnapshot {
  if (change.type === "document-put") {
    return applyDocumentToSnapshot(snapshot, change.document);
  }
  if (change.type === "delete-put") {
    return applyDeleteToSnapshot(snapshot, change.deletion);
  }
  if (change.type === "document-remove") {
    const existingDocument = snapshot.documents.get(change.replaceableKey);
    const existingRelations =
      snapshot.relationsByDocumentKey.get(change.replaceableKey) ||
      ImmutableMap<string, Relations>();
    if (!existingDocument) {
      return snapshot;
    }
    const nextSnapshot = {
      ...snapshot,
      documents: snapshot.documents.remove(change.replaceableKey),
      relationsByDocumentKey: snapshot.relationsByDocumentKey.remove(
        change.replaceableKey
      ),
      semanticIndex: removeRelationsFromSemanticIndex(
        snapshot.semanticIndex,
        existingRelations
      ),
    };
    return {
      ...nextSnapshot,
      knowledgeDBs: rebuildAuthors(nextSnapshot, [existingDocument.author]),
    };
  }
  const existingDelete = snapshot.deletes.get(change.replaceableKey);
  if (!existingDelete) {
    return snapshot;
  }
  return {
    ...snapshot,
    deletes: snapshot.deletes.remove(change.replaceableKey),
  };
}

function createSnapshotFromStoredRecords(
  documents: ReadonlyArray<StoredDocumentRecord>,
  deletes: ReadonlyArray<StoredDeleteRecord>
): DocumentSnapshot {
  const latestDocuments = documents.reduce((acc, document) => {
    const existing = acc.get(document.replaceableKey);
    if (!existing || document.updatedMs > existing.updatedMs) {
      return acc.set(document.replaceableKey, document);
    }
    return acc;
  }, ImmutableMap<string, StoredDocumentRecord>());
  const latestDeletes = deletes.reduce((acc, deletion) => {
    const existing = acc.get(deletion.replaceableKey);
    if (!existing || deletion.deletedAt > existing.deletedAt) {
      return acc.set(deletion.replaceableKey, deletion);
    }
    return acc;
  }, ImmutableMap<string, StoredDeleteRecord>());
  const liveDocuments = latestDocuments.filter((document) => {
    const deletion = latestDeletes.get(document.replaceableKey);
    return !deletion || document.updatedMs > deletion.deletedAt;
  });
  const relationsByDocumentKey = ImmutableMap<
    string,
    ImmutableMap<string, Relations>
  >(
    liveDocuments
      .valueSeq()
      .map(
        (document) =>
          [document.replaceableKey, parseStoredDocumentRelations(document)] as [
            string,
            ImmutableMap<string, Relations>
          ]
      )
      .toArray()
  );
  const baseSnapshot = {
    documents: liveDocuments,
    deletes: latestDeletes,
    relationsByDocumentKey,
    knowledgeDBs: ImmutableMap<PublicKey, KnowledgeData>(),
    semanticIndex: buildSemanticIndexFromDocuments(relationsByDocumentKey),
  };
  const authors = [
    ...new Set(
      liveDocuments
        .valueSeq()
        .map((document) => document.author)
        .toArray()
    ),
  ];
  return {
    ...baseSnapshot,
    knowledgeDBs: rebuildAuthors(baseSnapshot, authors),
  };
}

function eventsToStoredRecords(events: ReadonlyArray<Event | UnsignedEvent>): {
  readonly documents: ReadonlyArray<StoredDocumentRecord>;
  readonly deletes: ReadonlyArray<StoredDeleteRecord>;
} {
  return {
    documents: events
      .map((event) => toStoredDocumentRecord(event))
      .filter((record): record is StoredDocumentRecord => record !== undefined),
    deletes: events
      .map((event) => toStoredDeleteRecord(event))
      .filter((record): record is StoredDeleteRecord => record !== undefined),
  };
}

function normalizeCachedEventRecord(
  event: Event | UnsignedEvent
): Record<string, unknown> | undefined {
  if ("id" in event && typeof event.id === "string") {
    return event as unknown as Record<string, unknown>;
  }
  const document = toStoredDocumentRecord(event);
  if (document) {
    return {
      ...event,
      id: document.eventId,
    };
  }
  const deletion = toStoredDeleteRecord(event);
  if (deletion) {
    return {
      ...event,
      id: deletion.eventId,
    };
  }
  return undefined;
}

export function DocumentStoreProvider({
  children,
  db,
  unpublishedEvents = List<UnsignedEvent>(),
}: {
  children: React.ReactNode;
  db?: StashmapDB | null;
  unpublishedEvents?: List<UnsignedEvent>;
}): JSX.Element {
  const [snapshot, setSnapshot] =
    React.useState<DocumentSnapshot>(createEmptySnapshot);
  const persistedUnpublishedKeysRef = React.useRef<globalThis.Set<string>>(
    new globalThis.Set<string>()
  );

  React.useEffect(() => {
    if (!db) {
      return () => {};
    }
    const controller = new AbortController();
    const loadDocuments =
      (typeof getStoredDocuments === "function"
        ? getStoredDocuments(db)
        : undefined) || Promise.resolve([]);
    const loadDeletes =
      (typeof getStoredDeletes === "function"
        ? getStoredDeletes(db)
        : undefined) || Promise.resolve([]);
    Promise.all([loadDocuments, loadDeletes]).then(([documents, deletes]) => {
      if (controller.signal.aborted) {
        return;
      }
      if ((documents || []).length === 0 && (deletes || []).length === 0) {
        const loadCachedEvents =
          (typeof getCachedEvents === "function"
            ? getCachedEvents(db)
            : undefined) || Promise.resolve([]);
        loadCachedEvents.then((cachedEvents) => {
          if (controller.signal.aborted) {
            return;
          }
          const { documents: cachedDocuments, deletes: cachedDeletes } =
            eventsToStoredRecords(
              (cachedEvents || []) as ReadonlyArray<Event | UnsignedEvent>
            );
          setSnapshot(
            createSnapshotFromStoredRecords(cachedDocuments, cachedDeletes)
          );
        });
        return;
      }
      setSnapshot(
        createSnapshotFromStoredRecords(documents || [], deletes || [])
      );
    });
    const unsubscribeResult =
      typeof subscribeDocumentStore === "function"
        ? subscribeDocumentStore(db, (change) => {
            if (controller.signal.aborted) {
              return;
            }
            setSnapshot((current) => applyChangeToSnapshot(current, change));
          })
        : undefined;
    const unsubscribe =
      typeof unsubscribeResult === "function" ? unsubscribeResult : () => {};
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [db]);

  const addEvents = React.useCallback(
    (events: ImmutableMap<string, Event | UnsignedEvent>) => {
      const eventList = events.valueSeq().toArray();
      const { documents, deletes } = eventsToStoredRecords(eventList);

      if (documents.length === 0 && deletes.length === 0) {
        return;
      }

      if (!db) {
        setSnapshot((current) =>
          applyRecordsToSnapshot(current, documents, deletes)
        );
        return;
      }

      documents.forEach((document) => {
        applyStoredDocument(db, document).catch(() => undefined);
      });
      deletes.forEach((deletion) => {
        applyStoredDelete(db, deletion).catch(() => undefined);
      });
      if (typeof putCachedEvents === "function") {
        putCachedEvents(
          db,
          eventList
            .map(normalizeCachedEventRecord)
            .filter(
              (event): event is Record<string, unknown> => event !== undefined
            )
        ).catch(() => undefined);
      }
    },
    [db]
  );

  React.useEffect(() => {
    if (!db || unpublishedEvents.size === 0) {
      return;
    }

    const nextEvents = unpublishedEvents
      .filter((event) => {
        const document = toStoredDocumentRecord(event);
        const deletion = toStoredDeleteRecord(event);
        const key = document?.eventId || deletion?.eventId;
        if (!key || persistedUnpublishedKeysRef.current.has(key)) {
          return false;
        }
        persistedUnpublishedKeysRef.current.add(key);
        return true;
      })
      .toList();

    if (nextEvents.size === 0) {
      return;
    }

    addEvents(
      ImmutableMap<string, Event | UnsignedEvent>(
        nextEvents
          .map(
            (event, index) =>
              [`pending-${index}`, event] as [string, Event | UnsignedEvent]
          )
          .toArray()
      )
    );
  }, [addEvents, db, unpublishedEvents]);

  const activeSnapshot = React.useMemo(() => {
    const documents = unpublishedEvents
      .map((event) => toStoredDocumentRecord(event))
      .filter((record): record is StoredDocumentRecord => record !== undefined)
      .toArray();
    const deletes = unpublishedEvents
      .map((event) => toStoredDeleteRecord(event))
      .filter((record): record is StoredDeleteRecord => record !== undefined)
      .toArray();
    return applyRecordsToSnapshot(snapshot, documents, deletes);
  }, [snapshot, unpublishedEvents]);

  const contextValue = React.useMemo(
    () => ({
      knowledgeDBs: activeSnapshot.knowledgeDBs,
      semanticIndex: activeSnapshot.semanticIndex,
      addEvents,
    }),
    [activeSnapshot, addEvents]
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
