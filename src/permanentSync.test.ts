import { Event } from "nostr-tools";
import { Map } from "immutable";
import type { StashmapDB } from "./indexedDB";
import {
  applyStoredDelete,
  applyStoredDocument,
  buildPermanentSyncAuthors,
  buildPermanentSyncFilters,
  mergeLiveSyncCheckpoint,
  startPermanentDocumentSync,
  toStoredDeleteRecord,
  toStoredDocumentRecord,
} from "./permanentSync";

jest.mock("./indexedDB", () => ({
  getSyncCheckpoint: jest.fn(),
  getStoredDocument: jest.fn(),
  getStoredDelete: jest.fn(),
  putStoredDocument: jest.fn(() => Promise.resolve()),
  putStoredDelete: jest.fn(() => Promise.resolve()),
  removeStoredDocument: jest.fn(() => Promise.resolve()),
  removeStoredDelete: jest.fn(() => Promise.resolve()),
  putSyncCheckpoint: jest.fn(() => Promise.resolve()),
}));

const indexedDBModule = jest.requireMock("./indexedDB") as {
  getSyncCheckpoint: jest.Mock;
  getStoredDocument: jest.Mock;
  getStoredDelete: jest.Mock;
  putStoredDocument: jest.Mock;
  putStoredDelete: jest.Mock;
  removeStoredDocument: jest.Mock;
  removeStoredDelete: jest.Mock;
  putSyncCheckpoint: jest.Mock;
};

const ALICE = "alice" as PublicKey;
const BOB = "bob" as PublicKey;

beforeEach(() => {
  jest.clearAllMocks();
});

test("buildPermanentSyncAuthors includes user and deduplicates contacts/members", () => {
  const authors = buildPermanentSyncAuthors(
    ALICE,
    Map([[BOB, { publicKey: BOB }]]),
    Map([[ALICE, { publicKey: ALICE, votes: 1 }]])
  );

  expect(authors).toEqual([ALICE, BOB]);
});

test("buildPermanentSyncFilters creates broad document and delete filters", () => {
  expect(buildPermanentSyncFilters([ALICE, BOB])).toEqual([
    { authors: [ALICE, BOB], kinds: [34770] },
    {
      authors: [ALICE, BOB],
      kinds: [5],
      "#k": ["34770"],
    },
  ]);
});

test("toStoredDocumentRecord extracts replaceable document fields", () => {
  const event = {
    id: "doc-1",
    pubkey: ALICE,
    created_at: 10,
    kind: 34770,
    tags: [
      ["d", "root-1"],
      ["ms", "1234"],
    ],
    content: "# Root",
  } as unknown as Event;

  expect(toStoredDocumentRecord(event)).toEqual({
    replaceableKey: "34770:alice:root-1",
    author: ALICE,
    eventId: "doc-1",
    dTag: "root-1",
    createdAt: 10,
    updatedMs: 1234,
    content: "# Root",
    tags: event.tags,
  });
});

test("toStoredDeleteRecord extracts document delete records", () => {
  const event = {
    id: "del-1",
    pubkey: ALICE,
    created_at: 11,
    kind: 5,
    tags: [
      ["a", "34770:alice:root-1"],
      ["k", "34770"],
      ["ms", "2234"],
    ],
    content: "",
  } as unknown as Event;

  expect(toStoredDeleteRecord(event)).toEqual({
    replaceableKey: "34770:alice:root-1",
    author: ALICE,
    eventId: "del-1",
    createdAt: 11,
    deletedAt: 2234,
  });
});

test("mergeLiveSyncCheckpoint keeps the latest seen created_at", () => {
  expect(
    mergeLiveSyncCheckpoint(
      {
        author: ALICE,
        docsBackfillComplete: false,
        deletesBackfillComplete: false,
        latestSeenLiveCreatedAt: 5,
      },
      ALICE,
      9
    )
  ).toEqual({
    author: ALICE,
    docsBackfillComplete: false,
    deletesBackfillComplete: false,
    oldestFetchedDocCreatedAt: undefined,
    oldestFetchedDeleteCreatedAt: undefined,
    latestSeenLiveCreatedAt: 9,
  });
});

test("applyStoredDocument ignores a document hidden by a newer delete", async () => {
  const db = {} as StashmapDB;
  indexedDBModule.getStoredDocument.mockResolvedValue(undefined);
  indexedDBModule.getStoredDelete.mockResolvedValue({
    replaceableKey: "34770:alice:root-1",
    author: ALICE,
    eventId: "del-1",
    createdAt: 11,
    deletedAt: 3000,
  });

  await applyStoredDocument(db, {
    replaceableKey: "34770:alice:root-1",
    author: ALICE,
    eventId: "doc-1",
    dTag: "root-1",
    createdAt: 10,
    updatedMs: 2000,
    content: "# Root",
    tags: [],
  });

  expect(indexedDBModule.putStoredDocument).not.toHaveBeenCalled();
});

test("applyStoredDelete removes an older stored document", async () => {
  const db = {} as StashmapDB;
  indexedDBModule.getStoredDocument.mockResolvedValue({
    replaceableKey: "34770:alice:root-1",
    author: ALICE,
    eventId: "doc-1",
    dTag: "root-1",
    createdAt: 10,
    updatedMs: 2000,
    content: "# Root",
    tags: [],
  });
  indexedDBModule.getStoredDelete.mockResolvedValue(undefined);

  await applyStoredDelete(db, {
    replaceableKey: "34770:alice:root-1",
    author: ALICE,
    eventId: "del-1",
    createdAt: 11,
    deletedAt: 3000,
  });

  expect(indexedDBModule.putStoredDelete).toHaveBeenCalled();
  expect(indexedDBModule.removeStoredDocument).toHaveBeenCalledWith(
    db,
    "34770:alice:root-1"
  );
});

test("startPermanentDocumentSync applies document events immediately", async () => {
  const db = {} as StashmapDB;
  indexedDBModule.getStoredDocument.mockResolvedValue(undefined);
  indexedDBModule.getStoredDelete.mockResolvedValue(undefined);
  indexedDBModule.getSyncCheckpoint.mockResolvedValue(undefined);
  const subscribeMany = jest.fn(
    (
      _relayUrls: string[],
      _filters: unknown,
      handlers: { onevent: (event: Event) => void }
    ) => {
      handlers.onevent({
        id: "doc-1",
        pubkey: ALICE,
        created_at: 10,
        kind: 34770,
        tags: [
          ["d", "root-1"],
          ["ms", "1234"],
        ],
        content: "# Root",
      } as unknown as Event);
      return { close: jest.fn() };
    }
  );

  startPermanentDocumentSync({
    db,
    relayPool: { subscribeMany } as unknown as import("nostr-tools").SimplePool,
    relayUrls: ["wss://relay.example"],
    authors: [ALICE],
  });

  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

  expect(indexedDBModule.putStoredDocument).toHaveBeenCalledWith(db, {
    replaceableKey: "34770:alice:root-1",
    author: ALICE,
    eventId: "doc-1",
    dTag: "root-1",
    createdAt: 10,
    updatedMs: 1234,
    content: "# Root",
    tags: [
      ["d", "root-1"],
      ["ms", "1234"],
    ],
  });
  expect(indexedDBModule.putSyncCheckpoint).toHaveBeenCalled();
});
