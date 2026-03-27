import { act } from "@testing-library/react";
import { Map, Set } from "immutable";
import {
  Event,
  Filter,
  SimplePool,
  SubCloser,
  SubscribeManyParams,
  Subscription,
  matchFilter,
  matchFilters,
} from "nostr-tools";
import { v4 } from "uuid";
import { KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT } from "./nostr";

type SubscriptionRecord = {
  filters: Filter[];
  relays: string[];
};

type QueryRecord = {
  filter: Filter;
  relays: string[];
};

export type MockRelayPool = SimplePool & {
  getEvents: () => Array<Event & { relays?: string[] }>;
  getPublishedOnRelays: () => Array<string>;
  resetPublishedOnRelays: () => void;
  getSubscriptions: () => Array<SubscriptionRecord>;
  getSubscribeManyCalls: () => Array<SubscriptionRecord>;
  getQuerySyncCalls: () => Array<QueryRecord>;
};

function fireEose(sub: Subscription): void {
  sub.oneose?.();
}

function fireEvent(sub: Subscription, event: Event): void {
  sub.onevent?.(event);
}

function broadcastEvent(subs: Map<string, Subscription>, event: Event): void {
  const filtered = subs.filter((sub) => matchFilters(sub.filters, event));
  filtered.forEach((sub) => {
    fireEvent(sub, event);
  });
}

function queryEvents(
  events: Array<Event & { relays?: string[] }>,
  filter: Filter
): Array<Event & { relays?: string[] }> {
  if (filter.limit === 0) {
    return [];
  }
  const matchingEvents = events.filter((event) => matchFilter(filter, event));
  return typeof filter.limit === "number"
    ? matchingEvents.slice(Math.max(0, matchingEvents.length - filter.limit))
    : matchingEvents;
}

function replayEvents(
  subscription: Subscription,
  events: Array<Event & { relays?: string[] }>
): void {
  const replayedById = subscription.filters.reduce((acc, filter) => {
    queryEvents(events, filter).forEach((event) => {
      acc.set(event.id, event);
    });
    return acc;
  }, new globalThis.Map<string, Event & { relays?: string[] }>());

  events
    .filter((event) => replayedById.has(event.id))
    .forEach((event) => {
      fireEvent(subscription, event);
    });
  fireEose(subscription);
}

export function mockRelayPool(): MockRelayPool {
  // eslint-disable-next-line functional/no-let
  let subs = Map<string, Subscription>();
  // eslint-disable-next-line functional/no-let
  let subscriptionRecords = Map<string, SubscriptionRecord>();
  const subscribeManyCalls: Array<SubscriptionRecord> = [];
  // eslint-disable-next-line functional/no-let
  let publishedOnRelays: Array<string> = [];
  // eslint-disable-next-line functional/no-let
  let queryRecords = Map<string, QueryRecord>();
  const events: Array<Event & { relays?: string[] }> = [];

  return {
    subscribeMany: (
      relays: string[],
      filters: Filter[],
      params: SubscribeManyParams
    ): SubCloser => {
      const id = v4();
      const subscription = {
        id,
        filters,
        ...params,
      } as Subscription;
      subs = subs.set(id, subscription);
      subscriptionRecords = subscriptionRecords.set(id, { filters, relays });
      // eslint-disable-next-line functional/immutable-data
      subscribeManyCalls.push({ filters, relays });
      replayEvents(subscription, events);

      return {
        close: () => {
          subs = subs.remove(id);
          subscriptionRecords = subscriptionRecords.remove(id);
        },
      };
    },
    querySync: (relays: string[], filter: Filter): Promise<Event[]> => {
      const id = v4();
      queryRecords = queryRecords.set(id, { filter, relays });
      return Promise.resolve(queryEvents(events, filter));
    },
    publish: (relays: string[], event: Event): Promise<string>[] => {
      // eslint-disable-next-line functional/immutable-data
      events.push({ ...event, relays });
      publishedOnRelays = Set([...publishedOnRelays, ...relays]).toArray();
      act(() => broadcastEvent(subs, event));
      return relays.map(() => Promise.resolve(""));
    },
    getEvents: () => events,
    getPublishedOnRelays: () => publishedOnRelays,
    resetPublishedOnRelays: () => {
      publishedOnRelays = [];
    },
    getSubscriptions: () => subscriptionRecords.valueSeq().toArray(),
    getSubscribeManyCalls: () => subscribeManyCalls,
    getQuerySyncCalls: () => queryRecords.valueSeq().toArray(),
  } as unknown as MockRelayPool;
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
test.skip("skip", () => {});

test("replay honors limit 0 but still delivers future matching events", () => {
  const relayPool = mockRelayPool();
  const oldEvent = {
    id: "old-event".padEnd(64, "0"),
    pubkey: "alice" as PublicKey,
    created_at: 10,
    kind: KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
    sig: "0".repeat(128),
    tags: [["d", "root-1"]],
    content: "# Old Root",
  } as Event;
  relayPool.publish(["wss://relay.test/"], oldEvent);

  const receiveEvent = jest.fn();
  relayPool.subscribeMany(
    ["wss://relay.test/"],
    [
      {
        authors: ["alice"],
        kinds: [KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT],
        limit: 0,
      },
    ],
    {
      onevent: receiveEvent,
    }
  );

  expect(receiveEvent).not.toHaveBeenCalled();

  const liveEvent = {
    ...oldEvent,
    id: "live-event".padEnd(64, "1"),
    created_at: 11,
    content: "# Live Root",
  } as Event;
  relayPool.publish(["wss://relay.test/"], liveEvent);

  expect(receiveEvent.mock.calls.map(([event]) => (event as Event).id)).toEqual(
    [liveEvent.id]
  );
});

test("replay honors since, until, and limit semantics", () => {
  const relayPool = mockRelayPool();
  const events = [5, 10, 15, 20].map(
    (createdAt) =>
      ({
        id: `event-${createdAt}`.padEnd(64, `${createdAt % 10}`),
        pubkey: "alice" as PublicKey,
        created_at: createdAt,
        kind: KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
        sig: "0".repeat(128),
        tags: [["d", `root-${createdAt}`]],
        content: `# Root ${createdAt}`,
      } as Event)
  );
  events.forEach((event) => {
    relayPool.publish(["wss://relay.test/"], event);
  });

  const receiveEvent = jest.fn();
  relayPool.subscribeMany(
    ["wss://relay.test/"],
    [
      {
        authors: ["alice"],
        kinds: [KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT],
        since: 9,
        until: 20,
        limit: 2,
      },
    ],
    {
      onevent: receiveEvent,
    }
  );

  expect(
    receiveEvent.mock.calls.map(([event]) => (event as Event).created_at)
  ).toEqual([15, 20]);
});
