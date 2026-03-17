import { List, Map } from "immutable";
import {
  Event,
  EventTemplate,
  SimplePool,
  UnsignedEvent,
  VerifiedEvent,
} from "nostr-tools";
import type { Data } from "../features/app-shell/types";
import { FinalizeEvent } from "../features/app-shell/ApiContext";
import {
  isUserLoggedIn,
  isUserLoggedInWithExtension,
} from "../features/app-shell/NostrAuthContext";
import type { Plan } from "../app/types";
import type { GraphPlan } from "../graph/commands";
import type { User } from "../graph/identity";
import { getNode } from "../graph/queries";
import { shortID } from "../graph/context";
import { newDB } from "../graph/types";
import type { GraphNode, ID } from "../graph/types";
import type {
  AllRelays,
  PublishResultsEventMap,
  PublishResultsOfEvent,
  PublishStatus,
  Relays,
} from "./publishTypes";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_RELAY_METADATA_EVENT,
  msTag,
  newTimestamp,
} from "./nostrCore";
import {
  findAllRelays,
  getWriteRelays,
  mergeRelays,
  uniqueRelayUrls,
} from "./relayUtils";
import { buildDocumentEvent } from "./markdownDocument";
import {
  buildDocumentEventFromNodes,
  buildSnapshotEventFromNodes,
} from "./nodesDocumentEvent";
import {
  StashmapDB,
  OutboxEntry,
  getOutboxEvents,
  putOutboxEvent,
  removeOutboxEvent,
} from "./indexedDB";
import { publishEventToRelays, PUBLISH_TIMEOUT } from "./nostrPublish";

const DEFAULT_DEBOUNCE_MS = process.env.NODE_ENV === "test" ? 100 : 5000;
const MAX_BACKOFF_MS = 60000;
const DEFAULT_BATCH_SIZE = 10;

const toChunks = <T>(
  children: ReadonlyArray<T>,
  size: number
): ReadonlyArray<ReadonlyArray<T>> =>
  Array.from({ length: Math.ceil(children.length / size) }, (_, i) =>
    children.slice(i * size, (i + 1) * size)
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

type SignedEventWithConf = {
  readonly event: VerifiedEvent;
};

type PublishQueueConfig = {
  readonly db: StashmapDB | null;
  readonly debounceMs?: number;
  readonly batchSize?: number;
  readonly getDeps: () => FlushDeps;
  readonly onResults: (results: PublishResultsEventMap) => void;
};

type PublishQueue = {
  readonly enqueue: (events: List<UnsignedEvent>) => void;
  readonly getStatus: () => QueueStatus;
  readonly init: () => Promise<void>;
  readonly destroy: () => void;
};

export function relayTags(relays: Relays): string[][] {
  return relays
    .map((relay) => {
      if (relay.read && relay.write) {
        return ["r", relay.url];
      }
      if (relay.read) {
        return ["r", relay.url, "read"];
      }
      if (relay.write) {
        return ["r", relay.url, "write"];
      }
      return [];
    })
    .filter((tag) => tag.length > 0);
}

export function planPublishRelayMetadata(plan: Plan, relays: Relays): Plan {
  const tags = relayTags(relays);
  const publishRelayMetadataEvent = {
    kind: KIND_RELAY_METADATA_EVENT,
    pubkey: plan.user.publicKey,
    created_at: newTimestamp(),
    tags: [...tags, msTag()],
    content: "",
  };
  return {
    ...plan,
    publishEvents: plan.publishEvents.push(publishRelayMetadataEvent),
  };
}

function resolveWriteRelayUrlsForEvent(
  event: UnsignedEvent,
  relays: AllRelays
): string[] {
  if (event.kind === KIND_RELAY_METADATA_EVENT) {
    const defaultWriteRelays = getWriteRelays(relays.defaultRelays);
    const userWriteRelays = getWriteRelays(relays.userRelays);
    const taggedWriteRelays = getWriteRelays(findAllRelays(event));
    return uniqueRelayUrls(
      mergeRelays(
        mergeRelays(defaultWriteRelays, userWriteRelays),
        taggedWriteRelays
      )
    );
  }
  return uniqueRelayUrls(getWriteRelays(relays.userRelays));
}

export function buildDocumentEvents(plan: GraphPlan): List<UnsignedEvent> {
  const author = plan.user.publicKey;
  const userDB = plan.knowledgeDBs.get(author, newDB());
  return plan.affectedRoots.reduce<List<UnsignedEvent>>((events, rootId) => {
    const rootNode = userDB.nodes.find(
      (node: GraphNode) =>
        !node.parent &&
        (node.id === rootId ||
          shortID(node.id) === rootId ||
          node.root === rootId ||
          node.root === shortID(rootId as ID))
    );
    if (!rootNode) {
      const rootDTag = shortID(rootId as ID);
      const deleteEvent = {
        kind: KIND_DELETE,
        pubkey: author,
        created_at: newTimestamp(),
        tags: [
          ["a", `${KIND_KNOWLEDGE_DOCUMENT}:${author}:${rootDTag}`],
          ["k", `${KIND_KNOWLEDGE_DOCUMENT}`],
          msTag(),
        ],
        content: "",
      };
      return events.push(deleteEvent as UnsignedEvent);
    }
    const snapshotSourceRoot =
      rootNode.basedOn && !rootNode.snapshotDTag
        ? getNode(plan.knowledgeDBs, rootNode.basedOn, author)
        : undefined;
    const createdSnapshotDTag = snapshotSourceRoot
      ? `snapshot-${shortID(rootNode.id as ID)}`
      : undefined;
    const snapshotEvent = snapshotSourceRoot
      ? (buildSnapshotEventFromNodes(
          plan.knowledgeDBs,
          author,
          createdSnapshotDTag as string,
          snapshotSourceRoot
        ) as UnsignedEvent)
      : undefined;
    const workspacePlan = plan as Partial<Plan>;
    const event =
      workspacePlan.views !== undefined && workspacePlan.panes !== undefined
        ? buildDocumentEvent(workspacePlan as Data, rootNode, {
            snapshotDTag: rootNode.snapshotDTag ?? createdSnapshotDTag,
          })
        : buildDocumentEventFromNodes(plan.knowledgeDBs, rootNode, {
            snapshotDTag: rootNode.snapshotDTag ?? createdSnapshotDTag,
          });
    return snapshotEvent
      ? events.push(snapshotEvent).push(event as UnsignedEvent)
      : events.push(event as UnsignedEvent);
  }, plan.publishEvents);
}

export async function signEvents(
  events: List<EventTemplate>,
  user: User,
  finalizeEvent: FinalizeEvent
): Promise<List<SignedEventWithConf>> {
  if (!isUserLoggedIn(user)) {
    return List();
  }

  const signEventWithExtension = async (
    event: EventTemplate
  ): Promise<Event> => {
    try {
      return window.nostr.signEvent(event);
      // eslint-disable-next-line no-empty
    } catch {
      throw new Error("Failed to sign event with extension");
    }
  };

  return isUserLoggedInWithExtension(user)
    ? List<SignedEventWithConf>(
        await Promise.all(
          events.map(async (event) => ({
            event: (await signEventWithExtension(event)) as VerifiedEvent,
          }))
        )
      )
    : events.map((event) => {
        const signedEvent = finalizeEvent(
          event,
          (user as KeyPair).privateKey
        ) as VerifiedEvent;
        return { event: signedEvent };
      });
}

export async function execute({
  plan,
  relays,
  relayPool,
  finalizeEvent,
}: {
  plan: GraphPlan;
  relays: AllRelays;
  relayPool: SimplePool;
  finalizeEvent: FinalizeEvent;
}): Promise<PublishResultsEventMap> {
  const allEvents = buildDocumentEvents(plan);

  if (allEvents.size === 0) {
    // eslint-disable-next-line no-console
    console.warn("Won't execute Noop plan");
    return Map();
  }

  const finalizedEvents = await signEvents(allEvents, plan.user, finalizeEvent);

  if (finalizedEvents.size === 0) {
    return Map();
  }

  const results = await Promise.all(
    finalizedEvents.toArray().map(({ event }) => {
      const writeRelayUrls = resolveWriteRelayUrlsForEvent(event, relays);
      return publishEventToRelays(relayPool, event, writeRelayUrls);
    })
  );

  return results.reduce((rdx, result, index) => {
    const eventId = finalizedEvents.get(index)?.event.id;
    return eventId ? rdx.set(eventId, result) : rdx;
  }, Map<string, PublishResultsOfEvent>());
}

export async function republishEvents({
  events,
  relayPool,
  writeRelayUrl,
}: {
  events: List<Event>;
  relayPool: SimplePool;
  writeRelayUrl: string;
}): Promise<PublishResultsEventMap> {
  if (events.size === 0) {
    // eslint-disable-next-line no-console
    console.warn("Won't republish noop events");
    return Map();
  }

  const results = await Promise.all(
    events
      .toArray()
      .map((event) => publishEventToRelays(relayPool, event, [writeRelayUrl]))
  );

  return results.reduce((rdx, result, index) => {
    const eventId = events.get(index)?.id;
    return eventId ? rdx.set(eventId, result) : rdx;
  }, Map<string, PublishResultsOfEvent>());
}

const getDTag = (event: UnsignedEvent): string | undefined =>
  event.tags.find((t) => t[0] === "d")?.[1];

const getOutboxKey = (event: UnsignedEvent): string => {
  const dTag = getDTag(event);
  if (event.kind === KIND_DELETE) {
    const aTag = event.tags.find((t) => t[0] === "a")?.[1];
    return `delete:${aTag || ""}`;
  }
  return dTag
    ? `${event.kind}:${event.pubkey}:${dTag}`
    : `${event.kind}:${event.pubkey}`;
};

const deleteTargetToOutboxKey = (aTagValue: string): string | undefined => {
  const parts = aTagValue.split(":");
  if (parts.length < 3) return undefined;
  return `${parts[0]}:${parts[1]}:${parts.slice(2).join(":")}`;
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
    event: UnsignedEvent,
    relays: AllRelays
  ): string[] => resolveWriteRelayUrlsForEvent(event, relays);

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
      signed.toArray().map(async ({ event }, index) => {
        const [entryKey, outboxEntry] = chunk[index];
        const relayUrls = resolveWriteRelayUrls(outboxEntry.event, deps.relays);
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
    event: UnsignedEvent
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

      const relayUrls = resolveWriteRelayUrls(event, deps.relays);

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

  const enqueue = (events: List<UnsignedEvent>): void => {
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
