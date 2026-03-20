import { Event } from "nostr-tools";
import { KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT } from "./nostrCore";
import { fetchSnapshots } from "./snapshotRepository";
import type { StashmapDB, StoredSnapshotRecord } from "./indexedDB";

jest.mock("./indexedDB", () => ({
  getStoredSnapshot: jest.fn(),
  putStoredSnapshot: jest.fn(() => Promise.resolve()),
}));

jest.mock("./eventQuery", () => ({
  collectEventsUntilIdle: jest.fn(() => Promise.resolve([])),
}));

const indexedDBModule = jest.requireMock("./indexedDB") as {
  getStoredSnapshot: jest.Mock;
  putStoredSnapshot: jest.Mock;
};

const eventQueryModule = jest.requireMock("./eventQuery") as {
  collectEventsUntilIdle: jest.Mock;
};

const ALICE = "alice" as PublicKey;

const CACHED_SNAPSHOT: StoredSnapshotRecord = {
  replaceableKey: `${KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT}:alice:snap-1`,
  author: ALICE,
  eventId: "snap-evt-1",
  dTag: "snap-1",
  sourceRootShortID: "root-short",
  createdAt: 100,
  updatedMs: 100_000,
  content: "# Cached",
  tags: [
    ["d", "snap-1"],
    ["source", "root-short"],
    ["ms", "100000"],
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
});

test("cache hit skips relay query", async () => {
  indexedDBModule.getStoredSnapshot.mockResolvedValue(CACHED_SNAPSHOT);

  const result = await fetchSnapshots({
    db: {} as StashmapDB,
    relayPool: {},
    relayUrls: ["wss://relay.example"],
    queries: [{ author: ALICE, dTag: "snap-1" }],
  });

  expect(result).toEqual([CACHED_SNAPSHOT]);
  expect(eventQueryModule.collectEventsUntilIdle).not.toHaveBeenCalled();
});

test("cache miss queries relay and persists result", async () => {
  indexedDBModule.getStoredSnapshot.mockResolvedValue(undefined);

  const relayEvent = {
    id: "snap-evt-2",
    pubkey: ALICE,
    created_at: 200,
    kind: KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
    tags: [
      ["d", "snap-2"],
      ["source", "root-2"],
      ["ms", "200000"],
    ],
    content: "# FromRelay",
  } as unknown as Event;

  eventQueryModule.collectEventsUntilIdle.mockResolvedValue([relayEvent]);

  const db = {} as StashmapDB;
  const result = await fetchSnapshots({
    db,
    relayPool: {},
    relayUrls: ["wss://relay.example"],
    queries: [{ author: ALICE, dTag: "snap-2" }],
  });

  expect(result).toHaveLength(1);
  expect(result[0].dTag).toBe("snap-2");
  expect(result[0].content).toBe("# FromRelay");

  expect(eventQueryModule.collectEventsUntilIdle).toHaveBeenCalledWith(
    {},
    ["wss://relay.example"],
    [
      {
        kinds: [KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT],
        authors: [ALICE],
        "#d": ["snap-2"],
      },
    ],
    { maxWait: 5_000 }
  );

  expect(indexedDBModule.putStoredSnapshot).toHaveBeenCalledWith(
    db,
    expect.objectContaining({ dTag: "snap-2" })
  );
});

test("mixed hit/miss only queries missing dTags", async () => {
  indexedDBModule.getStoredSnapshot.mockImplementation(
    (_db: StashmapDB, key: string) =>
      key === CACHED_SNAPSHOT.replaceableKey
        ? Promise.resolve(CACHED_SNAPSHOT)
        : Promise.resolve(undefined)
  );

  eventQueryModule.collectEventsUntilIdle.mockResolvedValue([]);

  await fetchSnapshots({
    db: {} as StashmapDB,
    relayPool: {},
    relayUrls: ["wss://relay.example"],
    queries: [
      { author: ALICE, dTag: "snap-1" },
      { author: ALICE, dTag: "snap-missing" },
    ],
  });

  expect(eventQueryModule.collectEventsUntilIdle).toHaveBeenCalledWith(
    {},
    ["wss://relay.example"],
    [
      {
        kinds: [KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT],
        authors: [ALICE],
        "#d": ["snap-missing"],
      },
    ],
    { maxWait: 5_000 }
  );
});
