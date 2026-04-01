import fs from "fs/promises";
import path from "path";
import { List } from "immutable";
import { Event, Filter } from "nostr-tools";
import { findContacts } from "../contacts";
import { findTag, getMostRecentReplacableEvent } from "../nostrEvents";
import {
  getReadRelays,
  mergeRelays,
  relaysFromUrls,
  sanitizeRelays,
  uniqueRelayUrls,
} from "../relayUtils";
import {
  KIND_CONTACTLIST,
  KIND_DELETE,
  KIND_KNOWLEDGE_DOCUMENT,
} from "../nostr";
import {
  DOCUMENTS_DIR,
  baselinePath,
  isLocallyEdited,
  readBaselineContent,
  removeWorkspaceFileIfExists,
  writeDocumentFiles,
  findWorkspaceFileByDTag,
} from "./workspaceState";
import { collectEventsUntilIdle, EventQueryClient } from "../eventQuery";

const DEFAULT_MAX_WAIT_MS = 20_000;

export type SyncPullProfile = {
  pubkey: PublicKey;
  readAs: PublicKey;
  workspaceDir: string;
  bootstrapRelays: Relays;
  relays: Relays;
  nsecFile?: string;
  knowstrHome?: string;
};

type SyncPullOptions = {
  outDir?: string;
  relayUrls?: string[];
  maxWaitMs?: number;
};

export type PullResult = {
  relay_urls: string[];
  contact_pubkeys: PublicKey[];
  updated_paths: string[];
  skipped_paths: string[];
  deleted_paths: string[];
};

export type SyncQueryClient = EventQueryClient & {
  close?: (relayUrls: string[]) => void;
};

function resolveRelayUrls(
  profile: SyncPullProfile,
  options: SyncPullOptions
): string[] {
  const explicitRelays = relaysFromUrls(options.relayUrls || []);
  if (explicitRelays.length > 0) {
    return uniqueRelayUrls(explicitRelays);
  }

  const configuredRelays = sanitizeRelays(
    mergeRelays(profile.bootstrapRelays, getReadRelays(profile.relays))
  );
  const relayUrls = uniqueRelayUrls(configuredRelays);
  if (relayUrls.length === 0) {
    throw new Error(
      "No read relays configured. Provide --relay or relays in .knowstr/profile.json"
    );
  }
  return relayUrls;
}

async function queryFilters(
  client: SyncQueryClient,
  relayUrls: string[],
  filters: Filter[],
  maxWaitMs: number
): Promise<Event[]> {
  if (relayUrls.length === 0 || filters.length === 0) {
    return [];
  }

  const eventMap = new Map<string, Event>();
  const responses = await Promise.all(
    filters.map((filter) =>
      collectEventsUntilIdle(client, relayUrls, [filter], {
        maxWait: maxWaitMs,
      })
    )
  );

  responses.flat().forEach((event) => {
    eventMap.set(event.id, event);
  });

  return [...eventMap.values()];
}

function latestContactPubkeys(
  contactEvents: Event[],
  userPubkey: PublicKey
): PublicKey[] {
  const latestContactList = getMostRecentReplacableEvent(
    List(contactEvents.filter((event) => event.kind === KIND_CONTACTLIST))
  );
  if (!latestContactList) {
    return [];
  }
  return findContacts(List([latestContactList]))
    .keySeq()
    .filter((pubkey) => pubkey !== userPubkey)
    .toArray();
}

function resolveKnowstrHome(
  workspaceDir: string,
  profile: SyncPullProfile
): string {
  return profile.knowstrHome ?? path.join(workspaceDir, ".knowstr");
}

function latestEventsByDTag(events: Event[]): Event[] {
  const byDTag = new Map<string, Event>();
  events.forEach((event) => {
    const dTag = findTag(event, "d");
    if (!dTag) {
      return;
    }
    const existing = byDTag.get(dTag);
    if (!existing || event.created_at > existing.created_at) {
      byDTag.set(dTag, event);
    }
  });
  return [...byDTag.values()];
}

async function removeOutOfScopeAuthorDirs(
  workspaceDir: string,
  allowedAuthors: Set<PublicKey>
): Promise<string[]> {
  const documentsDir = path.join(workspaceDir, DOCUMENTS_DIR);
  try {
    const entries = await fs.readdir(documentsDir);
    const results = await entries.reduce(async (previous, entry) => {
      const acc = await previous;
      if (allowedAuthors.has(entry as PublicKey)) {
        return acc;
      }
      const dirPath = path.join(documentsDir, entry);
      const stat = await fs.stat(dirPath);
      if (!stat.isDirectory()) {
        return acc;
      }
      const files = await fs.readdir(dirPath);
      const filePaths = files.map((f) => path.join(dirPath, f));
      await Promise.all(filePaths.map((fp) => removeWorkspaceFileIfExists(fp)));
      await fs.rmdir(dirPath).catch(() => undefined);
      return [...acc, ...filePaths];
    }, Promise.resolve([] as string[]));
    return results;
  } catch {
    return [];
  }
}

type AuthorPullResult = {
  updated: string[];
  skipped: string[];
  deleted: string[];
};

async function processDeleteEvents(
  deleteEvents: Event[],
  author: PublicKey,
  workspaceDir: string,
  knowstrHome: string
): Promise<AuthorPullResult> {
  return deleteEvents.reduce(
    async (previous, event) => {
      const acc = await previous;
      const aTag = findTag(event, "a");
      if (!aTag) {
        return acc;
      }
      const dTag = aTag.split(":")[2];
      if (!dTag) {
        return acc;
      }
      const baseline = await readBaselineContent(knowstrHome, author, dTag);
      if (!baseline) {
        return acc;
      }
      const existingPath = await findWorkspaceFileByDTag(
        workspaceDir,
        author,
        dTag
      );
      if (existingPath && (await isLocallyEdited(existingPath, baseline))) {
        return { ...acc, skipped: [...acc.skipped, existingPath] };
      }
      if (existingPath) {
        await removeWorkspaceFileIfExists(existingPath);
      }
      await removeWorkspaceFileIfExists(
        baselinePath(knowstrHome, author, dTag)
      );
      return existingPath
        ? { ...acc, deleted: [...acc.deleted, existingPath] }
        : acc;
    },
    Promise.resolve<AuthorPullResult>({
      updated: [],
      skipped: [],
      deleted: [],
    })
  );
}

function deletedDTagsFromEvents(deleteEvents: Event[]): Map<string, number> {
  const deletedDTags = new Map<string, number>();
  deleteEvents.forEach((event) => {
    const aTag = findTag(event, "a");
    if (!aTag) {
      return;
    }
    const dTag = aTag.split(":")[2];
    if (!dTag) {
      return;
    }
    const existing = deletedDTags.get(dTag);
    if (!existing || event.created_at > existing) {
      deletedDTags.set(dTag, event.created_at);
    }
  });
  return deletedDTags;
}

async function processDocumentEvents(
  documentEvents: Event[],
  deleteEvents: Event[],
  author: PublicKey,
  workspaceDir: string,
  knowstrHome: string
): Promise<AuthorPullResult> {
  const deletedDTags = deletedDTagsFromEvents(deleteEvents);
  return documentEvents.reduce(
    async (previous, event) => {
      const acc = await previous;
      const dTag = findTag(event, "d");
      if (!dTag) {
        return acc;
      }

      const deleteTimestamp = deletedDTags.get(dTag);
      if (
        deleteTimestamp !== undefined &&
        event.created_at <= deleteTimestamp
      ) {
        return acc;
      }

      const baseline = await readBaselineContent(knowstrHome, author, dTag);
      if (baseline) {
        const existingPath = await findWorkspaceFileByDTag(
          workspaceDir,
          author,
          dTag
        );
        if (existingPath && (await isLocallyEdited(existingPath, baseline))) {
          return { ...acc, skipped: [...acc.skipped, existingPath] };
        }
      }

      const result = await writeDocumentFiles(workspaceDir, knowstrHome, event);
      return result
        ? { ...acc, updated: [...acc.updated, result.workspacePath] }
        : acc;
    },
    Promise.resolve<AuthorPullResult>({
      updated: [],
      skipped: [],
      deleted: [],
    })
  );
}

export async function pullSyncWorkspace(
  client: SyncQueryClient,
  profile: SyncPullProfile,
  options: SyncPullOptions = {}
): Promise<PullResult> {
  const workspaceDir = options.outDir
    ? path.resolve(options.outDir)
    : profile.workspaceDir;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const relayUrls = resolveRelayUrls(profile, options);
  const knowstrHome = resolveKnowstrHome(workspaceDir, profile);

  await fs.mkdir(path.join(workspaceDir, DOCUMENTS_DIR), { recursive: true });

  const contactEvents = await queryFilters(
    client,
    relayUrls,
    [{ authors: [profile.readAs], kinds: [KIND_CONTACTLIST], limit: 1 }],
    maxWaitMs
  );
  const contactPubkeys = latestContactPubkeys(contactEvents, profile.readAs);
  const authors = [
    ...new Set([profile.readAs, ...contactPubkeys]),
  ] as PublicKey[];
  const allowedAuthors = new Set(authors);

  const deletedOutOfScope = await removeOutOfScopeAuthorDirs(
    workspaceDir,
    allowedAuthors
  );

  const authorResults = await Promise.all(
    authors.map(async (author) => {
      const authorEvents = await queryFilters(
        client,
        relayUrls,
        [
          { authors: [author], kinds: [KIND_KNOWLEDGE_DOCUMENT] },
          {
            authors: [author],
            kinds: [KIND_DELETE],
            "#k": [`${KIND_KNOWLEDGE_DOCUMENT}`],
          },
        ],
        maxWaitMs
      );

      const deleteEvents = authorEvents.filter(
        (event) => event.kind === KIND_DELETE
      );
      const documentEvents = latestEventsByDTag(
        authorEvents.filter((event) => event.kind === KIND_KNOWLEDGE_DOCUMENT)
      );

      const deleteResult = await processDeleteEvents(
        deleteEvents,
        author,
        workspaceDir,
        knowstrHome
      );
      const docResult = await processDocumentEvents(
        documentEvents,
        deleteEvents,
        author,
        workspaceDir,
        knowstrHome
      );

      return {
        updated: [...deleteResult.updated, ...docResult.updated],
        skipped: [...deleteResult.skipped, ...docResult.skipped],
        deleted: [...deleteResult.deleted, ...docResult.deleted],
      };
    })
  );

  const combined = authorResults.reduce(
    (acc, result) => ({
      updated: [...acc.updated, ...result.updated],
      skipped: [...acc.skipped, ...result.skipped],
      deleted: [...acc.deleted, ...result.deleted],
    }),
    {
      updated: [] as string[],
      skipped: [] as string[],
      deleted: [] as string[],
    }
  );

  client.close?.(relayUrls);

  return {
    relay_urls: relayUrls,
    contact_pubkeys: contactPubkeys.slice().sort(),
    updated_paths: combined.updated,
    skipped_paths: combined.skipped,
    deleted_paths: [...deletedOutOfScope, ...combined.deleted],
  };
}
