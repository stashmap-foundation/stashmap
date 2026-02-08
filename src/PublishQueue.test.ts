import { hexToBytes } from "@noble/hashes/utils";
import { List } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import { KIND_KNOWLEDGE_NODE } from "./nostr";
import { mockRelayPool, MockRelayPool } from "./nostrMock.test";
import { createPublishQueue, FlushDeps } from "./PublishQueue";
import { mockFinalizeEvent, ALICE_PRIVATE_KEY } from "./utils.test";

jest.mock("./indexedDB");

const ALICE_USER: User = {
  publicKey:
    "f0289b28573a7c9bb169f43102b26259b7a4b758aca66ea3ac8cd0fe516a3758" as PublicKey,
  privateKey: hexToBytes(ALICE_PRIVATE_KEY),
};

const TEST_RELAYS: AllRelays = {
  defaultRelays: [],
  userRelays: [{ url: "wss://relay.test/", read: true, write: true }],
  contactsRelays: [],
};

const makeEvent = (dTag: string): UnsignedEvent & EventAttachment => ({
  kind: KIND_KNOWLEDGE_NODE,
  pubkey: ALICE_USER.publicKey,
  created_at: Math.floor(Date.now() / 1000),
  tags: [["d", dTag]],
  content: `content-${dTag}`,
});

const waitForResults = (
  onResults: jest.Mock,
  expectedCalls: number,
  timeoutMs = 5000
): Promise<void> =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const check = (): void => {
      if (onResults.mock.calls.length >= expectedCalls) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(
          new Error(
            `Timed out waiting for ${expectedCalls} onResults calls, got ${onResults.mock.calls.length}`
          )
        );
        return;
      }
      setTimeout(check, 10);
    };
    check();
  });

const makeQueue = (
  overrides: Partial<{
    relayPool: MockRelayPool;
    batchSize: number;
    debounceMs: number;
  }> = {}
): {
  queue: ReturnType<typeof createPublishQueue>;
  relayPool: MockRelayPool;
  onResults: jest.Mock;
} => {
  const relayPool = overrides.relayPool ?? mockRelayPool();
  const onResults = jest.fn();
  const queue = createPublishQueue({
    db: null,
    debounceMs: overrides.debounceMs ?? 10,
    batchSize: overrides.batchSize ?? 2,
    getDeps: (): FlushDeps => ({
      user: ALICE_USER,
      relays: TEST_RELAYS,
      relayPool: relayPool as never,
      finalizeEvent: mockFinalizeEvent(),
    }),
    onResults,
  });
  return { queue, relayPool, onResults };
};

test("flushes remaining events via re-scheduled flush after first batch", async () => {
  const { queue, relayPool, onResults } = makeQueue({ batchSize: 2 });

  queue.enqueue(List([makeEvent("a"), makeEvent("b"), makeEvent("c")]));

  await waitForResults(onResults, 2);

  expect(onResults).toHaveBeenCalledTimes(2);
  expect(relayPool.getEvents()).toHaveLength(3);
  expect(queue.getStatus().pendingCount).toBe(0);
}, 10000);

test("concurrent enqueue during flush does not cause parallel execution", async () => {
  const publishOrder: string[] = [];
  const relayPool = mockRelayPool();
  const originalPublish = relayPool.publish.bind(relayPool);
  const trackingPool: MockRelayPool = {
    ...relayPool,
    publish: (relays, event) => {
      // eslint-disable-next-line functional/immutable-data
      publishOrder.push(
        event.tags.find((t: string[]) => t[0] === "d")?.[1] ?? ""
      );
      return originalPublish(relays, event);
    },
  } as MockRelayPool;

  const { queue, onResults } = makeQueue({
    relayPool: trackingPool,
    batchSize: 2,
    debounceMs: 10,
  });

  queue.enqueue(List([makeEvent("first"), makeEvent("second")]));

  await waitForResults(onResults, 1);

  queue.enqueue(List([makeEvent("third")]));

  await waitForResults(onResults, 2);

  expect(publishOrder).toEqual(["first", "second", "third"]);
  expect(queue.getStatus().pendingCount).toBe(0);
}, 10000);

test("events from multiple plans are published in enqueue order", async () => {
  const publishOrder: string[] = [];
  const relayPool = mockRelayPool();
  const originalPublish = relayPool.publish.bind(relayPool);
  const trackingPool: MockRelayPool = {
    ...relayPool,
    publish: (relays, event) => {
      // eslint-disable-next-line functional/immutable-data
      publishOrder.push(
        event.tags.find((t: string[]) => t[0] === "d")?.[1] ?? ""
      );
      return originalPublish(relays, event);
    },
  } as MockRelayPool;

  const { queue, onResults } = makeQueue({
    relayPool: trackingPool,
    batchSize: 2,
    debounceMs: 10,
  });

  queue.enqueue(
    List([makeEvent("plan1-a"), makeEvent("plan1-b"), makeEvent("plan1-c")])
  );
  queue.enqueue(List([makeEvent("plan2-a"), makeEvent("plan2-b")]));

  await waitForResults(onResults, 3);

  expect(publishOrder).toEqual([
    "plan1-a",
    "plan1-b",
    "plan1-c",
    "plan2-a",
    "plan2-b",
  ]);
  expect(queue.getStatus().pendingCount).toBe(0);
}, 10000);

test("clears events from buffer when their target relay is removed from config", async () => {
  const RELAY_A = "wss://relay-a.test/";
  const RELAY_B = "wss://relay-b.test/";

  const pool = mockRelayPool();
  const origPublish = pool.publish.bind(pool);
  const failPool: MockRelayPool = {
    ...pool,
    publish: (relays: string[], event: Event): Promise<string>[] => {
      const working = relays.filter((r) => r !== RELAY_B);
      if (working.length > 0) {
        origPublish(working, event);
      }
      return relays.map((relay) =>
        relay === RELAY_B
          ? Promise.reject(new Error("connection refused"))
          : Promise.resolve("")
      );
    },
  } as MockRelayPool;

  const relayConfig: { current: AllRelays } = {
    current: {
      defaultRelays: [],
      userRelays: [
        { url: RELAY_A, read: true, write: true },
        { url: RELAY_B, read: true, write: true },
      ],
      contactsRelays: [],
    },
  };

  const onResults = jest.fn();
  const queue = createPublishQueue({
    db: null,
    debounceMs: 10,
    batchSize: 10,
    getDeps: (): FlushDeps => ({
      user: ALICE_USER,
      relays: relayConfig.current,
      relayPool: failPool as never,
      finalizeEvent: mockFinalizeEvent(),
    }),
    onResults,
  });

  queue.enqueue(List([makeEvent("a"), makeEvent("b")]));
  await waitForResults(onResults, 1);

  expect(queue.getStatus().pendingCount).toBe(2);

  // eslint-disable-next-line functional/immutable-data
  relayConfig.current = {
    defaultRelays: [],
    userRelays: [{ url: RELAY_A, read: true, write: true }],
    contactsRelays: [],
  };

  queue.enqueue(List([makeEvent("c")]));
  await waitForResults(onResults, 2);

  expect(queue.getStatus().pendingCount).toBe(0);
}, 10000);

test("publishes events enqueued during an in-progress flush", async () => {
  const pool = mockRelayPool();
  const origPublish = pool.publish.bind(pool);
  const publishedTags: string[] = [];
  const resolvers: Array<(v: string) => void> = [];

  const controlledPool: MockRelayPool = {
    ...pool,
    publish: (relays: string[], event: Event): Promise<string>[] => {
      const dTag = event.tags.find((t: string[]) => t[0] === "d")?.[1] ?? "";
      // eslint-disable-next-line functional/immutable-data
      publishedTags.push(dTag);
      origPublish(relays, event);
      if (resolvers.length === 0) {
        return relays.map(
          () =>
            new Promise<string>((resolve) => {
              // eslint-disable-next-line functional/immutable-data
              resolvers.push(resolve);
            })
        );
      }
      return relays.map(() => Promise.resolve(""));
    },
  } as MockRelayPool;

  const onResults = jest.fn();
  const queue = createPublishQueue({
    db: null,
    debounceMs: 5,
    batchSize: 10,
    getDeps: (): FlushDeps => ({
      user: ALICE_USER,
      relays: TEST_RELAYS,
      relayPool: controlledPool as never,
      finalizeEvent: mockFinalizeEvent(),
    }),
    onResults,
  });

  queue.enqueue(List([makeEvent("a")]));

  const waitUntil = (
    predicate: () => boolean,
    timeoutMs = 3000
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      const start = Date.now();
      const check = (): void => {
        if (predicate()) {
          resolve();
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error("waitUntil timed out"));
          return;
        }
        setTimeout(check, 5);
      };
      check();
    });

  await waitUntil(() => resolvers.length === 1);

  queue.enqueue(List([makeEvent("b")]));
  await new Promise<void>((r) => {
    setTimeout(r, 20);
  });

  resolvers.forEach((r) => r(""));

  await waitForResults(onResults, 1);
  await new Promise<void>((r) => {
    setTimeout(r, 300);
  });

  expect(publishedTags).toContain("b");
  expect(queue.getStatus().pendingCount).toBe(0);
}, 10000);

// eslint-disable-next-line @typescript-eslint/no-empty-function
test.skip("skip", () => {});
