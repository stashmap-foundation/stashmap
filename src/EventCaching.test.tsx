import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { Event } from "nostr-tools";
import {
  ALICE,
  renderWithTestData,
  RootViewOrPaneIsLoading,
  setup,
  type,
  expectTree,
  requireUser,
} from "./utils.test";
import { MockRelayPool, mockRelayPool } from "./nostrMock.test";
import {
  openDB,
  getCachedEvents,
  putCachedEvents,
  getOutboxEvents,
  putOutboxEvent,
  removeOutboxEvent,
  OutboxEntry,
} from "./infra/nostr/cache/indexedDB";
import { PaneView } from "./editor/Workspace";
import { RelaysWrapper } from "./editor/Relays";
import {
  KIND_KNOWLEDGE_DEPOSIT,
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_SETTINGS,
} from "./nostr";
import { newStorageKey } from "./storageEncryption";

jest.mock("./infra/nostr/cache/indexedDB");

const mockRelayPoolWithFailure = (failingRelay: string): MockRelayPool => {
  const base = mockRelayPool();
  const originalPublish = base.publish.bind(base);
  return {
    ...base,
    publish: (relays: string[], event: Event): Promise<string>[] => {
      const results = originalPublish(relays, event);
      return relays.map((url, i) =>
        url === failingRelay
          ? Promise.reject(new Error("rate-limited"))
          : results[i]
      );
    },
  } as MockRelayPool;
};

const cachedEventsStore: Record<string, unknown>[] = [];
const outboxStore: OutboxEntry[] = [];

beforeEach(() => {
  // eslint-disable-next-line functional/immutable-data
  cachedEventsStore.length = 0;
  // eslint-disable-next-line functional/immutable-data
  outboxStore.length = 0;
  jest.mocked(openDB).mockResolvedValue({ __fake: true } as never);
  jest
    .mocked(getCachedEvents)
    .mockImplementation(
      () => Promise.resolve(cachedEventsStore.map((e) => ({ ...e }))) as never
    );
  jest.mocked(putCachedEvents).mockImplementation(((
    _db: never,
    events: Record<string, unknown>[]
  ) => {
    // eslint-disable-next-line functional/immutable-data
    events.forEach((e) => cachedEventsStore.push(e));
    return Promise.resolve();
  }) as never);
  jest
    .mocked(getOutboxEvents)
    .mockImplementation(
      () => Promise.resolve(outboxStore.map((e) => ({ ...e }))) as never
    );
  jest.mocked(putOutboxEvent).mockImplementation(((
    _db: never,
    entry: OutboxEntry
  ) => {
    // eslint-disable-next-line functional/no-let
    const idx = outboxStore.findIndex((e) => e.key === entry.key);
    if (idx >= 0) {
      // eslint-disable-next-line functional/immutable-data
      outboxStore[idx] = entry;
    } else {
      // eslint-disable-next-line functional/immutable-data
      outboxStore.push(entry);
    }
    return Promise.resolve();
  }) as never);
  jest.mocked(removeOutboxEvent).mockImplementation(((
    _db: never,
    key: string
  ) => {
    // eslint-disable-next-line functional/no-let
    const idx = outboxStore.findIndex((e) => e.key === key);
    if (idx >= 0) {
      // eslint-disable-next-line functional/immutable-data
      outboxStore.splice(idx, 1);
    }
    return Promise.resolve();
  }) as never);
});

test("published events are cached and available on reload", async () => {
  const [alice] = setup([ALICE]);
  renderWithTestData(
    <RootViewOrPaneIsLoading>
      <PaneView />
    </RootViewOrPaneIsLoading>,
    {
      ...alice(),
      db: { __fake: true } as never,
    }
  );

  await type("My Notes{Enter}{Tab}Spain{Enter}France{Escape}");
  await expectTree(`
My Notes
  Spain
  France
    `);

  cleanup();

  const freshAlice: typeof alice = () => ({
    ...alice(),
    relayPool: mockRelayPool(),
  });
  renderWithTestData(
    <RootViewOrPaneIsLoading>
      <PaneView />
    </RootViewOrPaneIsLoading>,
    {
      ...freshAlice(),
      db: { __fake: true } as never,
    }
  );

  await expectTree(`
My Notes
  Spain
  France
    `);
}, 20000);

test("queued settings activate before the next save and status separates routes", async () => {
  const [alice] = setup([ALICE]);
  const relayPool = mockRelayPool();
  const publish = relayPool.publish.bind(relayPool);
  const acknowledgements: Array<() => void> = [];
  jest.spyOn(relayPool, "publish").mockImplementation((relays, event) => {
    const results = publish(relays, event);
    if (event.kind !== KIND_SETTINGS) return results;
    return results.map((result) =>
      result.then(
        () =>
          new Promise<string>((resolve) => {
            // eslint-disable-next-line functional/immutable-data
            acknowledgements.push(() => resolve(""));
          })
      )
    );
  });
  const db = await openDB();
  if (!db) throw new Error("Missing test database");
  const storageRelays = ["wss://storage.one/", "wss://storage.two/"];
  const roomRelays = [
    "wss://room.one/",
    "wss://room.two/",
    "wss://room.three/",
  ];

  renderWithTestData(
    <Routes>
      <Route path="/relays" element={<RelaysWrapper />} />
      <Route
        path="/"
        element={
          <RootViewOrPaneIsLoading>
            <PaneView />
          </RootViewOrPaneIsLoading>
        }
      />
    </Routes>,
    {
      ...alice(),
      db,
      relayPool,
      initialRoute: "/relays",
      storageRelays,
    }
  );

  await roomRelays.reduce(
    (added, roomRelay) =>
      added.then(async () => {
        await userEvent.type(
          screen.getByLabelText("add room relay"),
          roomRelay
        );
        await userEvent.click(screen.getByLabelText("save room relay"));
      }),
    Promise.resolve()
  );
  await userEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(acknowledgements).toHaveLength(3));
  expect(screen.getByText("Workspace Settings")).toBeDefined();

  acknowledgements.forEach((acknowledge) => acknowledge());
  await waitFor(() =>
    expect(screen.queryByText("Workspace Settings")).toBeNull()
  );

  await type("Room Root{Enter}Published child{Escape}");
  await waitFor(
    () => {
      const storage = relayPool
        .getEvents()
        .find((event) => event.kind === KIND_KNOWLEDGE_DOCUMENT);
      const deposit = relayPool
        .getEvents()
        .find((event) => event.kind === KIND_KNOWLEDGE_DEPOSIT);
      expect(storage?.relays).toEqual(storageRelays);
      expect(deposit?.relays).toEqual(roomRelays);
    },
    { timeout: 10000 }
  );

  await userEvent.click(await screen.findByLabelText("sync status"));
  expect(screen.getByLabelText("Storage relays")).toBeDefined();
  expect(screen.getByLabelText("Room relays")).toBeDefined();
}, 20000);

test("status bar shows pending when outbox has events on reload", async () => {
  const [alice] = setup([ALICE]);

  // eslint-disable-next-line functional/immutable-data
  outboxStore.push({
    key: "node:abc",
    event: {
      kind: KIND_KNOWLEDGE_DOCUMENT,
      pubkey: requireUser(alice()).publicKey,
      created_at: 1,
      tags: [["d", "abc"]],
      content: "hello",
      route: { kind: "storage" },
      storageKey: newStorageKey(),
    },
    createdAt: Date.now(),
  });
  // eslint-disable-next-line functional/immutable-data
  outboxStore.push({
    key: "node:def",
    event: {
      kind: KIND_KNOWLEDGE_DOCUMENT,
      pubkey: requireUser(alice()).publicKey,
      created_at: 2,
      tags: [["d", "def"]],
      content: "world",
      route: { kind: "storage" },
      storageKey: newStorageKey(),
    },
    createdAt: Date.now(),
  });

  renderWithTestData(
    <RootViewOrPaneIsLoading>
      <PaneView />
    </RootViewOrPaneIsLoading>,
    {
      ...alice(),
      db: { __fake: true } as never,
      relayPool: mockRelayPoolWithFailure("wss://relay.test.second.fail/"),
    }
  );

  await screen.findByText(/2 pending/);
}, 20000);

test("relay results appear after queue flushes pending outbox events on reload", async () => {
  const [alice] = setup([ALICE]);

  // eslint-disable-next-line functional/immutable-data
  outboxStore.push({
    key: "node:abc",
    event: {
      kind: KIND_KNOWLEDGE_DOCUMENT,
      pubkey: requireUser(alice()).publicKey,
      created_at: 1,
      tags: [["d", "abc"]],
      content: "hello",
      route: { kind: "storage" },
      storageKey: newStorageKey(),
    },
    createdAt: Date.now(),
  });
  // eslint-disable-next-line functional/immutable-data
  outboxStore.push({
    key: "node:def",
    event: {
      kind: KIND_KNOWLEDGE_DOCUMENT,
      pubkey: requireUser(alice()).publicKey,
      created_at: 2,
      tags: [["d", "def"]],
      content: "world",
      route: { kind: "storage" },
      storageKey: newStorageKey(),
    },
    createdAt: Date.now(),
  });

  renderWithTestData(
    <RootViewOrPaneIsLoading>
      <PaneView />
    </RootViewOrPaneIsLoading>,
    {
      ...alice(),
      db: { __fake: true } as never,
    }
  );

  await userEvent.click(await screen.findByLabelText("sync status"));
  await screen.findByText("relay.test.first.success/");

  await screen.findByText("synced", {}, { timeout: 10000 });
  await screen.findAllByText("2/2");
}, 20000);

test("partial relay failure shows correct per-relay counts", async () => {
  const [alice] = setup([ALICE]);
  const failingUrl = "wss://relay.test.second.fail/";

  // eslint-disable-next-line functional/immutable-data
  outboxStore.push({
    key: "node:aaa",
    event: {
      kind: KIND_KNOWLEDGE_DOCUMENT,
      pubkey: requireUser(alice()).publicKey,
      created_at: 1,
      tags: [["d", "aaa"]],
      content: "one",
      route: { kind: "storage" },
      storageKey: newStorageKey(),
    },
    createdAt: Date.now(),
  });
  // eslint-disable-next-line functional/immutable-data
  outboxStore.push({
    key: "node:bbb",
    event: {
      kind: KIND_KNOWLEDGE_DOCUMENT,
      pubkey: requireUser(alice()).publicKey,
      created_at: 2,
      tags: [["d", "bbb"]],
      content: "two",
      route: { kind: "storage" },
      storageKey: newStorageKey(),
    },
    createdAt: Date.now(),
  });

  renderWithTestData(
    <RootViewOrPaneIsLoading>
      <PaneView />
    </RootViewOrPaneIsLoading>,
    {
      ...alice(),
      db: { __fake: true } as never,
      relayPool: mockRelayPoolWithFailure(failingUrl),
    }
  );

  await screen.findByText(/pending.*3\/4 relays/, {}, { timeout: 10000 });

  await userEvent.click(await screen.findByLabelText("sync status"));
  await screen.findByText("relay.test.second.fail/");
  await screen.findByText("relay.test.first.success/");
  await screen.findAllByText("0/2");
  await screen.findAllByText("2/2");
}, 20000);
