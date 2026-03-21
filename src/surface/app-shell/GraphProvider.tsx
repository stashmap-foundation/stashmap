import React from "react";
import { List, Map as ImmutableMap } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import type { Contacts, PublicKey } from "../../graph/identity";
import type { KnowledgeDBs, SemanticIndex } from "../../graph/types";
import {
  buildPermanentSyncAuthors,
  startPermanentDocumentSync,
} from "../../infra/permanentSync";
import type { Relays } from "../../infra/publishTypes";
import type {
  BrowserDocumentRepository,
  SnapshotKey,
} from "../../infra/browserDocumentRepository";
import { createBrowserDocumentRepository } from "../../infra/browserDocumentRepository";
import type { StashmapDB, StoredSnapshotRecord } from "../../infra/indexedDB";
import {
  flattenRelays,
  getReadRelays,
  sanitizeRelays,
} from "../../infra/relayUtils";
import { useApis } from "./ApiContext";
import {
  applyChangeToSnapshot,
  applyRecordsToSnapshot,
  createEmptySnapshot,
  type DocumentSnapshot,
} from "./documentStoreState";
import type { SnapshotLoadStatus } from "./types";
import {
  eventsToStoredRecords,
  getStoredRecordEventID,
} from "../../infra/documentStoreRecords";
import { createEmptySemanticIndex } from "../../graph/semanticIndex";

type GraphState = {
  knowledgeDBs: KnowledgeDBs;
  semanticIndex: SemanticIndex;
  snapshots: ImmutableMap<string, StoredSnapshotRecord>;
  snapshotStatuses: ImmutableMap<string, SnapshotLoadStatus>;
  ensureSnapshotsLoaded: (keys: ReadonlyArray<SnapshotKey>) => Promise<void>;
};

const GraphContext = React.createContext<GraphState | undefined>(undefined);

function snapshotStoreKey(author: PublicKey, dTag: string): string {
  return `${author}:${dTag}`;
}

function serializeRelays(relays: Relays): string {
  return sanitizeRelays(relays)
    .map(
      (relay) =>
        `${relay.url}|${relay.read ? "r" : ""}${relay.write ? "w" : ""}`
    )
    .sort()
    .join(",");
}

export function GraphProvider({
  children,
  db,
  myself,
  contacts,
  extraAuthors = [],
  unpublishedEvents = List<UnsignedEvent>(),
  defaultRelays,
  userRelays,
  contactsRelays,
  repository: providedRepository,
}: {
  children: React.ReactNode;
  db?: StashmapDB | null;
  myself: PublicKey;
  contacts: Contacts;
  extraAuthors?: PublicKey[];
  unpublishedEvents?: List<UnsignedEvent>;
  defaultRelays: Relays;
  userRelays: Relays;
  contactsRelays: ImmutableMap<PublicKey, Relays>;
  repository?: BrowserDocumentRepository;
}): JSX.Element {
  const { relayPool } = useApis();
  const [snapshot, setSnapshot] =
    React.useState<DocumentSnapshot>(createEmptySnapshot);
  const [snapshots, setSnapshots] = React.useState<
    ImmutableMap<string, StoredSnapshotRecord>
  >(ImmutableMap<string, StoredSnapshotRecord>());
  const [snapshotStatuses, setSnapshotStatuses] = React.useState<
    ImmutableMap<string, SnapshotLoadStatus>
  >(ImmutableMap<string, SnapshotLoadStatus>());
  const persistedUnpublishedKeysRef = React.useRef<globalThis.Set<string>>(
    new globalThis.Set<string>()
  );
  const extraAuthorsKey = React.useMemo(
    () => [...new globalThis.Set(extraAuthors)].sort().join(","),
    [extraAuthors]
  );
  const defaultRelaysKey = React.useMemo(
    () => serializeRelays(defaultRelays),
    [defaultRelays]
  );
  const userRelaysKey = React.useMemo(
    () => serializeRelays(userRelays),
    [userRelays]
  );
  const contactsRelaysKey = React.useMemo(
    () =>
      flattenRelays(contactsRelays)
        .flatMap((relay) => sanitizeRelays([relay]))
        .map(
          (relay) =>
            `${relay.url}|${relay.read ? "r" : ""}${relay.write ? "w" : ""}`
        )
        .sort()
        .join(","),
    [contactsRelays]
  );

  const authors = React.useMemo(
    () =>
      [
        ...new globalThis.Set([
          ...buildPermanentSyncAuthors(myself, contacts),
          ...extraAuthors,
        ]),
      ].sort(),
    [myself, contacts, extraAuthorsKey]
  );
  const relayUrls = React.useMemo(
    () =>
      [
        ...new Set(
          getReadRelays([
            ...defaultRelays,
            ...userRelays,
            ...flattenRelays(contactsRelays),
          ])
            .flatMap((relay) => sanitizeRelays([relay]).map((r) => r.url))
            .map((url) => url.trim().replace(/\/$/, ""))
        ),
      ].sort(),
    [defaultRelaysKey, userRelaysKey, contactsRelaysKey]
  );

  const repository = React.useMemo(() => {
    if (providedRepository) {
      return providedRepository;
    }
    if (!db) {
      return undefined;
    }
    return createBrowserDocumentRepository({
      db,
      relayPool,
      relayUrls,
    });
  }, [db, providedRepository, relayPool, relayUrls]);

  React.useEffect(() => {
    if (!repository) {
      setSnapshot(createEmptySnapshot());
      return () => {};
    }
    const controller = new AbortController();
    setSnapshot(createEmptySnapshot());
    repository.loadCurrent().then(({ documents, deletes }) => {
      if (controller.signal.aborted) {
        return;
      }
      setSnapshot((current) =>
        applyRecordsToSnapshot(current, documents, deletes)
      );
    });
    const unsubscribe = repository.subscribeCurrent((change) => {
      if (controller.signal.aborted) {
        return;
      }
      setSnapshot((current) => applyChangeToSnapshot(current, change));
    });
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [repository]);

  React.useEffect(() => {
    if (!repository) {
      setSnapshots(ImmutableMap<string, StoredSnapshotRecord>());
      setSnapshotStatuses(ImmutableMap<string, SnapshotLoadStatus>());
      return () => {};
    }
    const unsubscribe = repository.subscribeSnapshots((change) => {
      setSnapshots((current) =>
        current.set(
          snapshotStoreKey(change.snapshot.author, change.snapshot.dTag),
          change.snapshot
        )
      );
      setSnapshotStatuses((current) =>
        current.set(
          snapshotStoreKey(change.snapshot.author, change.snapshot.dTag),
          "loaded"
        )
      );
    });
    return unsubscribe;
  }, [repository]);

  const persistEvents = React.useCallback(
    (events: ImmutableMap<string, Event | UnsignedEvent>): Promise<void> => {
      if (!repository) {
        return Promise.resolve();
      }
      return repository.writeLiveEvents(events.valueSeq().toArray());
    },
    [repository]
  );

  React.useEffect(() => {
    if (!repository || unpublishedEvents.size === 0) {
      return;
    }

    const nextEvents = unpublishedEvents
      .filter((event) => {
        const key = getStoredRecordEventID(event);
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

    persistEvents(
      ImmutableMap<string, Event | UnsignedEvent>(
        nextEvents
          .map(
            (event, index) =>
              [`pending-${index}`, event] as [string, Event | UnsignedEvent]
          )
          .toArray()
      )
    ).catch(() => undefined);
  }, [persistEvents, repository, unpublishedEvents]);

  React.useEffect(() => {
    if (!repository || relayUrls.length === 0 || authors.length === 0) {
      return () => {};
    }
    return startPermanentDocumentSync({
      db: db || null,
      relayPool,
      relayUrls,
      authors,
      writeEvents: persistEvents,
    });
  }, [authors, db, persistEvents, relayPool, relayUrls, repository]);

  const activeSnapshot = React.useMemo(() => {
    const { documents, deletes } = eventsToStoredRecords(
      unpublishedEvents.toArray()
    );
    return applyRecordsToSnapshot(snapshot, documents, deletes);
  }, [snapshot, unpublishedEvents]);

  const ensureSnapshotsLoaded = React.useCallback(
    async (keys: ReadonlyArray<SnapshotKey>): Promise<void> => {
      if (!repository || keys.length === 0) {
        return;
      }
      const uniqueKeys = keys.filter(
        (key, index, items) =>
          !!key.dTag &&
          items.findIndex(
            (candidate) =>
              candidate.author === key.author && candidate.dTag === key.dTag
          ) === index
      );
      const pendingKeys = uniqueKeys.filter((key) => {
        const storeKey = snapshotStoreKey(key.author, key.dTag);
        const status = snapshotStatuses.get(storeKey);
        return status !== "loaded" && status !== "loading";
      });

      if (pendingKeys.length === 0) {
        return;
      }

      setSnapshotStatuses((current) =>
        pendingKeys.reduce(
          (acc, key) =>
            acc.set(snapshotStoreKey(key.author, key.dTag), "loading"),
          current
        )
      );

      const loaded = await repository.ensureSnapshots(pendingKeys);
      const loadedKeys = new Set(
        loaded.map((record) => snapshotStoreKey(record.author, record.dTag))
      );

      setSnapshots((current) =>
        loaded.reduce(
          (acc, record) =>
            acc.set(snapshotStoreKey(record.author, record.dTag), record),
          current
        )
      );
      setSnapshotStatuses((current) => {
        const withLoaded = loaded.reduce(
          (acc, record) =>
            acc.set(snapshotStoreKey(record.author, record.dTag), "loaded"),
          current
        );
        return pendingKeys.reduce((acc, key) => {
          const storeKey = snapshotStoreKey(key.author, key.dTag);
          return loadedKeys.has(storeKey)
            ? acc
            : acc.set(storeKey, "unavailable");
        }, withLoaded);
      });
    },
    [repository, snapshotStatuses]
  );

  const contextValue = React.useMemo(
    () => ({
      knowledgeDBs: activeSnapshot.knowledgeDBs,
      semanticIndex: activeSnapshot.semanticIndex,
      snapshots,
      snapshotStatuses,
      ensureSnapshotsLoaded,
    }),
    [activeSnapshot, ensureSnapshotsLoaded, snapshots, snapshotStatuses]
  );

  return (
    <GraphContext.Provider value={contextValue}>
      {children}
    </GraphContext.Provider>
  );
}

export function useGraphState(): GraphState | undefined {
  return React.useContext(GraphContext);
}

export function useGraphKnowledgeDBs(): KnowledgeDBs {
  return React.useContext(GraphContext)?.knowledgeDBs || ImmutableMap();
}

export function useGraphSemanticIndex(): SemanticIndex {
  return (
    React.useContext(GraphContext)?.semanticIndex || createEmptySemanticIndex()
  );
}

export function useGraphSnapshots(): ImmutableMap<
  string,
  StoredSnapshotRecord
> {
  return (
    React.useContext(GraphContext)?.snapshots ||
    ImmutableMap<string, StoredSnapshotRecord>()
  );
}

export function useGraphSnapshotStatuses(): ImmutableMap<
  string,
  SnapshotLoadStatus
> {
  return (
    React.useContext(GraphContext)?.snapshotStatuses ||
    ImmutableMap<string, SnapshotLoadStatus>()
  );
}

export function useEnsureSnapshotsLoaded(): (
  keys: ReadonlyArray<SnapshotKey>
) => Promise<void> {
  return (
    React.useContext(GraphContext)?.ensureSnapshotsLoaded ||
    (() => Promise.resolve())
  );
}
