import type { StashmapDB, StoredSnapshotRecord } from "./indexedDB";
import { getStoredSnapshot, putStoredSnapshot } from "./indexedDB";
import { collectEventsUntilIdle, EventQueryClient } from "./eventQuery";
import { KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT } from "./nostrCore";
import { toStoredSnapshotRecord } from "./permanentSync";

const SNAPSHOT_QUERY_MAX_WAIT_MS = 5_000;

type SnapshotQuery = {
  readonly author: string;
  readonly dTag: string;
};

export async function fetchSnapshots({
  db,
  relayPool,
  relayUrls,
  queries,
}: {
  db: StashmapDB | null;
  relayPool: EventQueryClient;
  relayUrls: string[];
  queries: ReadonlyArray<SnapshotQuery>;
}): Promise<ReadonlyArray<StoredSnapshotRecord>> {
  if (queries.length === 0) {
    return [];
  }

  const replaceableKeys = queries.map(
    (q) => `${KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT}:${q.author}:${q.dTag}`
  );

  const cached = db
    ? await Promise.all(
        replaceableKeys.map((key) => getStoredSnapshot(db, key))
      )
    : replaceableKeys.map(() => undefined);

  const { cachedRecords, missingQueries } = cached.reduce(
    (acc, record, i) =>
      record
        ? {
            cachedRecords: [...acc.cachedRecords, record],
            missingQueries: acc.missingQueries,
          }
        : {
            cachedRecords: acc.cachedRecords,
            missingQueries: [...acc.missingQueries, queries[i]],
          },
    {
      cachedRecords: [] as StoredSnapshotRecord[],
      missingQueries: [] as SnapshotQuery[],
    }
  );

  if (missingQueries.length === 0) {
    return cachedRecords;
  }

  const events = await collectEventsUntilIdle(
    relayPool,
    relayUrls,
    [
      {
        kinds: [KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT],
        authors: [...new Set(missingQueries.map((q) => q.author))],
        "#d": missingQueries.map((q) => q.dTag),
      },
    ],
    { maxWait: SNAPSHOT_QUERY_MAX_WAIT_MS }
  );

  const freshRecords = events.reduce((acc, event) => {
    const record = toStoredSnapshotRecord(event);
    return record ? [...acc, record] : acc;
  }, [] as StoredSnapshotRecord[]);

  await Promise.all(
    freshRecords
      .filter(() => db !== null)
      .map((record) => putStoredSnapshot(db as StashmapDB, record))
  );

  return [...cachedRecords, ...freshRecords];
}
