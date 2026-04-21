import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Event } from "nostr-tools";
import { clearDatabase } from "./infra/nostr/replica/indexedDB";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
} from "./nostr";
import { LOG_ROOT_ROLE } from "./systemRoots";
import { ALICE, mockRelayPool, renderApp, setup } from "./utils.test";

const TEST_RELAY = "wss://relay.test.first.success/";

function createLogDocumentEvent({
  author,
  createdAt,
  rootUuid = "log-root",
  body = "",
}: {
  author: PublicKey;
  createdAt: number;
  rootUuid?: string;
  body?: string;
}): Event {
  return {
    id: `${author.slice(0, 8)}-log-${createdAt}`.padEnd(64, "0"),
    pubkey: author,
    created_at: createdAt,
    kind: KIND_KNOWLEDGE_DOCUMENT,
    sig: "0".repeat(128),
    tags: [
      ["d", rootUuid],
      ["ms", `${createdAt * 1000}`],
      ["s", LOG_ROOT_ROLE],
    ],
    content: `# ~Log <!-- id:${rootUuid} systemRole="${LOG_ROOT_ROLE}" -->\n${body}`,
  };
}

function createDocumentDeleteEvent({
  author,
  createdAt,
  rootUuid = "log-root",
}: {
  author: PublicKey;
  createdAt: number;
  rootUuid?: string;
}): Event {
  return {
    id: `${author.slice(0, 8)}-del-${createdAt}`.padEnd(64, "1"),
    pubkey: author,
    created_at: createdAt,
    kind: KIND_DELETE,
    sig: "1".repeat(128),
    tags: [
      ["a", `${KIND_KNOWLEDGE_DOCUMENT}:${author}:${rootUuid}`],
      ["k", `${KIND_KNOWLEDGE_DOCUMENT}`],
      ["ms", `${createdAt * 1000}`],
    ],
    content: "",
  };
}

function isDocumentSyncFilter(filter: {
  kinds?: number[];
  "#k"?: string[];
}): boolean {
  return (
    filter.kinds?.includes(KIND_KNOWLEDGE_DOCUMENT) === true ||
    (filter.kinds?.includes(KIND_DELETE) === true &&
      filter["#k"]?.includes(`${KIND_KNOWLEDGE_DOCUMENT}`) === true)
  );
}

function getDocumentSyncSubscriptions(
  relayPool: ReturnType<typeof mockRelayPool>
): ReturnType<typeof mockRelayPool>["getSubscriptions"] extends () => infer T
  ? T
  : never {
  return relayPool
    .getSubscriptions()
    .filter((subscription) =>
      subscription.filters.some((filter) => isDocumentSyncFilter(filter))
    );
}

function getDocumentSyncCalls(
  relayPool: ReturnType<typeof mockRelayPool>
): ReturnType<
  typeof mockRelayPool
>["getSubscribeManyCalls"] extends () => infer T
  ? T
  : never {
  return relayPool
    .getSubscribeManyCalls()
    .filter((subscription) =>
      subscription.filters.some((filter) => isDocumentSyncFilter(filter))
    );
}

function getHistoricalDocumentSyncCalls(
  relayPool: ReturnType<typeof mockRelayPool>
): ReturnType<typeof getDocumentSyncCalls> {
  return getDocumentSyncCalls(relayPool).filter(
    (subscription) => !subscription.filters.some((filter) => filter.limit === 0)
  );
}

beforeEach(async () => {
  cleanup();
  await clearDatabase();
});

afterEach(async () => {
  cleanup();
  await clearDatabase();
});

describe("permanent live sync integration", () => {
  test("historical relay documents are loaded on mount through permanent sync", async () => {
    const relayPool = mockRelayPool();
    relayPool.publish(
      [TEST_RELAY],
      createLogDocumentEvent({
        author: ALICE.publicKey,
        createdAt: 10,
      })
    );

    const [alice] = setup([ALICE], { relayPool });
    renderApp(alice());

    await screen.findByLabelText("Navigate to Log");

    expect(getDocumentSyncSubscriptions(relayPool)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filters: [
            expect.objectContaining({
              authors: [ALICE.publicKey],
              kinds: [
                KIND_KNOWLEDGE_DOCUMENT,
                KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
              ],
              limit: 0,
            }),
            expect.objectContaining({
              authors: [ALICE.publicKey],
              kinds: [KIND_DELETE],
              "#k": [`${KIND_KNOWLEDGE_DOCUMENT}`],
              limit: 0,
            }),
          ],
        }),
      ])
    );
    expect(getDocumentSyncSubscriptions(relayPool)).toHaveLength(1);
    expect(getHistoricalDocumentSyncCalls(relayPool)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filters: [
            expect.objectContaining({
              authors: [ALICE.publicKey],
              kinds: [KIND_KNOWLEDGE_DOCUMENT],
            }),
          ],
        }),
        expect.objectContaining({
          filters: [
            expect.objectContaining({
              authors: [ALICE.publicKey],
              kinds: [KIND_DELETE],
              "#k": [`${KIND_KNOWLEDGE_DOCUMENT}`],
            }),
          ],
        }),
      ])
    );
    expect(getHistoricalDocumentSyncCalls(relayPool)).toHaveLength(2);
  });

  test("live subscription applies new documents pushed after mount", async () => {
    const relayPool = mockRelayPool();
    const [alice] = setup([ALICE], { relayPool });
    renderApp(alice());

    await screen.findByLabelText("new node editor");

    relayPool.publish(
      [TEST_RELAY],
      createLogDocumentEvent({
        author: ALICE.publicKey,
        createdAt: 11,
      })
    );

    await screen.findByLabelText("Navigate to Log");
  });

  test("live subscription applies deletes pushed after mount", async () => {
    const relayPool = mockRelayPool();
    const [alice] = setup([ALICE], { relayPool });
    renderApp(alice());

    await screen.findByLabelText("new node editor");

    relayPool.publish(
      [TEST_RELAY],
      createLogDocumentEvent({
        author: ALICE.publicKey,
        createdAt: 12,
      })
    );

    await screen.findByLabelText("Navigate to Log");

    relayPool.publish(
      [TEST_RELAY],
      createDocumentDeleteEvent({
        author: ALICE.publicKey,
        createdAt: 13,
      })
    );

    await waitFor(() => {
      expect(screen.queryByLabelText("Navigate to Log")).toBeNull();
    });
  });

  test("historical sync uses one backfill pair, not duplicate historical requests", async () => {
    const relayPool = mockRelayPool();
    relayPool.publish(
      [TEST_RELAY],
      createLogDocumentEvent({
        author: ALICE.publicKey,
        createdAt: 1_700_000_100,
      })
    );

    const [alice] = setup([ALICE], { relayPool });
    renderApp(alice());
    await screen.findByLabelText("Navigate to Log");

    const initialHistoricalCallCount =
      getHistoricalDocumentSyncCalls(relayPool).length;
    expect(initialHistoricalCallCount).toBe(2);
  });

  test("newer replacement document wins during historical sync", async () => {
    const relayPool = mockRelayPool();
    relayPool.publish(
      [TEST_RELAY],
      createLogDocumentEvent({
        author: ALICE.publicKey,
        createdAt: 1_700_000_190,
        body: "- Old Child\n",
      })
    );
    relayPool.publish(
      [TEST_RELAY],
      createLogDocumentEvent({
        author: ALICE.publicKey,
        createdAt: 1_700_000_200,
        body: "- New Child\n",
      })
    );

    const [alice] = setup([ALICE], { relayPool });
    renderApp(alice());

    await userEvent.click(await screen.findByLabelText("Navigate to Log"));
    await screen.findByText("New Child");

    expect(screen.queryByText("Old Child")).toBeNull();
  });

  test("duplicate historical and live delivery does not duplicate visible document state", async () => {
    const relayPool = mockRelayPool();
    const document = createLogDocumentEvent({
      author: ALICE.publicKey,
      createdAt: 1_700_000_200,
      body: "- Once Only\n",
    });
    relayPool.publish([TEST_RELAY], document);

    const [alice] = setup([ALICE], { relayPool });
    renderApp(alice());

    await screen.findByLabelText("Navigate to Log");
    await userEvent.click(screen.getByLabelText("Navigate to Log"));
    await screen.findByText("Once Only");

    relayPool.publish([TEST_RELAY], document);

    await waitFor(() => {
      expect(screen.getAllByText("Once Only")).toHaveLength(1);
    });
  });
});
