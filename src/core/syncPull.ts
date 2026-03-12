import fs from "fs/promises";
import path from "path";
import { List } from "immutable";
import { Event, Filter } from "nostr-tools";
import { findContacts } from "../contacts";
import { getMostRecentReplacableEvent } from "../nostrEvents";
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
  WORKSPACE_VERSION,
  WorkspaceAuthor,
  WorkspaceDocument,
  WorkspaceManifest,
  applyKnowledgeEventsToWorkspace,
  applyDeleteEventsToWorkspaceDocuments,
  applyDocumentEventsToWorkspaceDocuments,
  authorMap,
  documentMap,
  loadWorkspaceManifest,
  removeWorkspaceFileIfExists,
  writeWorkspaceManifest,
  writeWorkspaceInstructions,
} from "./workspaceState";
import { loadPendingWriteEntries } from "./pendingWrites";

const DEFAULT_MAX_WAIT_MS = 20_000;
const SYNC_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;

export type SyncPullProfile = {
  pubkey: PublicKey;
  workspaceDir: string;
  bootstrapRelays: Relays;
  relays: Relays;
  nsecFile?: string;
  knowstrHome?: string;
};

export type SyncPullOptions = {
  outDir?: string;
  relayUrls?: string[];
  maxWaitMs?: number;
  now?: Date;
};

export type SyncPullManifest = WorkspaceManifest;

type StoredDocument = WorkspaceDocument;
type StoredAuthor = WorkspaceAuthor;

export type SyncQueryClient = {
  querySync: (
    relayUrls: string[],
    filter: Filter,
    params?: { maxWait?: number }
  ) => Promise<Event[]>;
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
      client.querySync(relayUrls, filter, { maxWait: maxWaitMs })
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

function bufferedSince(author: StoredAuthor | undefined): number | undefined {
  if (!author) {
    return undefined;
  }

  return Math.max(0, author.last_document_created_at - SYNC_LOOKBACK_SECONDS);
}

function buildAuthorEntries(
  authors: PublicKey[],
  previousAuthors: Map<PublicKey, StoredAuthor>,
  fetchedEvents: Map<PublicKey, Event[]>
): StoredAuthor[] {
  return authors
    .slice()
    .sort()
    .map((author) => {
      const previous = previousAuthors.get(author);
      const authorEvents = fetchedEvents.get(author) || [];
      const latestCreatedAt = authorEvents.reduce(
        (current, event) => Math.max(current, event.created_at),
        previous?.last_document_created_at || 0
      );
      return {
        pubkey: author,
        last_document_created_at: latestCreatedAt,
      };
    });
}

async function removeOutOfScopeDocuments(
  workspaceDir: string,
  documents: Map<string, StoredDocument>,
  allowedAuthors: Set<PublicKey>
): Promise<void> {
  const entries = [...documents.entries()];
  await entries.reduce(async (previous, [replaceableKey, document]) => {
    await previous;
    if (allowedAuthors.has(document.author)) {
      return;
    }
    await removeWorkspaceFileIfExists(path.join(workspaceDir, document.path));
    documents.delete(replaceableKey);
  }, Promise.resolve());
}

export async function pullSyncWorkspace(
  client: SyncQueryClient,
  profile: SyncPullProfile,
  options: SyncPullOptions = {}
): Promise<SyncPullManifest> {
  const workspaceDir = options.outDir
    ? path.resolve(options.outDir)
    : profile.workspaceDir;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const relayUrls = resolveRelayUrls(profile, options);
  const previousManifest = await loadWorkspaceManifest(workspaceDir);
  const previousAuthors = authorMap(previousManifest);
  const documents = documentMap(previousManifest);

  await fs.mkdir(path.join(workspaceDir, DOCUMENTS_DIR), { recursive: true });

  const contactEvents = await queryFilters(
    client,
    relayUrls,
    [{ authors: [profile.pubkey], kinds: [KIND_CONTACTLIST], limit: 1 }],
    maxWaitMs
  );
  const contactPubkeys = latestContactPubkeys(contactEvents, profile.pubkey);
  const authors = [
    ...new Set([profile.pubkey, ...contactPubkeys]),
  ] as PublicKey[];
  const allowedAuthors = new Set(authors);

  await removeOutOfScopeDocuments(workspaceDir, documents, allowedAuthors);

  const authorResults = await Promise.all(
    authors.map(async (author) => {
      const previous = previousAuthors.get(author);
      const since = bufferedSince(previous);
      const authorEvents = await queryFilters(
        client,
        relayUrls,
        [
          {
            authors: [author],
            kinds: [KIND_KNOWLEDGE_DOCUMENT],
            ...(since !== undefined ? { since } : {}),
          },
          {
            authors: [author],
            kinds: [KIND_DELETE],
            "#k": [`${KIND_KNOWLEDGE_DOCUMENT}`],
            ...(since !== undefined ? { since } : {}),
          },
        ],
        maxWaitMs
      );

      return { author, authorEvents };
    })
  );

  const fetchedEventsByAuthor = new Map(
    authorResults.map(({ author, authorEvents }) => [author, authorEvents])
  );

  await authorResults.reduce(async (previous, { authorEvents }) => {
    await previous;
    await applyDeleteEventsToWorkspaceDocuments(
      workspaceDir,
      documents,
      authorEvents.filter((event) => event.kind === KIND_DELETE)
    );
    await applyDocumentEventsToWorkspaceDocuments(
      workspaceDir,
      documents,
      authorEvents.filter((event) => event.kind === KIND_KNOWLEDGE_DOCUMENT)
    );
  }, Promise.resolve());

  const manifest: SyncPullManifest = {
    workspace_version: WORKSPACE_VERSION,
    as_user: profile.pubkey,
    synced_at: (options.now || new Date()).toISOString(),
    relay_urls: relayUrls,
    contact_pubkeys: contactPubkeys.slice().sort(),
    authors: buildAuthorEntries(
      authors,
      previousAuthors,
      fetchedEventsByAuthor
    ),
    documents: [...documents.values()].sort((a, b) =>
      a.path.localeCompare(b.path)
    ),
  };

  await writeWorkspaceManifest(workspaceDir, manifest);
  await writeWorkspaceInstructions(workspaceDir, manifest);

  const pendingEntries = await loadPendingWriteEntries(profile.knowstrHome);
  const pendingEvents = pendingEntries.map(({ event }) => event);

  client.close?.(relayUrls);
  return pendingEvents.length > 0
    ? applyKnowledgeEventsToWorkspace(workspaceDir, manifest, pendingEvents)
    : manifest;
}
