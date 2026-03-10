/* eslint-disable functional/immutable-data */
import { clearDatabase, openDB } from "./indexedDB";

type FakeOpenRequest = {
  result: IDBDatabase;
  onsuccess: ((this: IDBOpenDBRequest, ev: Event) => unknown) | null;
  onerror: ((this: IDBOpenDBRequest, ev: Event) => unknown) | null;
  onupgradeneeded:
    | ((this: IDBOpenDBRequest, ev: IDBVersionChangeEvent) => unknown)
    | null;
  error: DOMException | null;
};

type FakeDeleteRequest = {
  onsuccess: ((this: IDBOpenDBRequest, ev: Event) => unknown) | null;
  onerror: ((this: IDBOpenDBRequest, ev: Event) => unknown) | null;
  onblocked: ((this: IDBOpenDBRequest, ev: Event) => unknown) | null;
  error: DOMException | null;
};

function createFakeOpenRequest(db: IDBDatabase): FakeOpenRequest {
  return {
    result: db,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
    error: null,
  };
}

function createFakeDeleteRequest(): FakeDeleteRequest {
  return {
    onsuccess: null,
    onerror: null,
    onblocked: null,
    error: null,
  };
}

test("clearDatabase closes tracked open databases before deleting", async () => {
  const originalIndexedDBDescriptor = Object.getOwnPropertyDescriptor(
    global,
    "indexedDB"
  );
  const fakeDb = {
    close: jest.fn(),
    addEventListener: jest.fn(),
    objectStoreNames: {
      contains: jest.fn().mockReturnValue(true),
    },
  } as unknown as IDBDatabase;

  const openRequest = createFakeOpenRequest(fakeDb);
  const deleteRequest = createFakeDeleteRequest();
  const fakeIndexedDB = {
    open: jest.fn(() => {
      queueMicrotask(() => {
        openRequest.onsuccess?.call(
          openRequest as unknown as IDBOpenDBRequest,
          new Event("success")
        );
      });
      return openRequest as unknown as IDBOpenDBRequest;
    }),
    deleteDatabase: jest.fn(() => {
      queueMicrotask(() => {
        deleteRequest.onsuccess?.call(
          deleteRequest as unknown as IDBOpenDBRequest,
          new Event("success")
        );
      });
      return deleteRequest as unknown as IDBOpenDBRequest;
    }),
  } as unknown as IDBFactory;

  Object.defineProperty(global, "indexedDB", {
    configurable: true,
    writable: true,
    value: fakeIndexedDB,
  });

  await openDB();
  await clearDatabase();

  expect(fakeDb.close).toHaveBeenCalledTimes(1);
  expect(fakeIndexedDB.deleteDatabase).toHaveBeenCalledWith("stashmap");
  if (originalIndexedDBDescriptor) {
    Object.defineProperty(global, "indexedDB", originalIndexedDBDescriptor);
  } else {
    delete (global as typeof global & { indexedDB?: IDBFactory }).indexedDB;
  }
});
