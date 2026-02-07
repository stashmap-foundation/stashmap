import React from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Event } from "nostr-tools";
import {
  ALICE,
  renderTree,
  renderWithTestData,
  RootViewOrPaneIsLoading,
  setup,
  type,
  expectTree,
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
} from "./indexedDB";
import { PaneView } from "./components/Workspace";

jest.mock("./indexedDB");

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
  renderTree(alice);

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
  renderTree(freshAlice);

  await expectTree(`
My Notes
  Spain
  France
    `);
}, 20000);

test("status bar shows pending when outbox has events on reload", async () => {
  const [alice] = setup([ALICE]);

  // eslint-disable-next-line functional/immutable-data
  outboxStore.push({
    key: "node:abc",
    event: {
      kind: 30023,
      pubkey: alice().user.publicKey,
      created_at: 1,
      tags: [["d", "abc"]],
      content: "hello",
    },
    createdAt: Date.now(),
  });
  // eslint-disable-next-line functional/immutable-data
  outboxStore.push({
    key: "node:def",
    event: {
      kind: 30023,
      pubkey: alice().user.publicKey,
      created_at: 2,
      tags: [["d", "def"]],
      content: "world",
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

  await screen.findByText("2 pending");
}, 20000);

test("relay results appear after queue flushes pending outbox events on reload", async () => {
  const [alice] = setup([ALICE]);

  // eslint-disable-next-line functional/immutable-data
  outboxStore.push({
    key: "node:abc",
    event: {
      kind: 30023,
      pubkey: alice().user.publicKey,
      created_at: 1,
      tags: [["d", "abc"]],
      content: "hello",
    },
    createdAt: Date.now(),
  });
  // eslint-disable-next-line functional/immutable-data
  outboxStore.push({
    key: "node:def",
    event: {
      kind: 30023,
      pubkey: alice().user.publicKey,
      created_at: 2,
      tags: [["d", "def"]],
      content: "world",
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

  await screen.findByText("2 pending");

  await userEvent.click(await screen.findByLabelText("publishing status"));
  await screen.findByText("relay.test.first.success/");
  await screen.findAllByText("0/2");

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
      kind: 30023,
      pubkey: alice().user.publicKey,
      created_at: 1,
      tags: [["d", "aaa"]],
      content: "one",
    },
    createdAt: Date.now(),
  });
  // eslint-disable-next-line functional/immutable-data
  outboxStore.push({
    key: "node:bbb",
    event: {
      kind: 30023,
      pubkey: alice().user.publicKey,
      created_at: 2,
      tags: [["d", "bbb"]],
      content: "two",
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

  await screen.findByText("2 pending");

  await screen.findByText(/pending.*error/, {}, { timeout: 10000 });

  await userEvent.click(await screen.findByLabelText("publishing status"));
  await screen.findByText("relay.test.second.fail/");
  await screen.findByText("relay.test.first.success/");
  await screen.findAllByText("0/2");
  await screen.findAllByText("2/2");
}, 20000);
