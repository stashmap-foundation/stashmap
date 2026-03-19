/* eslint-disable functional/immutable-data */
import { UnsignedEvent } from "nostr-tools";

const DB_NAME = "stashmap";
const DB_VERSION = 3;
const OUTBOX_STORE = "outbox";
const EVENT_CACHE_STORE = "eventCache";
const DOCUMENT_STORE = "documents";
const DOCUMENT_DELETE_STORE = "documentDeletes";
const SYNC_CHECKPOINT_STORE = "syncCheckpoints";
const OPEN_DATABASES = new Set<StashmapDB>();
const DOCUMENT_STORE_LISTENERS = new WeakMap<
  StashmapDB,
  Set<(change: DocumentStoreChange) => void>
>();

export type OutboxEntry = {
  readonly key: string;
  readonly event: UnsignedEvent;
  readonly createdAt: number;
  readonly succeededRelays?: ReadonlyArray<string>;
};

export type StoredDocumentRecord = {
  readonly replaceableKey: string;
  readonly author: PublicKey;
  readonly eventId: string;
  readonly dTag: string;
  readonly createdAt: number;
  readonly updatedMs: number;
  readonly content: string;
  readonly tags: string[][];
};

export type StoredDeleteRecord = {
  readonly replaceableKey: string;
  readonly author: PublicKey;
  readonly eventId: string;
  readonly createdAt: number;
  readonly deletedAt: number;
};

export type SyncCheckpointRecord = {
  readonly author: PublicKey;
  readonly docsBackfillComplete: boolean;
  readonly deletesBackfillComplete: boolean;
  readonly oldestFetchedDocCreatedAt?: number;
  readonly oldestFetchedDeleteCreatedAt?: number;
  readonly latestSeenLiveCreatedAt?: number;
};

export type DocumentStoreChange =
  | {
      readonly type: "document-put";
      readonly document: StoredDocumentRecord;
    }
  | {
      readonly type: "document-remove";
      readonly replaceableKey: string;
    }
  | {
      readonly type: "delete-put";
      readonly deletion: StoredDeleteRecord;
    }
  | {
      readonly type: "delete-remove";
      readonly replaceableKey: string;
    };

export type StashmapDB = IDBDatabase;

function notifyDocumentStoreListeners(
  db: StashmapDB,
  change: DocumentStoreChange
): void {
  DOCUMENT_STORE_LISTENERS.get(db)?.forEach((listener) => listener(change));
}

export function subscribeDocumentStore(
  db: StashmapDB,
  listener: (change: DocumentStoreChange) => void
): () => void {
  const listeners = DOCUMENT_STORE_LISTENERS.get(db) || new Set();
  listeners.add(listener);
  DOCUMENT_STORE_LISTENERS.set(db, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      DOCUMENT_STORE_LISTENERS.delete(db);
    }
  };
}

export const openDB = (): Promise<StashmapDB | null> => {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const { oldVersion } = request;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(EVENT_CACHE_STORE)) {
        db.createObjectStore(EVENT_CACHE_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(DOCUMENT_STORE)) {
        const documents = db.createObjectStore(DOCUMENT_STORE, {
          keyPath: "replaceableKey",
        });
        documents.createIndex("author", "author", { unique: false });
        documents.createIndex("updatedMs", "updatedMs", { unique: false });
      }
      if (!db.objectStoreNames.contains(DOCUMENT_DELETE_STORE)) {
        const deletes = db.createObjectStore(DOCUMENT_DELETE_STORE, {
          keyPath: "replaceableKey",
        });
        deletes.createIndex("author", "author", { unique: false });
        deletes.createIndex("deletedAt", "deletedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(SYNC_CHECKPOINT_STORE)) {
        db.createObjectStore(SYNC_CHECKPOINT_STORE, {
          keyPath: "author",
        });
      }
      if (oldVersion < 3) {
        request.transaction?.objectStore(DOCUMENT_STORE).clear();
        request.transaction?.objectStore(DOCUMENT_DELETE_STORE).clear();
        request.transaction?.objectStore(SYNC_CHECKPOINT_STORE).clear();
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      OPEN_DATABASES.add(db);
      db.addEventListener("close", () => {
        OPEN_DATABASES.delete(db);
      });
      db.addEventListener("versionchange", () => {
        OPEN_DATABASES.delete(db);
        db.close();
      });
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
};

const txStore = (
  db: StashmapDB,
  store: string,
  mode: IDBTransactionMode
): IDBObjectStore => db.transaction(store, mode).objectStore(store);

export const getOutboxEvents = (
  db: StashmapDB
): Promise<ReadonlyArray<OutboxEntry>> =>
  new Promise((resolve, reject) => {
    const request = txStore(db, OUTBOX_STORE, "readonly").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const putOutboxEvent = (
  db: StashmapDB,
  entry: OutboxEntry
): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = txStore(db, OUTBOX_STORE, "readwrite").put(entry);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

export const removeOutboxEvent = (db: StashmapDB, key: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = txStore(db, OUTBOX_STORE, "readwrite").delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

export const getCachedEvents = (
  db: StashmapDB
): Promise<ReadonlyArray<Record<string, unknown>>> =>
  new Promise((resolve, reject) => {
    const request = txStore(db, EVENT_CACHE_STORE, "readonly").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const putCachedEvents = (
  db: StashmapDB,
  events: ReadonlyArray<Record<string, unknown>>
): Promise<void> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(EVENT_CACHE_STORE, "readwrite");
    const store = tx.objectStore(EVENT_CACHE_STORE);
    events.forEach((e) => store.put(e));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

export const getStoredDocuments = (
  db: StashmapDB
): Promise<ReadonlyArray<StoredDocumentRecord>> =>
  new Promise((resolve, reject) => {
    const request = txStore(db, DOCUMENT_STORE, "readonly").getAll();
    request.onsuccess = () =>
      resolve(request.result as ReadonlyArray<StoredDocumentRecord>);
    request.onerror = () => reject(request.error);
  });

export const getStoredDocument = (
  db: StashmapDB,
  replaceableKey: string
): Promise<StoredDocumentRecord | undefined> =>
  new Promise((resolve, reject) => {
    const request = txStore(db, DOCUMENT_STORE, "readonly").get(replaceableKey);
    request.onsuccess = () =>
      resolve(request.result as StoredDocumentRecord | undefined);
    request.onerror = () => reject(request.error);
  });

export const putStoredDocument = (
  db: StashmapDB,
  document: StoredDocumentRecord
): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = txStore(db, DOCUMENT_STORE, "readwrite").put(document);
    request.onsuccess = () => {
      notifyDocumentStoreListeners(db, {
        type: "document-put",
        document,
      });
      resolve();
    };
    request.onerror = () => reject(request.error);
  });

export const removeStoredDocument = (
  db: StashmapDB,
  replaceableKey: string
): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = txStore(db, DOCUMENT_STORE, "readwrite").delete(
      replaceableKey
    );
    request.onsuccess = () => {
      notifyDocumentStoreListeners(db, {
        type: "document-remove",
        replaceableKey,
      });
      resolve();
    };
    request.onerror = () => reject(request.error);
  });

export const getStoredDeletes = (
  db: StashmapDB
): Promise<ReadonlyArray<StoredDeleteRecord>> =>
  new Promise((resolve, reject) => {
    const request = txStore(db, DOCUMENT_DELETE_STORE, "readonly").getAll();
    request.onsuccess = () =>
      resolve(request.result as ReadonlyArray<StoredDeleteRecord>);
    request.onerror = () => reject(request.error);
  });

export const getStoredDelete = (
  db: StashmapDB,
  replaceableKey: string
): Promise<StoredDeleteRecord | undefined> =>
  new Promise((resolve, reject) => {
    const request = txStore(db, DOCUMENT_DELETE_STORE, "readonly").get(
      replaceableKey
    );
    request.onsuccess = () =>
      resolve(request.result as StoredDeleteRecord | undefined);
    request.onerror = () => reject(request.error);
  });

export const putStoredDelete = (
  db: StashmapDB,
  deletion: StoredDeleteRecord
): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = txStore(db, DOCUMENT_DELETE_STORE, "readwrite").put(
      deletion
    );
    request.onsuccess = () => {
      notifyDocumentStoreListeners(db, {
        type: "delete-put",
        deletion,
      });
      resolve();
    };
    request.onerror = () => reject(request.error);
  });

export const removeStoredDelete = (
  db: StashmapDB,
  replaceableKey: string
): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = txStore(db, DOCUMENT_DELETE_STORE, "readwrite").delete(
      replaceableKey
    );
    request.onsuccess = () => {
      notifyDocumentStoreListeners(db, {
        type: "delete-remove",
        replaceableKey,
      });
      resolve();
    };
    request.onerror = () => reject(request.error);
  });

export const getSyncCheckpoint = (
  db: StashmapDB,
  author: PublicKey
): Promise<SyncCheckpointRecord | undefined> =>
  new Promise((resolve, reject) => {
    const request = txStore(db, SYNC_CHECKPOINT_STORE, "readonly").get(author);
    request.onsuccess = () =>
      resolve(request.result as SyncCheckpointRecord | undefined);
    request.onerror = () => reject(request.error);
  });

export const putSyncCheckpoint = (
  db: StashmapDB,
  checkpoint: SyncCheckpointRecord
): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = txStore(db, SYNC_CHECKPOINT_STORE, "readwrite").put(
      checkpoint
    );
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

export const clearDatabase = (): Promise<void> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      resolve();
      return;
    }
    OPEN_DATABASES.forEach((db) => {
      try {
        db.close();
      } finally {
        OPEN_DATABASES.delete(db);
      }
    });
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
