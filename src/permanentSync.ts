/* eslint-disable functional/immutable-data */
import { Map as ImmutableMap } from "immutable";
import { Event, Filter, SimplePool, UnsignedEvent } from "nostr-tools";
import { findTag, getEventMs } from "./nostrEvents";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
  getReplaceableKey,
} from "./nostr";
import type {
  StashmapDB,
  StoredDeleteRecord,
  StoredDocumentRecord,
  SyncCheckpointRecord,
} from "./infra/nostr/replica/indexedDB";
import {
  getSyncCheckpoint,
  getStoredDelete,
  getStoredDocument,
  putStoredDelete,
  putStoredDocument,
  putSyncCheckpoint,
  removeStoredDelete,
  removeStoredDocument,
} from "./infra/nostr/replica/indexedDB";
import { collectEventsUntilIdle } from "./eventQuery";

const PERMANENT_SYNC_BACKFILL_PAGE_LIMIT = 200;
const PERMANENT_SYNC_CATCH_UP_SAFETY_WINDOW_SECONDS = 5 * 60;
const PERMANENT_SYNC_QUERY_MAX_WAIT_MS = 5_000;

type PermanentSyncState = {
  active: boolean;
  seenEventIds: Set<string>;
  checkpoints: Map<PublicKey, SyncCheckpointRecord>;
};

export function buildPermanentSyncAuthors(
  myself: PublicKey,
  contacts: Contacts
): PublicKey[] {
  return contacts.keySeq().toSet().add(myself).toArray().sort();
}

export function buildPermanentSyncFilters(authors: PublicKey[]): Filter[] {
  if (authors.length === 0) {
    return [];
  }
  return [
    {
      authors,
      kinds: [KIND_KNOWLEDGE_DOCUMENT, KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT],
      limit: 0,
    },
    {
      authors,
      kinds: [KIND_DELETE],
      "#k": [`${KIND_KNOWLEDGE_DOCUMENT}`],
      limit: 0,
    },
  ];
}

export function buildPermanentCatchUpFilters(
  authors: PublicKey[],
  checkpoints: ReadonlyMap<PublicKey, SyncCheckpointRecord>
): Filter[] {
  const authorsWithCheckpoint = authors.filter(
    (author) => (checkpoints.get(author)?.latestSeenLiveCreatedAt || 0) > 0
  );
  if (authorsWithCheckpoint.length === 0) {
    return [];
  }
  const since = Math.max(
    0,
    authorsWithCheckpoint.reduce((minCreatedAt, author) => {
      const createdAt = checkpoints.get(author)?.latestSeenLiveCreatedAt || 0;
      return Math.min(minCreatedAt, createdAt);
    }, Number.POSITIVE_INFINITY) - PERMANENT_SYNC_CATCH_UP_SAFETY_WINDOW_SECONDS
  );
  return [
    {
      authors: authorsWithCheckpoint,
      kinds: [KIND_KNOWLEDGE_DOCUMENT],
      since,
    },
    {
      authors: authorsWithCheckpoint,
      kinds: [KIND_DELETE],
      "#k": [`${KIND_KNOWLEDGE_DOCUMENT}`],
      since,
    },
  ];
}

export function buildPermanentBackfillFilter({
  author,
  until,
  kind,
}: {
  author: PublicKey;
  until?: number;
  kind: typeof KIND_KNOWLEDGE_DOCUMENT | typeof KIND_DELETE;
}): Filter {
  return {
    authors: [author],
    kinds: [kind],
    ...(kind === KIND_DELETE ? { "#k": [`${KIND_KNOWLEDGE_DOCUMENT}`] } : {}),
    ...(until !== undefined ? { until } : {}),
    limit: PERMANENT_SYNC_BACKFILL_PAGE_LIMIT,
  };
}

export function getStoredEventID(
  event: Event | UnsignedEvent,
  replaceableKey: string
): string {
  return "id" in event && typeof event.id === "string"
    ? event.id
    : `${replaceableKey}:${getEventMs(event)}`;
}

export function toStoredDocumentRecord(
  event: Event | UnsignedEvent
): StoredDocumentRecord | undefined {
  if (event.kind !== KIND_KNOWLEDGE_DOCUMENT) {
    return undefined;
  }
  const replaceableKey = getReplaceableKey(event);
  const dTag = findTag(event, "d");
  if (!replaceableKey || !dTag) {
    return undefined;
  }
  return {
    replaceableKey,
    author: event.pubkey as PublicKey,
    eventId: getStoredEventID(event, replaceableKey),
    dTag,
    createdAt: event.created_at,
    updatedMs: getEventMs(event),
    content: event.content,
    tags: event.tags,
  };
}

export function toStoredDeleteRecord(
  event: Event | UnsignedEvent
): StoredDeleteRecord | undefined {
  if (
    event.kind !== KIND_DELETE ||
    findTag(event, "k") !== `${KIND_KNOWLEDGE_DOCUMENT}`
  ) {
    return undefined;
  }
  const replaceableKey = findTag(event, "a");
  if (!replaceableKey) {
    return undefined;
  }
  const author = replaceableKey.split(":")[1] as PublicKey | undefined;
  if (!author) {
    return undefined;
  }
  return {
    replaceableKey,
    author,
    eventId: getStoredEventID(event, replaceableKey),
    createdAt: event.created_at,
    deletedAt: getEventMs(event),
  };
}

export function mergeLiveSyncCheckpoint(
  current: SyncCheckpointRecord | undefined,
  author: PublicKey,
  createdAt: number
): SyncCheckpointRecord {
  return {
    author,
    docsBackfillComplete: current?.docsBackfillComplete || false,
    deletesBackfillComplete: current?.deletesBackfillComplete || false,
    oldestFetchedDocCreatedAt: current?.oldestFetchedDocCreatedAt,
    oldestFetchedDeleteCreatedAt: current?.oldestFetchedDeleteCreatedAt,
    latestSeenLiveCreatedAt: Math.max(
      current?.latestSeenLiveCreatedAt || 0,
      createdAt
    ),
  };
}

export function mergeDocumentBackfillCheckpoint(
  current: SyncCheckpointRecord | undefined,
  author: PublicKey,
  oldestFetchedDocCreatedAt: number | undefined,
  docsBackfillComplete: boolean
): SyncCheckpointRecord {
  return {
    author,
    latestSeenLiveCreatedAt: current?.latestSeenLiveCreatedAt,
    deletesBackfillComplete: current?.deletesBackfillComplete || false,
    oldestFetchedDeleteCreatedAt: current?.oldestFetchedDeleteCreatedAt,
    docsBackfillComplete,
    oldestFetchedDocCreatedAt:
      oldestFetchedDocCreatedAt ?? current?.oldestFetchedDocCreatedAt,
  };
}

export function mergeDeleteBackfillCheckpoint(
  current: SyncCheckpointRecord | undefined,
  author: PublicKey,
  oldestFetchedDeleteCreatedAt: number | undefined,
  deletesBackfillComplete: boolean
): SyncCheckpointRecord {
  return {
    author,
    latestSeenLiveCreatedAt: current?.latestSeenLiveCreatedAt,
    docsBackfillComplete: current?.docsBackfillComplete || false,
    oldestFetchedDocCreatedAt: current?.oldestFetchedDocCreatedAt,
    deletesBackfillComplete,
    oldestFetchedDeleteCreatedAt:
      oldestFetchedDeleteCreatedAt ?? current?.oldestFetchedDeleteCreatedAt,
  };
}

export async function applyStoredDocument(
  db: StashmapDB,
  document: StoredDocumentRecord
): Promise<void> {
  const [existingDocument, existingDelete] = await Promise.all([
    getStoredDocument(db, document.replaceableKey),
    getStoredDelete(db, document.replaceableKey),
  ]);

  if (existingDelete && existingDelete.deletedAt >= document.updatedMs) {
    return;
  }
  if (existingDocument && existingDocument.updatedMs >= document.updatedMs) {
    return;
  }

  await putStoredDocument(db, document);
  if (existingDelete && document.updatedMs > existingDelete.deletedAt) {
    await removeStoredDelete(db, document.replaceableKey);
  }
}

export async function applyStoredDelete(
  db: StashmapDB,
  deletion: StoredDeleteRecord
): Promise<void> {
  const [existingDocument, existingDelete] = await Promise.all([
    getStoredDocument(db, deletion.replaceableKey),
    getStoredDelete(db, deletion.replaceableKey),
  ]);

  if (existingDelete && existingDelete.deletedAt >= deletion.deletedAt) {
    return;
  }

  await putStoredDelete(db, deletion);
  if (existingDocument && existingDocument.updatedMs <= deletion.deletedAt) {
    await removeStoredDocument(db, deletion.replaceableKey);
  }
}

async function queryPermanentSyncFilters(
  relayPool: SimplePool,
  relayUrls: string[],
  filters: Filter[]
): Promise<Event[]> {
  if (relayUrls.length === 0 || filters.length === 0) {
    return [];
  }
  const eventMap = new Map<string, Event>();
  const responses = await Promise.all(
    filters.map((filter) =>
      collectEventsUntilIdle(relayPool, relayUrls, [filter], {
        maxWait: PERMANENT_SYNC_QUERY_MAX_WAIT_MS,
      })
    )
  );
  responses.flat().forEach((event) => {
    eventMap.set(event.id, event);
  });
  return [...eventMap.values()].sort((left, right) => {
    if (left.created_at !== right.created_at) {
      return left.created_at - right.created_at;
    }
    return left.id.localeCompare(right.id);
  });
}

async function loadPermanentSyncCheckpoints(
  db: StashmapDB | null,
  authors: PublicKey[]
): Promise<Map<PublicKey, SyncCheckpointRecord>> {
  if (!db || authors.length === 0) {
    return new Map();
  }
  const entries = await Promise.all(
    authors.map(
      async (author) => [author, await getSyncCheckpoint(db, author)] as const
    )
  );
  return entries.reduce((acc, [author, checkpoint]) => {
    if (checkpoint) {
      acc.set(author, checkpoint);
    }
    return acc;
  }, new Map<PublicKey, SyncCheckpointRecord>());
}

async function updateCheckpoint(
  db: StashmapDB | null,
  state: PermanentSyncState,
  author: PublicKey,
  updater: (current: SyncCheckpointRecord | undefined) => SyncCheckpointRecord
): Promise<void> {
  const nextCheckpoint = updater(state.checkpoints.get(author));
  state.checkpoints.set(author, nextCheckpoint);
  if (!db) {
    return;
  }
  await putSyncCheckpoint(db, nextCheckpoint);
}

export function startPermanentDocumentSync({
  db,
  relayPool,
  relayUrls,
  authors,
  addLiveEvents,
}: {
  db: StashmapDB | null;
  relayPool: SimplePool;
  relayUrls: string[];
  authors: PublicKey[];
  addLiveEvents?: (events: ImmutableMap<string, Event | UnsignedEvent>) => void;
}): () => void {
  if (
    relayUrls.length === 0 ||
    authors.length === 0 ||
    (!db && !addLiveEvents)
  ) {
    return () => {};
  }

  const state = {
    active: true,
    seenEventIds: new Set<string>(),
    checkpoints: new Map<PublicKey, SyncCheckpointRecord>(),
  };

  const applyIncomingEvent = async (event: Event): Promise<void> => {
    if (!state.active || !event.id || state.seenEventIds.has(event.id)) {
      return;
    }
    state.seenEventIds.add(event.id);

    if (!db) {
      addLiveEvents?.(ImmutableMap([[event.id, event]]));
    }

    if (event.kind === KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT) {
      if (db) {
        addLiveEvents?.(ImmutableMap([[event.id, event]]));
      }
      return;
    }

    const document = toStoredDocumentRecord(event);
    if (document) {
      if (db) {
        await applyStoredDocument(db, document);
      }
      await updateCheckpoint(db, state, document.author, (current) =>
        mergeLiveSyncCheckpoint(current, document.author, document.createdAt)
      );
      return;
    }

    const deletion = toStoredDeleteRecord(event);
    if (deletion) {
      if (db) {
        await applyStoredDelete(db, deletion);
      }
      await updateCheckpoint(db, state, deletion.author, (current) =>
        mergeLiveSyncCheckpoint(current, deletion.author, deletion.createdAt)
      );
    }
  };

  const applyQueriedEvents = async (
    events: ReadonlyArray<Event>
  ): Promise<void> => {
    await Promise.all(events.map((event) => applyIncomingEvent(event)));
  };

  const runCatchUp = async (): Promise<void> => {
    const filters = buildPermanentCatchUpFilters(authors, state.checkpoints);
    const events = await queryPermanentSyncFilters(
      relayPool,
      relayUrls,
      filters
    );
    if (!state.active || events.length === 0) {
      return;
    }
    await applyQueriedEvents(events);
  };

  const runBackfillPage = async ({
    author,
    kind,
  }: {
    author: PublicKey;
    kind: typeof KIND_KNOWLEDGE_DOCUMENT | typeof KIND_DELETE;
  }): Promise<void> => {
    if (!state.active) {
      return;
    }
    const checkpoint = state.checkpoints.get(author);
    const isDocumentKind = kind === KIND_KNOWLEDGE_DOCUMENT;
    const isComplete = isDocumentKind
      ? checkpoint?.docsBackfillComplete
      : checkpoint?.deletesBackfillComplete;
    if (isComplete) {
      return;
    }
    const oldestFetchedCreatedAt = isDocumentKind
      ? checkpoint?.oldestFetchedDocCreatedAt
      : checkpoint?.oldestFetchedDeleteCreatedAt;
    const filter = buildPermanentBackfillFilter({
      author,
      kind,
      until:
        oldestFetchedCreatedAt !== undefined
          ? oldestFetchedCreatedAt - 1
          : undefined,
    });
    const events = await queryPermanentSyncFilters(relayPool, relayUrls, [
      filter,
    ]);
    if (!state.active) {
      return;
    }
    if (events.length > 0) {
      await applyQueriedEvents(events);
    }
    const oldestCreatedAt =
      events.length > 0
        ? events.reduce(
            (oldest, event) => Math.min(oldest, event.created_at),
            Number.POSITIVE_INFINITY
          )
        : undefined;
    await updateCheckpoint(db, state, author, (current) =>
      isDocumentKind
        ? mergeDocumentBackfillCheckpoint(
            current,
            author,
            oldestCreatedAt,
            events.length < PERMANENT_SYNC_BACKFILL_PAGE_LIMIT
          )
        : mergeDeleteBackfillCheckpoint(
            current,
            author,
            oldestCreatedAt,
            events.length < PERMANENT_SYNC_BACKFILL_PAGE_LIMIT
          )
    );
    if (events.length === PERMANENT_SYNC_BACKFILL_PAGE_LIMIT) {
      await runBackfillPage({
        author,
        kind,
      });
    }
  };

  const runBackfillForAuthor = async (
    pendingAuthors: PublicKey[]
  ): Promise<void> => {
    const [author, ...restAuthors] = pendingAuthors;
    if (!author || !state.active) {
      return;
    }
    await Promise.all([
      runBackfillPage({
        author,
        kind: KIND_KNOWLEDGE_DOCUMENT,
      }),
      runBackfillPage({
        author,
        kind: KIND_DELETE,
      }),
    ]);
    await runBackfillForAuthor(restAuthors);
  };

  const runSnapshotSync = async (): Promise<void> => {
    if (!state.active || authors.length === 0) {
      return;
    }
    const events = await queryPermanentSyncFilters(relayPool, relayUrls, [
      { authors, kinds: [KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT] },
    ]);
    if (state.active && events.length > 0) {
      await applyQueriedEvents(events);
    }
  };

  loadPermanentSyncCheckpoints(db, authors)
    .then(async (checkpoints) => {
      state.checkpoints = checkpoints;
      await runCatchUp();
      await runSnapshotSync();
      await runBackfillForAuthor(authors);
    })
    .catch(() => undefined);

  const sub = relayPool.subscribeMany(
    relayUrls,
    buildPermanentSyncFilters(authors),
    {
      onevent(event: Event): void {
        applyIncomingEvent(event).catch(() => undefined);
      },
    }
  );

  return () => {
    state.active = false;
    sub.close();
  };
}
