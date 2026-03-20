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
  eventsToStoredRecords,
  normalizeCachedEventRecord,
} from "./documentStoreRecords";
import { applyStoredDelete, applyStoredDocument } from "./permanentSync";

export async function loadInitialDocumentStoreRecords(db: StashmapDB): Promise<{
  readonly documents: ReadonlyArray<StoredDocumentRecord>;
  readonly deletes: ReadonlyArray<StoredDeleteRecord>;
}> {
  const [documents, deletes] = await Promise.all([
    getStoredDocuments(db),
    getStoredDeletes(db),
  ]);

  if (documents.length === 0 && deletes.length === 0) {
    const cachedEvents = await getCachedEvents(db);
    return eventsToStoredRecords(
      cachedEvents as ReadonlyArray<Event | UnsignedEvent>
    );
  }

  return {
    documents,
    deletes,
  };
}

export function subscribeToDocumentStore(
  db: StashmapDB,
  listener: (change: DocumentStoreChange) => void
): () => void {
  return subscribeDocumentStore(db, listener);
}

export async function persistDocumentStoreEvents(
  db: StashmapDB,
  events: ReadonlyArray<Event | UnsignedEvent>
): Promise<void> {
  const { documents, deletes } = eventsToStoredRecords(events);

  if (documents.length === 0 && deletes.length === 0) {
    return;
  }

  await Promise.allSettled([
    ...documents.map((document) => applyStoredDocument(db, document)),
    ...deletes.map((deletion) => applyStoredDelete(db, deletion)),
    putCachedEvents(
      db,
      events
        .map(normalizeCachedEventRecord)
        .filter(
          (event): event is Record<string, unknown> => event !== undefined
        )
    ),
  ]);
}
