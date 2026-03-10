/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { Event, Filter, matchFilter } from "nostr-tools";
import { pullSyncWorkspace, SyncPullProfile, SyncQueryClient } from "./syncPull";

const ALICE = "a".repeat(64) as PublicKey;
const BOB = "b".repeat(64) as PublicKey;
const RELAY = "wss://profile.example/";

function documentEvent({
  pubkey,
  rootUuid,
  semantic,
  text,
  createdAt,
}: {
  pubkey: PublicKey;
  rootUuid: string;
  semantic: string;
  text: string;
  createdAt: number;
}): Event {
  return {
    id: `${pubkey.slice(0, 8)}-${rootUuid}-${createdAt}`.padEnd(64, "0"),
    pubkey,
    created_at: createdAt,
    kind: 34770,
    sig: "0".repeat(128),
    tags: [
      ["d", rootUuid],
      ["ms", `${createdAt * 1000}`],
    ],
    content: `# ${text} {${rootUuid} semantic="${semantic}"}\n- ${text} child {${rootUuid}-child semantic="${semantic.slice(0, 31)}1"}\n`,
  };
}

function contactListEvent(): Event {
  return {
    id: "contact-list".padEnd(64, "0"),
    pubkey: ALICE,
    created_at: 10,
    kind: 3,
    sig: "1".repeat(128),
    tags: [["p", BOB]],
    content: "",
  };
}

function makeClient(eventsByRelay: Record<string, Event[]>): {
  client: SyncQueryClient;
  calls: Array<{ relays: string[]; filter: Filter }>;
} {
  const calls: Array<{ relays: string[]; filter: Filter }> = [];
  return {
    calls,
    client: {
      async querySync(relays, filter) {
        calls.push({ relays, filter });
        const events = relays.flatMap((relay) => eventsByRelay[relay] || []);
        return events.filter((event) => matchFilter(filter, event));
      },
      close() {
        return undefined;
      },
    },
  };
}

test("pullSyncWorkspace uses configured relays only and writes raw markdown documents", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-sync-"));
  const aliceDoc = documentEvent({
    pubkey: ALICE,
    rootUuid: "alice-root",
    semantic: "1".repeat(32),
    text: "Alice Root",
    createdAt: 20,
  });
  const bobDoc = documentEvent({
    pubkey: BOB,
    rootUuid: "bob-root",
    semantic: "2".repeat(32),
    text: "Bob Root",
    createdAt: 21,
  });
  const { client, calls } = makeClient({
    [RELAY]: [contactListEvent(), aliceDoc, bobDoc],
  });
  const profile: SyncPullProfile = {
    pubkey: ALICE,
    workspaceDir: tempDir,
    bootstrapRelays: [],
    relays: [{ url: RELAY, read: true, write: true }],
  };

  const manifest = await pullSyncWorkspace(client, profile, {
    now: new Date("2026-03-10T12:00:00.000Z"),
  });

  expect(manifest.relay_urls).toEqual([RELAY]);
  expect(manifest.contact_pubkeys).toEqual([BOB]);
  expect(manifest.authors).toEqual([
    { pubkey: ALICE, last_document_created_at: 20 },
    { pubkey: BOB, last_document_created_at: 21 },
  ]);
  expect(manifest.documents).toHaveLength(2);
  expect(calls.every(({ relays }) => relays.every((relay) => relay === RELAY))).toBe(
    true
  );

  const alicePath = path.join(
    tempDir,
    manifest.documents.find((document) => document.author === ALICE)?.path || ""
  );
  const bobPath = path.join(
    tempDir,
    manifest.documents.find((document) => document.author === BOB)?.path || ""
  );

  expect(fs.readFileSync(alicePath, "utf8")).toBe(aliceDoc.content);
  expect(fs.readFileSync(bobPath, "utf8")).toBe(bobDoc.content);
});

test("pullSyncWorkspace stores per-author watermarks for incremental refetch", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-sync-"));
  const aliceDoc = documentEvent({
    pubkey: ALICE,
    rootUuid: "alice-root",
    semantic: "1".repeat(32),
    text: "Alice Root",
    createdAt: 20,
  });
  const bobDocV1 = documentEvent({
    pubkey: BOB,
    rootUuid: "bob-root",
    semantic: "2".repeat(32),
    text: "Bob Root",
    createdAt: 21,
  });
  const firstClient = makeClient({
    [RELAY]: [contactListEvent(), aliceDoc, bobDocV1],
  });
  const profile: SyncPullProfile = {
    pubkey: ALICE,
    workspaceDir: tempDir,
    bootstrapRelays: [],
    relays: [{ url: RELAY, read: true, write: true }],
  };

  await pullSyncWorkspace(firstClient.client, profile, {
    now: new Date("2026-03-10T12:00:00.000Z"),
  });

  const bobDocV2 = documentEvent({
    pubkey: BOB,
    rootUuid: "bob-root",
    semantic: "2".repeat(32),
    text: "Bob Root Updated",
    createdAt: 30,
  });
  const secondClient = makeClient({
    [RELAY]: [contactListEvent(), aliceDoc, bobDocV1, bobDocV2],
  });

  const manifest = await pullSyncWorkspace(secondClient.client, profile, {
    now: new Date("2026-03-10T13:00:00.000Z"),
  });

  const aliceDocQuery = secondClient.calls.find(
    ({ filter }) =>
      filter.kinds?.includes(34770) && filter.authors?.includes(ALICE)
  );
  const bobDocQuery = secondClient.calls.find(
    ({ filter }) =>
      filter.kinds?.includes(34770) && filter.authors?.includes(BOB)
  );

  expect(aliceDocQuery?.filter.since).toBe(20);
  expect(bobDocQuery?.filter.since).toBe(21);
  expect(manifest.authors).toEqual([
    { pubkey: ALICE, last_document_created_at: 20 },
    { pubkey: BOB, last_document_created_at: 30 },
  ]);

  const bobPath = path.join(
    tempDir,
    manifest.documents.find((document) => document.author === BOB)?.path || ""
  );
  expect(fs.readFileSync(bobPath, "utf8")).toBe(bobDocV2.content);
});
