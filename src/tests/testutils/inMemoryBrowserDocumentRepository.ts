/* eslint-disable functional/immutable-data, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await, no-restricted-syntax */
import { act } from "@testing-library/react";
import { Event, UnsignedEvent } from "nostr-tools";
import type {
  BrowserDocumentRepository,
  CurrentCorpus,
  SnapshotKey,
} from "../../infra/browserDocumentRepository";
import type {
  DocumentStoreChange,
  SnapshotStoreChange,
  StoredDeleteRecord,
  StoredDocumentRecord,
  StoredSnapshotRecord,
} from "../../infra/indexedDB";
import { eventsToStoredRecords } from "../../infra/documentStoreRecords";
import {
  collectEventsUntilIdle,
  EventQueryClient,
} from "../../infra/eventQuery";
import { KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT } from "../../infra/nostrCore";
import { toStoredSnapshotRecord } from "../../infra/permanentSync";

type MemoryState = {
  documents: Map<string, StoredDocumentRecord>;
  deletes: Map<string, StoredDeleteRecord>;
  snapshots: Map<string, StoredSnapshotRecord>;
};

export function createInMemoryBrowserDocumentRepositoryState(): MemoryState {
  return {
    documents: new Map(),
    deletes: new Map(),
    snapshots: new Map(),
  };
}

function applyDocumentsToState(
  state: MemoryState,
  documents: ReadonlyArray<StoredDocumentRecord>,
  deletes: ReadonlyArray<StoredDeleteRecord>
): {
  currentChanges: DocumentStoreChange[];
} {
  const currentChanges: DocumentStoreChange[] = [];
  const getDocument = (
    replaceableKey: string
  ): StoredDocumentRecord | undefined => state.documents.get(replaceableKey);
  const getDelete = (replaceableKey: string): StoredDeleteRecord | undefined =>
    state.deletes.get(replaceableKey);
  const putDocument = (document: StoredDocumentRecord): void => {
    state.documents.set(document.replaceableKey, document);
    currentChanges.push({
      type: "document-put",
      document,
    });
  };
  const removeDocument = (replaceableKey: string): void => {
    if (!state.documents.has(replaceableKey)) {
      return;
    }
    state.documents.delete(replaceableKey);
    currentChanges.push({
      type: "document-remove",
      replaceableKey,
    });
  };
  const putDelete = (deletion: StoredDeleteRecord): void => {
    state.deletes.set(deletion.replaceableKey, deletion);
    currentChanges.push({
      type: "delete-put",
      deletion,
    });
  };
  const removeDelete = (replaceableKey: string): void => {
    if (!state.deletes.has(replaceableKey)) {
      return;
    }
    state.deletes.delete(replaceableKey);
    currentChanges.push({
      type: "delete-remove",
      replaceableKey,
    });
  };

  for (const document of documents) {
    const existingDocument = getDocument(document.replaceableKey);
    const existingDelete = getDelete(document.replaceableKey);
    if (
      (!existingDelete || existingDelete.deletedAt < document.updatedMs) &&
      (!existingDocument || existingDocument.updatedMs < document.updatedMs)
    ) {
      putDocument(document);
      if (existingDelete && document.updatedMs > existingDelete.deletedAt) {
        removeDelete(document.replaceableKey);
      }
    }
  }

  for (const deletion of deletes) {
    const existingDocument = getDocument(deletion.replaceableKey);
    const existingDelete = getDelete(deletion.replaceableKey);
    if (!existingDelete || existingDelete.deletedAt < deletion.deletedAt) {
      putDelete(deletion);
      if (
        existingDocument &&
        existingDocument.updatedMs <= deletion.deletedAt
      ) {
        removeDocument(deletion.replaceableKey);
      }
    }
  }

  return {
    currentChanges,
  };
}

export function createInMemoryBrowserDocumentRepository({
  relayPool,
  relayUrls,
  state = createInMemoryBrowserDocumentRepositoryState(),
}: {
  relayPool: EventQueryClient;
  relayUrls: string[];
  state?: MemoryState;
}): BrowserDocumentRepository {
  const currentListeners = new Set<(change: DocumentStoreChange) => void>();
  const snapshotListeners = new Set<(change: SnapshotStoreChange) => void>();

  const notifyCurrent = (change: DocumentStoreChange): void => {
    act(() => {
      currentListeners.forEach((listener) => listener(change));
    });
  };
  const notifySnapshot = (change: SnapshotStoreChange): void => {
    act(() => {
      snapshotListeners.forEach((listener) => listener(change));
    });
  };

  return {
    loadCurrent(): Promise<CurrentCorpus> {
      return Promise.resolve({
        documents: [...state.documents.values()],
        deletes: [...state.deletes.values()],
      });
    },

    subscribeCurrent(listener): () => void {
      currentListeners.add(listener);
      return () => {
        currentListeners.delete(listener);
      };
    },

    async writeLiveEvents(
      events: ReadonlyArray<Event | UnsignedEvent>
    ): Promise<void> {
      const { documents, deletes } = eventsToStoredRecords(events);
      const { currentChanges } = applyDocumentsToState(
        state,
        documents,
        deletes
      );
      currentChanges.forEach((change) => notifyCurrent(change));
    },

    getSnapshots(
      keys: ReadonlyArray<SnapshotKey>
    ): Promise<ReadonlyArray<StoredSnapshotRecord>> {
      return Promise.resolve(
        keys.reduce((acc, key) => {
          const snapshot = state.snapshots.get(`${key.author}:${key.dTag}`);
          return snapshot ? [...acc, snapshot] : acc;
        }, [] as StoredSnapshotRecord[])
      );
    },

    async ensureSnapshots(
      keys: ReadonlyArray<SnapshotKey>
    ): Promise<ReadonlyArray<StoredSnapshotRecord>> {
      const uniqueKeys = keys.filter(
        (key, index, items) =>
          items.findIndex(
            (candidate) =>
              candidate.author === key.author && candidate.dTag === key.dTag
          ) === index
      );
      const getSnapshotsFromState = (
        queries: ReadonlyArray<SnapshotKey>
      ): ReadonlyArray<StoredSnapshotRecord> =>
        queries.reduce((acc, key) => {
          const snapshot = state.snapshots.get(`${key.author}:${key.dTag}`);
          return snapshot ? [...acc, snapshot] : acc;
        }, [] as StoredSnapshotRecord[]);
      const cachedRecords = getSnapshotsFromState(uniqueKeys);
      const cachedSet = new Set(
        cachedRecords.map((record) => `${record.author}:${record.dTag}`)
      );
      const missingKeys = uniqueKeys.filter(
        (key) => !cachedSet.has(`${key.author}:${key.dTag}`)
      );

      if (missingKeys.length === 0) {
        return cachedRecords;
      }

      const events = await collectEventsUntilIdle(
        relayPool,
        relayUrls,
        [
          {
            kinds: [KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT],
            authors: [...new Set(missingKeys.map((key) => key.author))],
            "#d": missingKeys.map((key) => key.dTag),
          },
        ],
        { maxWait: 5_000 }
      );

      const freshRecords = events.reduce((acc, event) => {
        const record = toStoredSnapshotRecord(event);
        if (!record) {
          return acc;
        }
        state.snapshots.set(`${record.author}:${record.dTag}`, record);
        notifySnapshot({
          type: "snapshot-put",
          snapshot: record,
        });
        return [...acc, record];
      }, [] as StoredSnapshotRecord[]);

      return [...cachedRecords, ...freshRecords];
    },

    subscribeSnapshots(listener): () => void {
      snapshotListeners.add(listener);
      return () => {
        snapshotListeners.delete(listener);
      };
    },
  };
}
