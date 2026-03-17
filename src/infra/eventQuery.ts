/* eslint-disable functional/immutable-data */
import { Event, Filter } from "nostr-tools";

const EVENT_QUERY_IDLE_MS = 250;

export type EventQueryClient = {
  subscribeMany?: (
    relayUrls: string[],
    filters: Filter[],
    params: {
      onevent?: (event: Event) => void;
      oneose?: () => void;
      onclose?: (reason?: unknown) => void;
    }
  ) => {
    close: () => void | Promise<void>;
  };
  querySync?: (
    relayUrls: string[],
    filter: Filter,
    params?: { maxWait?: number }
  ) => Promise<Event[]>;
};

function subscribeUntilIdle(
  client: EventQueryClient,
  relayUrls: string[],
  filters: Filter[],
  params: {
    onEvent?: (event: Event) => void;
    onDone?: () => void;
    idleMs?: number;
    maxWait?: number;
  } = {}
): {
  close: () => void;
} {
  const { onEvent, onDone, idleMs = EVENT_QUERY_IDLE_MS, maxWait } = params;

  if (relayUrls.length === 0 || filters.length === 0) {
    Promise.resolve().then(() => onDone?.());
    return {
      close() {
        return undefined;
      },
    };
  }

  const seenEventIds = new Set<string>();
  const state: {
    settled: boolean;
    subscription:
      | {
          close: () => void | Promise<void>;
        }
      | undefined;
    idleTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
    hardTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  } = {
    settled: false,
    subscription: undefined,
    idleTimer: undefined,
    hardTimer: undefined,
  };

  const cleanup = (): void => {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
    }
    if (state.hardTimer) {
      clearTimeout(state.hardTimer);
    }
    state.subscription?.close();
  };

  const finish = (): void => {
    if (state.settled) {
      return;
    }
    state.settled = true;
    cleanup();
    onDone?.();
  };

  const cancel = (): void => {
    if (state.settled) {
      return;
    }
    state.settled = true;
    cleanup();
  };

  const scheduleIdleClose = (): void => {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
    }
    state.idleTimer = globalThis.setTimeout(finish, idleMs);
  };

  if (typeof client.subscribeMany !== "function") {
    const fallbackClient = client.querySync;
    if (!fallbackClient) {
      Promise.resolve().then(() => onDone?.());
      return { close: cancel };
    }
    Promise.all(
      filters.map((filter) =>
        fallbackClient(relayUrls, filter, maxWait ? { maxWait } : undefined)
      )
    )
      .then((responses) => {
        if (state.settled) {
          return;
        }
        responses.flat().forEach((event) => {
          if (seenEventIds.has(event.id)) {
            return;
          }
          seenEventIds.add(event.id);
          onEvent?.(event);
        });
      })
      .finally(() => {
        finish();
      });
    return { close: cancel };
  }

  if (maxWait !== undefined) {
    state.hardTimer = globalThis.setTimeout(finish, maxWait);
  }
  scheduleIdleClose();
  const subscription = client.subscribeMany(relayUrls, filters, {
    onevent(event): void {
      if (seenEventIds.has(event.id)) {
        return;
      }
      seenEventIds.add(event.id);
      onEvent?.(event);
      scheduleIdleClose();
    },
    oneose(): void {
      finish();
    },
    onclose(): void {
      finish();
    },
  });
  state.subscription = subscription;
  if (state.settled) {
    subscription.close();
  }

  return { close: cancel };
}

export function collectEventsUntilIdle(
  client: EventQueryClient,
  relayUrls: string[],
  filters: Filter[],
  params: {
    idleMs?: number;
    maxWait?: number;
  } = {}
): Promise<Event[]> {
  return new Promise((resolve) => {
    const eventMap = new Map<string, Event>();
    subscribeUntilIdle(client, relayUrls, filters, {
      ...params,
      onEvent(event): void {
        eventMap.set(event.id, event);
      },
      onDone(): void {
        resolve([...eventMap.values()]);
      },
    });
  });
}
