/* eslint-disable functional/immutable-data */
import { UnsignedEvent } from "nostr-tools";

const DB_NAME = "stashmap";
const DB_VERSION = 1;
const OUTBOX_STORE = "outbox";
const EVENT_CACHE_STORE = "eventCache";

export type OutboxEntry = {
  readonly key: string;
  readonly event: UnsignedEvent & EventAttachment;
  readonly createdAt: number;
  readonly succeededRelays?: ReadonlyArray<string>;
};

export type StashmapDB = IDBDatabase;

export const openDB = (): Promise<StashmapDB | null> => {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(EVENT_CACHE_STORE)) {
        db.createObjectStore(EVENT_CACHE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
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

export const clearDatabase = (): Promise<void> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      resolve();
      return;
    }
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
