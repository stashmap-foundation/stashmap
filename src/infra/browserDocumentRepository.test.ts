import {
  createBrowserDocumentRepository,
  type SnapshotKey,
} from "./browserDocumentRepository";
import type { StashmapDB, StoredSnapshotRecord } from "./indexedDB";

jest.mock("./documentStoreRepository", () => ({
  loadInitialDocumentStoreRecords: jest.fn(() =>
    Promise.resolve({
      documents: [],
      deletes: [],
    })
  ),
  persistDocumentStoreEvents: jest.fn(() => Promise.resolve()),
  subscribeToDocumentStore: jest.fn(() => () => undefined),
}));

jest.mock("./indexedDB", () => ({
  getStoredSnapshot: jest.fn(() => Promise.resolve(undefined)),
  subscribeSnapshotStore: jest.fn(() => () => undefined),
}));

jest.mock("./snapshotRepository", () => ({
  fetchSnapshots: jest.fn(() => Promise.resolve([])),
}));

const documentStoreRepositoryModule = jest.requireMock(
  "./documentStoreRepository"
) as {
  loadInitialDocumentStoreRecords: jest.Mock;
  persistDocumentStoreEvents: jest.Mock;
  subscribeToDocumentStore: jest.Mock;
};

const indexedDbModule = jest.requireMock("./indexedDB") as {
  getStoredSnapshot: jest.Mock;
  subscribeSnapshotStore: jest.Mock;
};

const snapshotRepositoryModule = jest.requireMock("./snapshotRepository") as {
  fetchSnapshots: jest.Mock;
};

const ALICE = "alice" as PublicKey;
const DB = {} as StashmapDB;

beforeEach(() => {
  jest.clearAllMocks();
});

test("loadCurrent delegates to document store repository", async () => {
  documentStoreRepositoryModule.loadInitialDocumentStoreRecords.mockResolvedValue(
    {
      documents: [],
      deletes: [],
    }
  );
  const repository = createBrowserDocumentRepository({
    db: DB,
    relayPool: {},
    relayUrls: ["wss://relay.example"],
  });

  const result = await repository.loadCurrent();

  expect(result).toEqual({
    documents: [],
    deletes: [],
  });
  expect(
    documentStoreRepositoryModule.loadInitialDocumentStoreRecords
  ).toHaveBeenCalledWith(DB);
});

test("writeLiveEvents delegates persistence through the current store", async () => {
  const repository = createBrowserDocumentRepository({
    db: DB,
    relayPool: {},
    relayUrls: ["wss://relay.example"],
  });
  const events = [
    {
      kind: 34772,
      pubkey: ALICE,
      created_at: 1,
      tags: [["d", "root-1"]],
      content: "# Root",
    },
  ];

  await repository.writeLiveEvents(events);

  expect(
    documentStoreRepositoryModule.persistDocumentStoreEvents
  ).toHaveBeenCalledWith(DB, events);
});

test("getSnapshots loads cached snapshots only", async () => {
  const cachedSnapshot: StoredSnapshotRecord = {
    replaceableKey: "34773:alice:snap-1",
    author: ALICE,
    eventId: "snapshot-event-1",
    dTag: "snap-1",
    sourceRootShortID: "root-1",
    createdAt: 1,
    updatedMs: 1_000,
    content: "# Snapshot",
    tags: [["d", "snap-1"]],
  };
  indexedDbModule.getStoredSnapshot.mockResolvedValue(cachedSnapshot);

  const repository = createBrowserDocumentRepository({
    db: DB,
    relayPool: {},
    relayUrls: ["wss://relay.example"],
  });

  const result = await repository.getSnapshots([
    {
      author: ALICE,
      dTag: "snap-1",
    },
  ]);

  expect(result).toEqual([cachedSnapshot]);
  expect(indexedDbModule.getStoredSnapshot).toHaveBeenCalledWith(
    DB,
    "34773:alice:snap-1"
  );
});

test("ensureSnapshots fetches unique missing snapshots", async () => {
  const repository = createBrowserDocumentRepository({
    db: DB,
    relayPool: {},
    relayUrls: ["wss://relay.example"],
  });
  const keys: SnapshotKey[] = [
    { author: ALICE, dTag: "snap-1" },
    { author: ALICE, dTag: "snap-1" },
  ];

  await repository.ensureSnapshots(keys);

  expect(snapshotRepositoryModule.fetchSnapshots).toHaveBeenCalledWith({
    db: DB,
    relayPool: {},
    relayUrls: ["wss://relay.example"],
    queries: [{ author: ALICE, dTag: "snap-1" }],
  });
});

test("subscribe helpers delegate to the underlying stores", () => {
  const repository = createBrowserDocumentRepository({
    db: DB,
    relayPool: {},
    relayUrls: ["wss://relay.example"],
  });
  const onCurrent = (): void => undefined;
  const onSnapshot = (): void => undefined;

  repository.subscribeCurrent(onCurrent);
  repository.subscribeSnapshots(onSnapshot);

  expect(
    documentStoreRepositoryModule.subscribeToDocumentStore
  ).toHaveBeenCalledWith(DB, onCurrent);
  expect(indexedDbModule.subscribeSnapshotStore).toHaveBeenCalledWith(
    DB,
    onSnapshot
  );
});
