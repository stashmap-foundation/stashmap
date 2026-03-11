import React from "react";
import { List, Map as ImmutableMap } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import {
  ensureRelationNativeFields,
  getRelationDepth,
  shortID,
  splitID,
} from "./connections";
import type {
  DocumentStoreChange,
  StashmapDB,
  StoredDeleteRecord,
  StoredDocumentRecord,
} from "./indexedDB";
import {
  getStoredDeletes,
  getStoredDocuments,
  subscribeDocumentStore,
} from "./indexedDB";
import { newDB } from "./knowledge";
import { parseDocumentEvent } from "./markdownDocument";
import { KIND_KNOWLEDGE_DOCUMENT } from "./nostr";
import {
  applyStoredDelete,
  applyStoredDocument,
  toStoredDeleteRecord,
  toStoredDocumentRecord,
} from "./permanentSync";

type DocumentSnapshot = {
  documents: ImmutableMap<string, StoredDocumentRecord>;
  deletes: ImmutableMap<string, StoredDeleteRecord>;
  knowledgeDBs: KnowledgeDBs;
};

type DocumentStoreState = {
  knowledgeDBs: KnowledgeDBs;
  addEvents: (events: ImmutableMap<string, Event | UnsignedEvent>) => void;
};

const DocumentStoreContext = React.createContext<
  DocumentStoreState | undefined
>(undefined);

function createEmptySnapshot(): DocumentSnapshot {
  return {
    documents: ImmutableMap<string, StoredDocumentRecord>(),
    deletes: ImmutableMap<string, StoredDeleteRecord>(),
    knowledgeDBs: ImmutableMap<PublicKey, KnowledgeData>(),
  };
}

function storedDocumentToEvent(document: StoredDocumentRecord): UnsignedEvent {
  return {
    pubkey: document.author,
    created_at: document.createdAt,
    kind: KIND_KNOWLEDGE_DOCUMENT,
    tags: document.tags,
    content: document.content,
  };
}

function buildKnowledgeDBForAuthor(
  author: PublicKey,
  documents: ReadonlyArray<StoredDocumentRecord>
): KnowledgeData | undefined {
  if (documents.length === 0) {
    return undefined;
  }

  const parsedRelations = List(
    documents.flatMap((document) =>
      parseDocumentEvent(storedDocumentToEvent(document)).valueSeq().toArray()
    )
  );

  const documentRelations = parsedRelations.reduce((acc, relation) => {
    const localID = splitID(relation.id)[1];
    const existing = acc.get(localID);
    if (!existing || relation.updated >= existing.updated) {
      return acc.set(localID, relation);
    }
    return acc;
  }, ImmutableMap<string, Relations>());

  const baseKnowledgeDBs = ImmutableMap<PublicKey, KnowledgeData>().set(
    author,
    {
      ...newDB(),
      relations: documentRelations,
    }
  );

  const relations = documentRelations
    .valueSeq()
    .sortBy((relation) => getRelationDepth(baseKnowledgeDBs, relation))
    .reduce((acc, relation) => {
      const knowledgeDBs = ImmutableMap<PublicKey, KnowledgeData>().set(
        relation.author,
        {
          ...newDB(),
          relations: acc,
        }
      );
      const normalized = ensureRelationNativeFields(knowledgeDBs, relation);
      return acc.set(shortID(normalized.id), normalized);
    }, ImmutableMap<string, Relations>());

  return {
    ...newDB(),
    relations,
  };
}

function rebuildAuthors(
  snapshot: DocumentSnapshot,
  authors: ReadonlyArray<PublicKey>
): KnowledgeDBs {
  const authorSet = new Set(authors);
  return [...authorSet].reduce((acc, author) => {
    const authorDocuments = snapshot.documents
      .valueSeq()
      .filter((document) => document.author === author)
      .toArray();
    const nextKnowledgeDB = buildKnowledgeDBForAuthor(author, authorDocuments);
    return nextKnowledgeDB
      ? acc.set(author, nextKnowledgeDB)
      : acc.remove(author);
  }, snapshot.knowledgeDBs);
}

function applyDocumentToSnapshot(
  snapshot: DocumentSnapshot,
  document: StoredDocumentRecord
): DocumentSnapshot {
  const existingDocument = snapshot.documents.get(document.replaceableKey);
  const existingDelete = snapshot.deletes.get(document.replaceableKey);

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
  const nextSnapshot = {
    ...snapshot,
    documents: snapshot.documents.set(document.replaceableKey, document),
    deletes: nextDeletes,
  };
  const knowledgeDBs = rebuildAuthors(nextSnapshot, [document.author]);
  return {
    ...nextSnapshot,
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
    if (!existingDocument) {
      return snapshot;
    }
    const nextSnapshot = {
      ...snapshot,
      documents: snapshot.documents.remove(change.replaceableKey),
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
  const baseSnapshot = {
    documents: ImmutableMap<string, StoredDocumentRecord>(
      documents.map((document) => [document.replaceableKey, document])
    ),
    deletes: ImmutableMap<string, StoredDeleteRecord>(
      deletes.map((deletion) => [deletion.replaceableKey, deletion])
    ),
    knowledgeDBs: ImmutableMap<PublicKey, KnowledgeData>(),
  };
  const authors = [...new Set(documents.map((document) => document.author))];
  return {
    ...baseSnapshot,
    knowledgeDBs: rebuildAuthors(baseSnapshot, authors),
  };
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

  React.useEffect(() => {
    if (!db) {
      return () => {};
    }
    const controller = new AbortController();
    Promise.all([getStoredDocuments(db), getStoredDeletes(db)]).then(
      ([documents, deletes]) => {
        if (controller.signal.aborted) {
          return;
        }
        setSnapshot(createSnapshotFromStoredRecords(documents, deletes));
      }
    );
    const unsubscribe = subscribeDocumentStore(db, (change) => {
      if (controller.signal.aborted) {
        return;
      }
      setSnapshot((current) => applyChangeToSnapshot(current, change));
    });
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [db]);

  const addEvents = React.useCallback(
    (events: ImmutableMap<string, Event | UnsignedEvent>) => {
      const documents = events
        .valueSeq()
        .toArray()
        .map((event) => toStoredDocumentRecord(event))
        .filter(
          (record): record is StoredDocumentRecord => record !== undefined
        );
      const deletes = events
        .valueSeq()
        .toArray()
        .map((event) => toStoredDeleteRecord(event))
        .filter((record): record is StoredDeleteRecord => record !== undefined);

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
    },
    [db]
  );

  const knowledgeDBs = React.useMemo(() => {
    const documents = unpublishedEvents
      .map((event) => toStoredDocumentRecord(event))
      .filter((record): record is StoredDocumentRecord => record !== undefined)
      .toArray();
    const deletes = unpublishedEvents
      .map((event) => toStoredDeleteRecord(event))
      .filter((record): record is StoredDeleteRecord => record !== undefined)
      .toArray();
    return applyRecordsToSnapshot(snapshot, documents, deletes).knowledgeDBs;
  }, [snapshot, unpublishedEvents]);

  const contextValue = React.useMemo(
    () => ({
      knowledgeDBs,
      addEvents,
    }),
    [addEvents, knowledgeDBs]
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
