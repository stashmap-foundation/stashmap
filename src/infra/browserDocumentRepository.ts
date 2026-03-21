import { Event, UnsignedEvent } from "nostr-tools";
import {
  loadInitialDocumentStoreRecords,
  persistDocumentStoreEvents,
  subscribeToDocumentStore,
} from "./documentStoreRepository";
import type {
  DocumentStoreChange,
  SnapshotStoreChange,
  StashmapDB,
  StoredDeleteRecord,
  StoredDocumentRecord,
  StoredSnapshotRecord,
} from "./indexedDB";
import { getStoredSnapshot, subscribeSnapshotStore } from "./indexedDB";
import { fetchSnapshots } from "./snapshotRepository";
import type { EventQueryClient } from "./eventQuery";
import { KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT } from "./nostrCore";

export type SnapshotKey = {
  readonly author: PublicKey;
  readonly dTag: string;
};

export type CurrentCorpus = {
  readonly documents: ReadonlyArray<StoredDocumentRecord>;
  readonly deletes: ReadonlyArray<StoredDeleteRecord>;
};

export type BrowserDocumentRepository = {
  loadCurrent: () => Promise<CurrentCorpus>;
  subscribeCurrent: (
    listener: (change: DocumentStoreChange) => void
  ) => () => void;
  writeLiveEvents: (
    events: ReadonlyArray<Event | UnsignedEvent>
  ) => Promise<void>;
  getSnapshots: (
    keys: ReadonlyArray<SnapshotKey>
  ) => Promise<ReadonlyArray<StoredSnapshotRecord>>;
  ensureSnapshots: (
    keys: ReadonlyArray<SnapshotKey>
  ) => Promise<ReadonlyArray<StoredSnapshotRecord>>;
  subscribeSnapshots: (
    listener: (change: SnapshotStoreChange) => void
  ) => () => void;
};

function deduplicateSnapshotKeys(
  keys: ReadonlyArray<SnapshotKey>
): ReadonlyArray<SnapshotKey> {
  const seen = new Set<string>();
  return keys.filter((key) => {
    const uniqueKey = `${key.author}:${key.dTag}`;
    if (seen.has(uniqueKey)) {
      return false;
    }
    seen.add(uniqueKey);
    return true;
  });
}

export function createBrowserDocumentRepository({
  db,
  relayPool,
  relayUrls,
}: {
  db: StashmapDB;
  relayPool: EventQueryClient;
  relayUrls: string[];
}): BrowserDocumentRepository {
  return {
    loadCurrent(): Promise<CurrentCorpus> {
      return loadInitialDocumentStoreRecords(db);
    },

    subscribeCurrent(
      listener: (change: DocumentStoreChange) => void
    ): () => void {
      return subscribeToDocumentStore(db, listener);
    },

    writeLiveEvents(
      events: ReadonlyArray<Event | UnsignedEvent>
    ): Promise<void> {
      return persistDocumentStoreEvents(db, events);
    },

    async getSnapshots(
      keys: ReadonlyArray<SnapshotKey>
    ): Promise<ReadonlyArray<StoredSnapshotRecord>> {
      const uniqueKeys = deduplicateSnapshotKeys(keys);
      const snapshots = await Promise.all(
        uniqueKeys.map((key) =>
          getStoredSnapshot(
            db,
            `${KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT}:${key.author}:${key.dTag}`
          )
        )
      );
      return snapshots.filter(
        (snapshot): snapshot is StoredSnapshotRecord => snapshot !== undefined
      );
    },

    ensureSnapshots(
      keys: ReadonlyArray<SnapshotKey>
    ): Promise<ReadonlyArray<StoredSnapshotRecord>> {
      return fetchSnapshots({
        db,
        relayPool,
        relayUrls,
        queries: deduplicateSnapshotKeys(keys),
      });
    },

    subscribeSnapshots(
      listener: (change: SnapshotStoreChange) => void
    ): () => void {
      return subscribeSnapshotStore(db, listener);
    },
  };
}
