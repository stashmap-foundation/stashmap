import { List, Map } from "immutable";
import { Event, SimplePool, UnsignedEvent } from "nostr-tools";
import { FinalizeEvent } from "./Apis";
import { KIND_DELETE, KIND_KNOWLEDGE_NODE } from "./nostr";
import { signEvents, PUBLISH_TIMEOUT } from "./executor";
import { applyWriteRelayConfig } from "./relays";
import {
  StashmapDB,
  OutboxEntry,
  getOutboxEvents,
  putOutboxEvent,
  removeOutboxEvent,
} from "./indexedDB";

const DEFAULT_DEBOUNCE_MS = process.env.NODE_ENV === "test" ? 100 : 5000;
const MAX_BACKOFF_MS = 60000;
const DEFAULT_BATCH_SIZE = 10;

const toChunks = <T>(
  items: ReadonlyArray<T>,
  size: number
): ReadonlyArray<ReadonlyArray<T>> =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size)
  );

type RelayBackoffState = {
  readonly failures: number;
  readonly nextRetryAfter: number;
};

export type FlushDeps = {
  readonly user: User;
  readonly relays: AllRelays;
  readonly relayPool: SimplePool;
  readonly finalizeEvent: FinalizeEvent;
};

export type QueueStatus = {
  readonly pendingCount: number;
  readonly flushing: boolean;
  readonly backedOffRelays: ReadonlyArray<{
    readonly url: string;
    readonly retryAfter: number;
  }>;
  readonly succeededPerRelay: ReadonlyArray<{
    readonly url: string;
    readonly count: number;
  }>;
};

export type PublishQueueConfig = {
  readonly db: StashmapDB | null;
  readonly debounceMs?: number;
  readonly batchSize?: number;
  readonly getDeps: () => FlushDeps;
  readonly onResults: (results: PublishResultsEventMap) => void;
};

export type PublishQueue = {
  readonly enqueue: (events: List<UnsignedEvent & EventAttachment>) => void;
  readonly getStatus: () => QueueStatus;
  readonly init: () => Promise<void>;
  readonly destroy: () => void;
};

const getDTag = (event: UnsignedEvent): string | undefined =>
  event.tags.find((t) => t[0] === "d")?.[1];

const getOutboxKey = (event: UnsignedEvent): string => {
  const dTag = getDTag(event);
  if (event.kind === KIND_DELETE) {
    const aTag = event.tags.find((t) => t[0] === "a")?.[1];
    return `delete:${aTag || ""}`;
  }
  if (event.kind === KIND_KNOWLEDGE_NODE) {
    return `node:${dTag || ""}`;
  }
  return dTag
    ? `${event.kind}:${event.pubkey}:${dTag}`
    : `${event.kind}:${event.pubkey}`;
};

const deleteTargetToOutboxKey = (aTagValue: string): string | undefined => {
  const parts = aTagValue.split(":");
  if (parts.length < 3) return undefined;
  const kind = parseInt(parts[0], 10);
  if (kind === KIND_KNOWLEDGE_NODE) {
    return `node:${parts[2]}`;
  }
  return `${parts[0]}:${parts[1]}:${parts[2]}`;
};

const publishToRelays = async (
  relayPool: SimplePool,
  event: Event,
  writeRelayUrls: ReadonlyArray<string>
): Promise<Map<string, PublishStatus>> => {
  if (writeRelayUrls.length === 0) {
    return Map<string, PublishStatus>();
  }
  const timeoutPromise = (ms: number): Promise<unknown> =>
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Timeout")), ms);
    });

  const results = await Promise.allSettled(
    relayPool
      .publish([...writeRelayUrls], event)
      .map((promise) =>
        Promise.race([promise, timeoutPromise(PUBLISH_TIMEOUT)])
      )
  );

  return writeRelayUrls.reduce((rdx, url, index) => {
    const res = results[index];
    return rdx.set(url, {
      status: res.status,
      reason: res.status === "rejected" ? (res.reason as string) : undefined,
    });
  }, Map<string, PublishStatus>());
};

export const createPublishQueue = (
  config: PublishQueueConfig
): PublishQueue => {
  const debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;

  // eslint-disable-next-line functional/no-let
  let buffer = Map<string, OutboxEntry>();
  // eslint-disable-next-line functional/no-let
  let relayBackoff = Map<string, RelayBackoffState>();
  // eslint-disable-next-line functional/no-let
  let timer: ReturnType<typeof setTimeout> | null = null;
  // eslint-disable-next-line functional/no-let
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  // eslint-disable-next-line functional/no-let
  let flushing = false;
  // eslint-disable-next-line functional/no-let
  let destroyed = false;

  const getStatus = (): QueueStatus => {
    const counts = new globalThis.Map<string, number>();
    buffer.forEach((entry) => {
      (entry.succeededRelays || []).forEach((url) => {
        counts.set(url, (counts.get(url) || 0) + 1);
      });
    });
    const succeededPerRelay = Array.from(counts.entries()).map(
      ([url, count]) => ({ url, count })
    );
    return {
      pendingCount: buffer.size,
      flushing,
      backedOffRelays: relayBackoff
        .entrySeq()
        .toArray()
        .map(([url, state]) => ({ url, retryAfter: state.nextRetryAfter })),
      succeededPerRelay,
    };
  };

  const persistToOutbox = (entry: OutboxEntry): void => {
    if (!config.db) return;
    putOutboxEvent(config.db, entry).catch(() => {});
  };

  const removeFromOutboxDB = (key: string): void => {
    if (!config.db) return;
    removeOutboxEvent(config.db, key).catch(() => {});
  };

  const getAvailableRelays = (
    relayUrls: ReadonlyArray<string>
  ): ReadonlyArray<string> => {
    const now = Date.now();
    return relayUrls.filter((url) => {
      const state = relayBackoff.get(url);
      return !state || now >= state.nextRetryAfter;
    });
  };

  const updateBackoff = (url: string, succeeded: boolean): void => {
    if (succeeded) {
      relayBackoff = relayBackoff.delete(url);
    } else {
      const current = relayBackoff.get(url);
      const failures = (current?.failures ?? 0) + 1;
      relayBackoff = relayBackoff.set(url, {
        failures,
        nextRetryAfter:
          Date.now() + Math.min(2 ** failures * 1000, MAX_BACKOFF_MS),
      });
    }
  };

  const scheduleRetry = (): void => {
    if (retryTimer) clearTimeout(retryTimer);
    if (buffer.size === 0 || destroyed) return;

    const now = Date.now();
    const earliestRetry = relayBackoff.reduce(
      (earliest, state) =>
        state.nextRetryAfter < earliest ? state.nextRetryAfter : earliest,
      Infinity
    );

    if (earliestRetry === Infinity) return;

    const delay = Math.max(earliestRetry - now, 100);
    retryTimer = setTimeout(() => {
      if (!destroyed && buffer.size > 0) {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        flush();
      }
    }, delay);
  };

  const resolveWriteRelayUrls = (
    writeRelayConf: WriteRelayConf | undefined,
    relays: AllRelays
  ): ReadonlyArray<string> => {
    const writeRelays = applyWriteRelayConfig(
      relays.defaultRelays,
      relays.userRelays,
      relays.contactsRelays,
      writeRelayConf
    );
    return Array.from(new Set(writeRelays.map((r: Relay) => r.url)));
  };

  const processBatch = async (
    chunk: ReadonlyArray<[string, OutboxEntry]>,
    deps: FlushDeps
  ): Promise<void> => {
    const chunkEvents = List(chunk.map(([, entry]) => entry.event));
    const signed = await signEvents(chunkEvents, deps.user, deps.finalizeEvent);
    if (signed.size === 0) return;

    // eslint-disable-next-line functional/no-let
    let batchResults = Map<string, PublishResultsOfEvent>();
    const relayFailures = new Set<string>();
    const relaySuccesses = new Set<string>();

    await Promise.all(
      signed.toArray().map(async ({ event, writeRelayConf }, index) => {
        const [entryKey, outboxEntry] = chunk[index];
        const relayUrls = resolveWriteRelayUrls(writeRelayConf, deps.relays);
        const alreadyDone = outboxEntry.succeededRelays || [];
        const needsPublish = relayUrls.filter(
          (url) => !alreadyDone.includes(url)
        );
        const availableUrls = getAvailableRelays(needsPublish);

        if (availableUrls.length === 0) {
          if (needsPublish.length === 0) {
            buffer = buffer.delete(entryKey);
            removeFromOutboxDB(entryKey);
          }
          return;
        }

        const relayResults = await publishToRelays(
          deps.relayPool,
          event,
          availableUrls
        );

        const newSucceeded = [...alreadyDone];
        relayResults.forEach((status, url) => {
          if (status.status === "fulfilled") {
            // eslint-disable-next-line functional/immutable-data
            newSucceeded.push(url);
            relaySuccesses.add(url);
          } else {
            relayFailures.add(url);
          }
        });

        const allRelaysDone = relayUrls.every((url) =>
          newSucceeded.includes(url)
        );
        if (allRelaysDone) {
          buffer = buffer.delete(entryKey);
          removeFromOutboxDB(entryKey);
        } else {
          const updated: OutboxEntry = {
            ...outboxEntry,
            succeededRelays: newSucceeded,
          };
          buffer = buffer.set(entryKey, updated);
          persistToOutbox(updated);
        }

        batchResults = batchResults.set(event.id, {
          event,
          results: relayResults,
        });
      })
    );

    relayFailures.forEach((url) => updateBackoff(url, false));
    relaySuccesses.forEach((url) => {
      if (!relayFailures.has(url)) {
        updateBackoff(url, true);
      }
    });

    flushing = false;
    if (batchResults.size > 0) {
      config.onResults(batchResults);
    }
    flushing = true;
  };

  async function flush(): Promise<void> {
    if (flushing || destroyed || buffer.size === 0) return;
    flushing = true;

    try {
      const deps = config.getDeps();
      const entries = buffer.entrySeq().toArray();
      const processedKeys = new globalThis.Set(entries.map(([key]) => key));
      const chunks = toChunks(entries, batchSize);

      await chunks.reduce(
        (prev, chunk) =>
          prev.then(async () => {
            if (destroyed) return;
            try {
              await processBatch(chunk, deps);
            } catch (error) {
              // eslint-disable-next-line no-console
              console.error("Publish queue batch failed, continuing", error);
            }
          }),
        Promise.resolve()
      );

      flushing = false;

      scheduleRetry();

      if (
        !destroyed &&
        buffer.keySeq().some((key) => !processedKeys.has(key))
      ) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => flush(), 0);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Publish queue flush failed", error);
      scheduleRetry();
    } finally {
      flushing = false;
    }
  }

  const publishDeleteImmediate = async (
    event: UnsignedEvent & EventAttachment
  ): Promise<void> => {
    try {
      const deps = config.getDeps();
      const signed = await signEvents(
        List([event]),
        deps.user,
        deps.finalizeEvent
      );
      const first = signed.first();
      if (!first) return;

      const relayUrls = resolveWriteRelayUrls(
        first.writeRelayConf,
        deps.relays
      );

      const relayResults = await publishToRelays(
        deps.relayPool,
        first.event,
        relayUrls
      );

      relayResults.forEach((status, url) => {
        updateBackoff(url, status.status === "fulfilled");
      });

      config.onResults(
        Map<string, PublishResultsOfEvent>().set(first.event.id, {
          event: first.event,
          results: relayResults,
        })
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Immediate delete publish failed", error);
    }
  };

  const enqueue = (events: List<UnsignedEvent & EventAttachment>): void => {
    if (destroyed) return;

    // eslint-disable-next-line functional/no-let
    let buffered = false;

    events.forEach((event) => {
      if (event.kind === KIND_DELETE) {
        const aTag = event.tags.find((t) => t[0] === "a")?.[1];
        if (aTag) {
          const targetKey = deleteTargetToOutboxKey(aTag);
          if (targetKey && buffer.has(targetKey)) {
            buffer = buffer.delete(targetKey);
            removeFromOutboxDB(targetKey);
          }
        }
        publishDeleteImmediate(event);
        return;
      }

      const key = getOutboxKey(event);
      const entry: OutboxEntry = {
        key,
        event,
        createdAt: Date.now(),
      };
      buffer = buffer.set(key, entry);
      persistToOutbox(entry);
      buffered = true;
    });

    if (buffered) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => flush(), debounceMs);
    }
  };

  const handleBeforeUnload = (): void => {
    buffer.forEach((entry) => {
      persistToOutbox(entry);
    });
  };

  const init = async (): Promise<void> => {
    if (!config.db) return;
    try {
      const persisted = await getOutboxEvents(config.db);
      persisted.forEach((entry) => {
        if (!buffer.has(entry.key)) {
          buffer = buffer.set(entry.key, entry);
        }
      });
      if (buffer.size > 0) {
        timer = setTimeout(() => flush(), debounceMs);
      }
    } catch {
      // eslint-disable-next-line no-console
      console.error("Failed to load outbox from IndexedDB");
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
  };

  const destroy = (): void => {
    destroyed = true;
    if (timer) clearTimeout(timer);
    if (retryTimer) clearTimeout(retryTimer);
    window.removeEventListener("beforeunload", handleBeforeUnload);
  };

  return { enqueue, getStatus, init, destroy };
};
