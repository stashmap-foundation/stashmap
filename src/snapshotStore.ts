import { Map } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import { KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT, getReplaceableKey } from "./nostr";
import { findTag, getEventMs } from "./nostrEvents";
import { collectEventsUntilIdle, EventQueryClient } from "./eventQuery";
import { parseDocumentEvent } from "./markdownNodes";
import { storedDocumentToEvent } from "./documentMaterialization";
import { getStoredEventID } from "./permanentSync";
import type { StashmapDB, StoredSnapshotRecord } from "./indexedDB";
import { getStoredSnapshot, putStoredSnapshot } from "./indexedDB";

export type SnapshotRequest = {
  readonly author: PublicKey;
  readonly dTag: string;
};

const SNAPSHOT_FETCH_MAX_WAIT_MS = 5_000;

export function toStoredSnapshotRecord(
  event: Event | UnsignedEvent
): StoredSnapshotRecord | undefined {
  if (event.kind !== KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT) {
    return undefined;
  }
  const replaceableKey = getReplaceableKey(event);
  const dTag = findTag(event, "d");
  if (!replaceableKey || !dTag) {
    return undefined;
  }
  const sourceRootShortID = findTag(event, "source");
  return {
    replaceableKey,
    author: event.pubkey as PublicKey,
    eventId: getStoredEventID(event, replaceableKey),
    dTag,
    createdAt: event.created_at,
    updatedMs: getEventMs(event),
    content: event.content,
    tags: event.tags,
    ...(sourceRootShortID !== undefined ? { sourceRootShortID } : {}),
  };
}

export async function fetchSnapshots(
  db: StashmapDB,
  client: EventQueryClient,
  relayUrls: string[],
  requests: ReadonlyArray<SnapshotRequest>
): Promise<Map<string, StoredSnapshotRecord>> {
  if (requests.length === 0) {
    return Map();
  }

  const cacheChecks = await Promise.all(
    requests.map(async (req) => {
      const key = `${KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT}:${req.author}:${req.dTag}`;
      const cached = await getStoredSnapshot(db, key);
      return { req, cached };
    })
  );

  const cachedResults = cacheChecks.reduce(
    (acc, { req, cached }) => (cached ? acc.set(req.dTag, cached) : acc),
    Map<string, StoredSnapshotRecord>()
  );

  const uncached = cacheChecks
    .filter(({ cached }) => !cached)
    .map(({ req }) => req);

  if (uncached.length === 0) {
    return cachedResults;
  }

  const authors = [...new Set(uncached.map((r) => r.author))];
  const dTags = uncached.map((r) => r.dTag);

  const events = await collectEventsUntilIdle(
    client,
    relayUrls,
    [
      {
        authors,
        kinds: [KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT],
        "#d": dTags,
      },
    ],
    { maxWait: SNAPSHOT_FETCH_MAX_WAIT_MS }
  );

  const fetchedRecords = events.reduce((acc, event) => {
    const record = toStoredSnapshotRecord(event);
    if (!record || acc.has(record.dTag)) {
      return acc;
    }
    return acc.set(record.dTag, record);
  }, Map<string, StoredSnapshotRecord>());

  await Promise.all(
    fetchedRecords
      .valueSeq()
      .map((record) => putStoredSnapshot(db, record))
      .toArray()
  );

  return cachedResults.merge(fetchedRecords);
}

export function materializeSnapshot(
  record: StoredSnapshotRecord
): Map<string, GraphNode> {
  return parseDocumentEvent(storedDocumentToEvent(record));
}

export async function loadAndMaterializeSnapshots(
  db: StashmapDB,
  client: EventQueryClient,
  relayUrls: string[],
  requests: ReadonlyArray<SnapshotRequest>
): Promise<Map<string, Map<string, GraphNode>>> {
  const records = await fetchSnapshots(db, client, relayUrls, requests);
  return records.map((record) => materializeSnapshot(record));
}
