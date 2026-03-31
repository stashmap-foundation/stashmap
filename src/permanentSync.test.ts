import { Event } from "nostr-tools";
import { Map } from "immutable";
import type { StashmapDB } from "./indexedDB";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
} from "./nostr";
import {
  applyStoredDelete,
  applyStoredDocument,
  buildPermanentSyncAuthors,
  buildPermanentCatchUpFilters,
  buildPermanentBackfillFilter,
  buildPermanentSyncFilters,
  mergeDeleteBackfillCheckpoint,
  mergeDocumentBackfillCheckpoint,
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

test("buildPermanentSyncAuthors includes user and deduplicates contacts", () => {
  const authors = buildPermanentSyncAuthors(
    ALICE,
    Map([[BOB, { publicKey: BOB }]])
  );

  expect(authors).toEqual([ALICE, BOB]);
});

test("buildPermanentSyncFilters creates broad document and delete filters", () => {
  expect(buildPermanentSyncFilters([ALICE, BOB])).toEqual([
    { authors: [ALICE, BOB], kinds: [KIND_KNOWLEDGE_DOCUMENT, KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT], limit: 0 },
    {
      authors: [ALICE, BOB],
      kinds: [KIND_DELETE],
      "#k": [`${KIND_KNOWLEDGE_DOCUMENT}`],
      limit: 0,
    },
  ]);
});

test("buildPermanentCatchUpFilters narrows to authors with checkpoints", () => {
  expect(
    buildPermanentCatchUpFilters(
      [ALICE, BOB],
      new globalThis.Map([
        [
          ALICE,
          {
            author: ALICE,
            docsBackfillComplete: false,
            deletesBackfillComplete: false,
            latestSeenLiveCreatedAt: 100,
          },
        ],
      ])
    )
  ).toEqual([
    {
      authors: [ALICE],
      kinds: [KIND_KNOWLEDGE_DOCUMENT],
      since: 0,
    },
    {
      authors: [ALICE],
      kinds: [KIND_DELETE],
      "#k": [`${KIND_KNOWLEDGE_DOCUMENT}`],
      since: 0,
    },
  ]);
});

test("buildPermanentBackfillFilter pages by author and until", () => {
  expect(
    buildPermanentBackfillFilter({
      author: ALICE,
      kind: KIND_KNOWLEDGE_DOCUMENT,
      until: 55,
    })
  ).toEqual({
    authors: [ALICE],
    kinds: [KIND_KNOWLEDGE_DOCUMENT],
    until: 55,
    limit: 200,
  });
});

test("toStoredDocumentRecord extracts replaceable document fields", () => {
  const event = {
    id: "doc-1",
    pubkey: ALICE,
    created_at: 10,
    kind: KIND_KNOWLEDGE_DOCUMENT,
    tags: [
      ["d", "root-1"],
      ["ms", "1234"],
    ],
    content: "# Root",
  } as unknown as Event;

  expect(toStoredDocumentRecord(event)).toEqual({
    replaceableKey: `${KIND_KNOWLEDGE_DOCUMENT}:alice:root-1`,
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
    kind: KIND_DELETE,
    tags: [
      ["a", `${KIND_KNOWLEDGE_DOCUMENT}:alice:root-1`],
      ["k", `${KIND_KNOWLEDGE_DOCUMENT}`],
      ["ms", "2234"],
    ],
    content: "",
  } as unknown as Event;

  expect(toStoredDeleteRecord(event)).toEqual({
    replaceableKey: `${KIND_KNOWLEDGE_DOCUMENT}:alice:root-1`,
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

test("mergeDocumentBackfillCheckpoint tracks oldest page and completion", () => {
  expect(
    mergeDocumentBackfillCheckpoint(
      {
        author: ALICE,
        docsBackfillComplete: false,
        deletesBackfillComplete: true,
        oldestFetchedDeleteCreatedAt: 50,
        latestSeenLiveCreatedAt: 90,
      },
      ALICE,
      20,
      true
    )
  ).toEqual({
    author: ALICE,
    docsBackfillComplete: true,
    deletesBackfillComplete: true,
    oldestFetchedDocCreatedAt: 20,
    oldestFetchedDeleteCreatedAt: 50,
    latestSeenLiveCreatedAt: 90,
  });
});

test("mergeDeleteBackfillCheckpoint tracks oldest page and completion", () => {
  expect(
    mergeDeleteBackfillCheckpoint(
      {
        author: ALICE,
        docsBackfillComplete: true,
        deletesBackfillComplete: false,
        oldestFetchedDocCreatedAt: 25,
        latestSeenLiveCreatedAt: 90,
      },
      ALICE,
      10,
      true
    )
  ).toEqual({
    author: ALICE,
    docsBackfillComplete: true,
    deletesBackfillComplete: true,
    oldestFetchedDocCreatedAt: 25,
    oldestFetchedDeleteCreatedAt: 10,
    latestSeenLiveCreatedAt: 90,
  });
});

test("applyStoredDocument ignores a document hidden by a newer delete", async () => {
  const db = {} as StashmapDB;
  indexedDBModule.getStoredDocument.mockResolvedValue(undefined);
  indexedDBModule.getStoredDelete.mockResolvedValue({
    replaceableKey: `${KIND_KNOWLEDGE_DOCUMENT}:alice:root-1`,
    author: ALICE,
    eventId: "del-1",
    createdAt: 11,
    deletedAt: 3000,
  });

  await applyStoredDocument(db, {
    replaceableKey: `${KIND_KNOWLEDGE_DOCUMENT}:alice:root-1`,
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
    replaceableKey: `${KIND_KNOWLEDGE_DOCUMENT}:alice:root-1`,
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
    replaceableKey: `${KIND_KNOWLEDGE_DOCUMENT}:alice:root-1`,
    author: ALICE,
    eventId: "del-1",
    createdAt: 11,
    deletedAt: 3000,
  });

  expect(indexedDBModule.putStoredDelete).toHaveBeenCalled();
  expect(indexedDBModule.removeStoredDocument).toHaveBeenCalledWith(
    db,
    `${KIND_KNOWLEDGE_DOCUMENT}:alice:root-1`
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
        kind: KIND_KNOWLEDGE_DOCUMENT,
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
    replaceableKey: `${KIND_KNOWLEDGE_DOCUMENT}:alice:root-1`,
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

test("startPermanentDocumentSync uses live limit-0 subscription and catch-up subscriptions", async () => {
  indexedDBModule.getSyncCheckpoint.mockImplementation(
    (db: StashmapDB, author: PublicKey) =>
      author === ALICE
        ? Promise.resolve({
            author: ALICE,
            docsBackfillComplete: true,
            deletesBackfillComplete: true,
            latestSeenLiveCreatedAt: 100,
          })
        : Promise.resolve(undefined)
  );
  const subscribeMany = jest.fn((_relayUrls, _filters, params) => {
    Promise.resolve().then(() => {
      params.onclose?.();
    });
    return { close: jest.fn() };
  });

  startPermanentDocumentSync({
    db: {} as StashmapDB,
    relayPool: {
      subscribeMany,
    } as unknown as import("nostr-tools").SimplePool,
    relayUrls: ["wss://relay.example"],
    authors: [ALICE],
  });

  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

  expect(subscribeMany).toHaveBeenCalledWith(
    ["wss://relay.example"],
    [
      {
        authors: [ALICE],
        kinds: [KIND_KNOWLEDGE_DOCUMENT, KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT],
        limit: 0,
      },
      {
        authors: [ALICE],
        kinds: [KIND_DELETE],
        "#k": [`${KIND_KNOWLEDGE_DOCUMENT}`],
        limit: 0,
      },
    ],
    expect.any(Object)
  );
  expect(subscribeMany).toHaveBeenCalledWith(
    ["wss://relay.example"],
    [{ authors: [ALICE], kinds: [KIND_KNOWLEDGE_DOCUMENT], since: 0 }],
    expect.any(Object)
  );
  expect(subscribeMany).toHaveBeenCalledWith(
    ["wss://relay.example"],
    [
      {
        authors: [ALICE],
        kinds: [KIND_DELETE],
        "#k": [`${KIND_KNOWLEDGE_DOCUMENT}`],
        since: 0,
      },
    ],
    expect.any(Object)
  );
});
