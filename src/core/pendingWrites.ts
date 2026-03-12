import fs from "fs/promises";
import path from "path";
import { Event } from "nostr-tools";
import { findTag } from "../nostrEvents";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
  getReplaceableKey,
} from "../nostr";
import {
  publishSignedEvents,
  resolveWriteRelayUrls,
  WriteProfile,
  WritePublisher,
} from "./writeSupport";

export type PendingWriteEntry = {
  event: Event;
  relayUrls?: string[];
};

type PendingWritesFile = {
  entries: PendingWriteEntry[];
};

function resolvePendingRelayUrls(
  profile: WriteProfile,
  entry: PendingWriteEntry,
  relayUrlsOverride?: string[]
): string[] {
  if (relayUrlsOverride && relayUrlsOverride.length > 0) {
    return relayUrlsOverride;
  }
  if (entry.relayUrls && entry.relayUrls.length > 0) {
    return entry.relayUrls;
  }
  return resolveWriteRelayUrls(profile, undefined);
}

function pendingWritesPath(knowstrHome: string): string {
  return path.join(knowstrHome, "pending-writes.json");
}

function pendingWriteKey(entry: PendingWriteEntry): string {
  if (entry.event.kind === KIND_KNOWLEDGE_DOCUMENT) {
    return getReplaceableKey(entry.event) || entry.event.id;
  }
  if (entry.event.kind === KIND_DELETE) {
    return findTag(entry.event, "a") || entry.event.id;
  }
  return entry.event.id;
}

function dedupePendingEntries(
  entries: PendingWriteEntry[]
): PendingWriteEntry[] {
  return entries.reduce((acc, entry) => {
    const key = pendingWriteKey(entry);
    const filtered = acc.filter(
      (existing) => pendingWriteKey(existing) !== key
    );
    return [...filtered, entry];
  }, [] as PendingWriteEntry[]);
}

export async function loadPendingWriteEntries(
  knowstrHome: string | undefined
): Promise<PendingWriteEntry[]> {
  if (!knowstrHome) {
    return [];
  }
  try {
    const raw = await fs.readFile(pendingWritesPath(knowstrHome), "utf8");
    const parsed = JSON.parse(raw) as PendingWritesFile;
    return parsed.entries || [];
  } catch {
    return [];
  }
}

async function writePendingWriteEntries(
  knowstrHome: string,
  entries: PendingWriteEntry[]
): Promise<void> {
  await fs.mkdir(knowstrHome, { recursive: true });
  await fs.writeFile(
    pendingWritesPath(knowstrHome),
    JSON.stringify(
      {
        entries,
      },
      null,
      2
    ),
    "utf8"
  );
}

export async function enqueuePendingWriteEntries(
  knowstrHome: string | undefined,
  entries: PendingWriteEntry[]
): Promise<PendingWriteEntry[]> {
  if (!knowstrHome || entries.length === 0) {
    return [];
  }
  const current = await loadPendingWriteEntries(knowstrHome);
  const merged = dedupePendingEntries([...current, ...entries]);
  await writePendingWriteEntries(knowstrHome, merged);
  return merged;
}

export async function pushPendingWriteEntries(
  publisher: WritePublisher,
  profile: WriteProfile & { knowstrHome?: string },
  relayUrlsOverride?: string[]
): Promise<{
  event_ids: string[];
  remaining_event_ids: string[];
  relay_urls: string[];
  publish_results: Record<string, Record<string, PublishStatus>>;
}> {
  const entries = await loadPendingWriteEntries(profile.knowstrHome);
  if (entries.length === 0) {
    return {
      event_ids: [],
      remaining_event_ids: [],
      relay_urls: [],
      publish_results: {},
    };
  }

  const settled = await entries.reduce(
    async (previous, entry) => {
      const acc = await previous;
      const relayUrls = resolvePendingRelayUrls(
        profile,
        entry,
        relayUrlsOverride
      );
      const published = await publishSignedEvents(publisher, relayUrls, [
        entry.event,
      ]);
      return [
        ...acc,
        {
          entry,
          relayUrls,
          published,
        },
      ];
    },
    Promise.resolve(
      [] as Array<{
        entry: PendingWriteEntry;
        relayUrls: string[];
        published: Awaited<ReturnType<typeof publishSignedEvents>>;
      }>
    )
  );

  const remainingEntries = settled
    .filter(({ published }) => {
      const eventId = published.event_ids[0];
      const results = eventId ? published.publish_results[eventId] : undefined;
      if (!results) {
        return true;
      }
      return !Object.values(results).every(
        (status) => status.status === "fulfilled"
      );
    })
    .map(({ entry }) => entry);

  if (profile.knowstrHome) {
    await writePendingWriteEntries(profile.knowstrHome, remainingEntries);
  }

  const publishResults = settled.reduce(
    (acc, { published }) => ({
      ...acc,
      ...published.publish_results,
    }),
    {} as Record<string, Record<string, PublishStatus>>
  );

  return {
    event_ids: settled.flatMap(({ published }) => published.event_ids),
    remaining_event_ids: remainingEntries.map(({ event }) => event.id),
    relay_urls: [...new Set(settled.flatMap(({ relayUrls }) => relayUrls))],
    publish_results: publishResults,
  };
}
