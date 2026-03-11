/* eslint-disable functional/immutable-data */
import { Map as ImmutableMap } from "immutable";
import { Event, Filter, SimplePool, UnsignedEvent } from "nostr-tools";
import { findTag, getEventMs } from "./nostrEvents";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
  getReplaceableKey,
} from "./nostr";
import type {
  StashmapDB,
  StoredDeleteRecord,
  StoredDocumentRecord,
  SyncCheckpointRecord,
} from "./indexedDB";
import {
  getSyncCheckpoint,
  getStoredDelete,
  getStoredDocument,
  putStoredDelete,
  putStoredDocument,
  putSyncCheckpoint,
  removeStoredDelete,
  removeStoredDocument,
} from "./indexedDB";

export function buildPermanentSyncAuthors(
  myself: PublicKey,
  contacts: Contacts,
  projectMembers: Members
): PublicKey[] {
  return contacts
    .keySeq()
    .toSet()
    .union(projectMembers.keySeq().toSet())
    .add(myself)
    .toArray()
    .sort();
}

export function buildPermanentSyncFilters(authors: PublicKey[]): Filter[] {
  if (authors.length === 0) {
    return [];
  }
  return [
    {
      authors,
      kinds: [KIND_KNOWLEDGE_DOCUMENT],
    },
    {
      authors,
      kinds: [KIND_DELETE],
      "#k": [`${KIND_KNOWLEDGE_DOCUMENT}`],
    },
  ];
}

function getStoredEventID(
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

  const filters = buildPermanentSyncFilters(authors);
  const seenEventIds = new Set<string>();
  const state = {
    active: true,
  };

  const updateLiveSyncCheckpoint = async (
    author: PublicKey,
    createdAt: number
  ): Promise<void> => {
    if (!db) {
      return;
    }
    const existingCheckpoint = await getSyncCheckpoint(db, author);
    await putSyncCheckpoint(
      db,
      mergeLiveSyncCheckpoint(existingCheckpoint, author, createdAt)
    );
  };

  const applyIncomingEvent = async (event: Event): Promise<void> => {
    if (!state.active || !event.id || seenEventIds.has(event.id)) {
      return;
    }
    seenEventIds.add(event.id);

    if (!db) {
      addLiveEvents?.(ImmutableMap([[event.id, event]]));
      return;
    }

    const document = toStoredDocumentRecord(event);
    if (document) {
      await applyStoredDocument(db, document);
      await updateLiveSyncCheckpoint(document.author, document.createdAt);
      return;
    }

    const deletion = toStoredDeleteRecord(event);
    if (deletion) {
      await applyStoredDelete(db, deletion);
      await updateLiveSyncCheckpoint(deletion.author, deletion.createdAt);
    }
  };

  const sub = relayPool.subscribeMany(relayUrls, filters, {
    onevent(event: Event): void {
      applyIncomingEvent(event).catch(() => undefined);
    },
  });

  return () => {
    state.active = false;
    sub.close();
  };
}
