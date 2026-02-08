import { act } from "@testing-library/react";
import { Map, Set } from "immutable";
import {
  Event,
  Filter,
  SimplePool,
  SubCloser,
  SubscribeManyParams,
  Subscription,
  matchFilters,
} from "nostr-tools";
import { v4 } from "uuid";

export type MockRelayPool = SimplePool & {
  getEvents: () => Array<Event & { relays?: string[] }>;
  getPublishedOnRelays: () => Array<string>;
  resetPublishedOnRelays: () => void;
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

function replayEvents(subscription: Subscription, events: Array<Event>): void {
  events.forEach((event) => {
    if (matchFilters(subscription.filters, event)) {
      fireEvent(subscription, event);
    }
  });
  fireEose(subscription);
}

export function mockRelayPool(): MockRelayPool {
  // eslint-disable-next-line functional/no-let
  let subs = Map<string, Subscription>();
  // eslint-disable-next-line functional/no-let
  let publishedOnRelays: Array<string> = [];
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
      replayEvents(subscription, events);

      return {
        close: () => {
          subs = subs.remove(id);
        },
      };
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
  } as unknown as MockRelayPool;
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
test.skip("skip", () => {});
