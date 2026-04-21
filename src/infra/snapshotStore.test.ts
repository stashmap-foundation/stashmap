import { Event } from "nostr-tools";
import type { StashmapDB } from "./nostr/replica/indexedDB";
import type { EventQueryClient } from "../eventQuery";
import {
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
} from "../nostr";
import { toStoredSnapshotRecord, fetchSnapshots } from "./snapshotStore";

jest.mock("./nostr/replica/indexedDB", () => ({
  ...jest.requireActual("./nostr/replica/indexedDB"),
  getStoredSnapshot: jest.fn(),
  putStoredSnapshot: jest.fn(() => Promise.resolve()),
}));

jest.mock("../eventQuery", () => ({
  ...jest.requireActual("../eventQuery"),
  collectEventsUntilIdle: jest.fn(() => Promise.resolve([])),
}));

const indexedDBModule = jest.requireMock("./nostr/replica/indexedDB") as {
  getStoredSnapshot: jest.Mock;
  putStoredSnapshot: jest.Mock;
};

const eventQueryModule = jest.requireMock("../eventQuery") as {
  collectEventsUntilIdle: jest.Mock;
};

const FAKE_AUTHOR = "alice" as PublicKey;
const SOURCE_AUTHOR = "source_alice" as PublicKey;

beforeEach(() => {
  jest.clearAllMocks();
});

test("toStoredSnapshotRecord converts a valid snapshot event", () => {
  const event = {
    id: "snap-1",
    pubkey: FAKE_AUTHOR,
    created_at: 10,
    kind: KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
    tags: [
      ["d", "root-1"],
      ["ms", "5000"],
      ["source", "src-root-short"],
      ["source_author", SOURCE_AUTHOR],
    ],
    content: "# Snapshot",
  } as unknown as Event;

  expect(toStoredSnapshotRecord(event)).toEqual({
    replaceableKey: `${KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT}:alice:root-1`,
    author: FAKE_AUTHOR,
    eventId: "snap-1",
    dTag: "root-1",
    createdAt: 10,
    updatedMs: 5000,
    content: "# Snapshot",
    tags: event.tags,
    sourceAuthor: SOURCE_AUTHOR,
    sourceRootShortID: "src-root-short",
  });
});

test("toStoredSnapshotRecord returns undefined for wrong kind", () => {
  const event = {
    id: "doc-1",
    pubkey: FAKE_AUTHOR,
    created_at: 10,
    kind: KIND_KNOWLEDGE_DOCUMENT,
    tags: [
      ["d", "root-1"],
      ["ms", "5000"],
    ],
    content: "# Doc",
  } as unknown as Event;

  expect(toStoredSnapshotRecord(event)).toBeUndefined();
});

test("toStoredSnapshotRecord returns undefined for missing d-tag", () => {
  const event = {
    id: "snap-2",
    pubkey: FAKE_AUTHOR,
    created_at: 10,
    kind: KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
    tags: [["ms", "5000"]],
    content: "# Snapshot",
  } as unknown as Event;

  expect(toStoredSnapshotRecord(event)).toBeUndefined();
});

test("toStoredSnapshotRecord extracts sourceRootShortID from source tag", () => {
  const event = {
    id: "snap-3",
    pubkey: FAKE_AUTHOR,
    created_at: 10,
    kind: KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
    tags: [
      ["d", "root-1"],
      ["source", "my-source-root"],
      ["source_author", SOURCE_AUTHOR],
    ],
    content: "# Snapshot",
  } as unknown as Event;

  const record = toStoredSnapshotRecord(event);
  expect(record?.sourceRootShortID).toBe("my-source-root");
});

test("toStoredSnapshotRecord returns undefined without source_author tag", () => {
  const event = {
    id: "snap-4",
    pubkey: FAKE_AUTHOR,
    created_at: 10,
    kind: KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
    tags: [["d", "root-1"]],
    content: "# Snapshot",
  } as unknown as Event;

  expect(toStoredSnapshotRecord(event)).toBeUndefined();
});

test("fetchSnapshots returns cached snapshot without relay query", async () => {
  const db = {} as StashmapDB;
  const cachedRecord = {
    replaceableKey: `${KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT}:alice:root-1`,
    author: FAKE_AUTHOR,
    sourceAuthor: SOURCE_AUTHOR,
    eventId: "snap-1",
    dTag: "root-1",
    createdAt: 10,
    updatedMs: 5000,
    content: "# Snapshot",
    tags: [["d", "root-1"]],
  };
  indexedDBModule.getStoredSnapshot.mockResolvedValue(cachedRecord);

  const result = await fetchSnapshots(
    db,
    {} as EventQueryClient,
    ["wss://relay.example"],
    [{ author: FAKE_AUTHOR, dTag: "root-1" }]
  );

  expect(result.get("root-1")).toEqual(cachedRecord);
  expect(eventQueryModule.collectEventsUntilIdle).not.toHaveBeenCalled();
});

test("fetchSnapshots queries relays for uncached snapshots and stores them", async () => {
  const db = {} as StashmapDB;
  indexedDBModule.getStoredSnapshot.mockResolvedValue(undefined);

  const snapshotEvent = {
    id: "snap-1",
    pubkey: FAKE_AUTHOR,
    created_at: 10,
    kind: KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
    tags: [
      ["d", "root-1"],
      ["ms", "5000"],
      ["source_author", SOURCE_AUTHOR],
    ],
    content: "# Snapshot",
  } as unknown as Event;

  eventQueryModule.collectEventsUntilIdle.mockResolvedValue([snapshotEvent]);

  const result = await fetchSnapshots(
    db,
    {} as EventQueryClient,
    ["wss://relay.example"],
    [{ author: FAKE_AUTHOR, dTag: "root-1" }]
  );

  expect(result.has("root-1")).toBe(true);
  expect(result.get("root-1")?.content).toBe("# Snapshot");
  expect(indexedDBModule.putStoredSnapshot).toHaveBeenCalled();
});

test("fetchSnapshots handles mixed cached and uncached", async () => {
  const db = {} as StashmapDB;
  const cachedRecord = {
    replaceableKey: `${KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT}:alice:root-1`,
    author: FAKE_AUTHOR,
    sourceAuthor: SOURCE_AUTHOR,
    eventId: "snap-1",
    dTag: "root-1",
    createdAt: 10,
    updatedMs: 5000,
    content: "# Cached",
    tags: [["d", "root-1"]],
  };

  indexedDBModule.getStoredSnapshot.mockImplementation(
    (_db: StashmapDB, key: string) =>
      key === `${KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT}:alice:root-1`
        ? Promise.resolve(cachedRecord)
        : Promise.resolve(undefined)
  );

  const uncachedEvent = {
    id: "snap-2",
    pubkey: FAKE_AUTHOR,
    created_at: 20,
    kind: KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
    tags: [
      ["d", "root-2"],
      ["ms", "6000"],
      ["source_author", SOURCE_AUTHOR],
    ],
    content: "# Uncached",
  } as unknown as Event;
  eventQueryModule.collectEventsUntilIdle.mockResolvedValue([uncachedEvent]);

  const result = await fetchSnapshots(
    db,
    {} as EventQueryClient,
    ["wss://relay.example"],
    [
      { author: FAKE_AUTHOR, dTag: "root-1" },
      { author: FAKE_AUTHOR, dTag: "root-2" },
    ]
  );

  expect(result.get("root-1")?.content).toBe("# Cached");
  expect(result.get("root-2")?.content).toBe("# Uncached");
});

test("fetchSnapshots returns empty map for empty requests", async () => {
  const db = {} as StashmapDB;
  const result = await fetchSnapshots(
    db,
    {} as EventQueryClient,
    ["wss://relay.example"],
    []
  );
  expect(result.size).toBe(0);
  expect(eventQueryModule.collectEventsUntilIdle).not.toHaveBeenCalled();
});
