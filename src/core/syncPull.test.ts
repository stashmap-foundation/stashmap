/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { Event, Filter, matchFilter } from "nostr-tools";
import {
  pullSyncWorkspace,
  SyncPullProfile,
  SyncQueryClient,
} from "./syncPull";

const ALICE = "a".repeat(64) as PublicKey;
const BOB = "b".repeat(64) as PublicKey;
const RELAY = "wss://profile.example/";
const ONE_DAY_SECONDS = 24 * 60 * 60;
const LOOKBACK_SECONDS = 7 * ONE_DAY_SECONDS;
const FIRST_ALICE_CREATED_AT = 1_700_000_000;
const FIRST_BOB_CREATED_AT = FIRST_ALICE_CREATED_AT + ONE_DAY_SECONDS;

function documentEvent({
  pubkey,
  rootUuid,
  text,
  createdAt,
}: {
  pubkey: PublicKey;
  rootUuid: string;
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
    content: `# ${text} {${rootUuid}}\n- ${text} child {${rootUuid}-child}\n`,
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

function expectEditableHeader(
  content: string,
  author: PublicKey,
  rootUuid: string
): void {
  expect(content).toContain(
    `<!-- ks:root=${rootUuid} sourceAuthor=${author} sourceRoot=${author}_${rootUuid} sourceRelation=${author}_${rootUuid} -->`
  );
  expect(content).toContain("<!-- ks:editing");
  expect(content).toContain("Markers:");
  expect(content).toContain("- (!) relevant");
  expect(content).toContain(
    "- Never invent ks:id markers for new rows; write new rows as plain markdown without ks:id."
  );
  expect(content).toContain(
    '- To delete, move the row with its marker into the final "# Delete" root.'
  );
  expect(content).toContain('- Keep "# Delete" as the last root.');
  expect(content).toContain("\n# Delete\n");
}

function makeClient(eventsByRelay: Record<string, Event[]>): {
  client: SyncQueryClient;
  calls: Array<{ relays: string[]; filter: Filter }>;
} {
  const querySync = jest.fn(
    (relays: string[], filter: Filter): Promise<Event[]> => {
      const events = relays.flatMap((relay) => eventsByRelay[relay] || []);
      return Promise.resolve(
        events.filter((event) => matchFilter(filter, event))
      );
    }
  );
  return {
    get calls() {
      return querySync.mock.calls.map(([relays, filter]) => ({
        relays: relays as string[],
        filter: filter as Filter,
      }));
    },
    client: {
      querySync,
      close() {
        return undefined;
      },
    },
  };
}

test("pullSyncWorkspace uses configured relays only and writes editable markdown documents plus hidden baselines", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-sync-"));
  const knowstrHome = path.join(tempDir, ".knowstr");
  const aliceDoc = documentEvent({
    pubkey: ALICE,
    rootUuid: "alice-root",
    text: "Alice Root",
    createdAt: FIRST_ALICE_CREATED_AT,
  });
  const bobDoc = documentEvent({
    pubkey: BOB,
    rootUuid: "bob-root",
    text: "Bob Root",
    createdAt: FIRST_BOB_CREATED_AT,
  });
  const { client, calls } = makeClient({
    [RELAY]: [contactListEvent(), aliceDoc, bobDoc],
  });
  const profile: SyncPullProfile = {
    pubkey: ALICE,
    readAs: ALICE,
    workspaceDir: tempDir,
    knowstrHome,
    bootstrapRelays: [],
    relays: [{ url: RELAY, read: true, write: true }],
  };

  const manifest = await pullSyncWorkspace(client, profile, {
    now: new Date("2026-03-10T12:00:00.000Z"),
  });

  expect(manifest.relay_urls).toEqual([RELAY]);
  expect(manifest.contact_pubkeys).toEqual([BOB]);
  expect(manifest.authors).toEqual([
    { pubkey: ALICE, last_document_created_at: FIRST_ALICE_CREATED_AT },
    { pubkey: BOB, last_document_created_at: FIRST_BOB_CREATED_AT },
  ]);
  expect(manifest.documents).toHaveLength(2);
  expect(
    calls.every(({ relays }) => relays.every((relay) => relay === RELAY))
  ).toBe(true);

  const alicePath = path.join(
    tempDir,
    manifest.documents.find((document) => document.author === ALICE)?.path || ""
  );
  const bobPath = path.join(
    tempDir,
    manifest.documents.find((document) => document.author === BOB)?.path || ""
  );
  const aliceBasePath = path.join(
    knowstrHome,
    manifest.documents.find((document) => document.author === ALICE)
      ?.base_path || ""
  );
  const bobBasePath = path.join(
    knowstrHome,
    manifest.documents.find((document) => document.author === BOB)?.base_path ||
      ""
  );

  const aliceContent = fs.readFileSync(alicePath, "utf8");
  const bobContent = fs.readFileSync(bobPath, "utf8");
  expectEditableHeader(aliceContent, ALICE, "alice-root");
  expectEditableHeader(bobContent, BOB, "bob-root");
  expect(aliceContent).toContain(aliceDoc.content.trim());
  expect(bobContent).toContain(bobDoc.content.trim());
  expect(fs.readFileSync(aliceBasePath, "utf8")).toBe(aliceContent);
  expect(fs.readFileSync(bobBasePath, "utf8")).toBe(bobContent);
  expect(alicePath).toContain(`${path.sep}DOCUMENTS${path.sep}`);
  expect(bobPath).toContain(`${path.sep}DOCUMENTS${path.sep}`);
  expect(fs.existsSync(path.join(tempDir, "AGENTS.md"))).toBe(false);
});

test("pullSyncWorkspace can read another user's graph", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-sync-"));
  const aliceDoc = documentEvent({
    pubkey: ALICE,
    rootUuid: "alice-root",
    text: "Alice Root",
    createdAt: FIRST_ALICE_CREATED_AT,
  });
  const bobDoc = documentEvent({
    pubkey: BOB,
    rootUuid: "bob-root",
    text: "Bob Root",
    createdAt: FIRST_BOB_CREATED_AT,
  });
  const { client } = makeClient({
    [RELAY]: [contactListEvent(), aliceDoc, bobDoc],
  });
  const agentPubkey = "c".repeat(64) as PublicKey;
  const profile: SyncPullProfile = {
    pubkey: agentPubkey,
    readAs: ALICE,
    workspaceDir: tempDir,
    knowstrHome: path.join(tempDir, ".knowstr"),
    bootstrapRelays: [],
    relays: [{ url: RELAY, read: true, write: true }],
  };

  const manifest = await pullSyncWorkspace(client, profile, {
    now: new Date("2026-03-10T12:00:00.000Z"),
  });

  expect(manifest.as_user).toBe(ALICE);
  expect(manifest.documents.map((document) => document.author)).toEqual([
    ALICE,
    BOB,
  ]);
});

test("pullSyncWorkspace refetches documents from a 7 day buffer", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-sync-"));
  const aliceDoc = documentEvent({
    pubkey: ALICE,
    rootUuid: "alice-root",
    text: "Alice Root",
    createdAt: FIRST_ALICE_CREATED_AT,
  });
  const bobDocV1 = documentEvent({
    pubkey: BOB,
    rootUuid: "bob-root",
    text: "Bob Root",
    createdAt: FIRST_BOB_CREATED_AT,
  });
  const firstClient = makeClient({
    [RELAY]: [contactListEvent(), aliceDoc, bobDocV1],
  });
  const profile: SyncPullProfile = {
    pubkey: ALICE,
    readAs: ALICE,
    workspaceDir: tempDir,
    knowstrHome: path.join(tempDir, ".knowstr"),
    bootstrapRelays: [],
    relays: [{ url: RELAY, read: true, write: true }],
  };

  await pullSyncWorkspace(firstClient.client, profile, {
    now: new Date("2026-03-10T12:00:00.000Z"),
  });

  const bobDocV2 = documentEvent({
    pubkey: BOB,
    rootUuid: "bob-root",
    text: "Bob Root Updated",
    createdAt: FIRST_BOB_CREATED_AT + LOOKBACK_SECONDS + ONE_DAY_SECONDS,
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

  expect(aliceDocQuery?.filter.since).toBe(
    FIRST_ALICE_CREATED_AT - LOOKBACK_SECONDS
  );
  expect(bobDocQuery?.filter.since).toBe(
    FIRST_BOB_CREATED_AT - LOOKBACK_SECONDS
  );
  expect(manifest.authors).toEqual([
    { pubkey: ALICE, last_document_created_at: FIRST_ALICE_CREATED_AT },
    {
      pubkey: BOB,
      last_document_created_at:
        FIRST_BOB_CREATED_AT + LOOKBACK_SECONDS + ONE_DAY_SECONDS,
    },
  ]);

  const bobPath = path.join(
    tempDir,
    manifest.documents.find((document) => document.author === BOB)?.path || ""
  );
  const bobContent = fs.readFileSync(bobPath, "utf8");
  expectEditableHeader(bobContent, BOB, "bob-root");
  expect(bobContent).toContain(bobDocV2.content.trim());
});

test("pullSyncWorkspace does not overwrite a locally edited document", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-sync-"));
  const knowstrHome = path.join(tempDir, ".knowstr");
  const existingDoc = documentEvent({
    pubkey: ALICE,
    rootUuid: "local-root",
    text: "Original Root",
    createdAt: FIRST_ALICE_CREATED_AT,
  });
  const profile: SyncPullProfile = {
    pubkey: ALICE,
    readAs: ALICE,
    workspaceDir: tempDir,
    bootstrapRelays: [],
    relays: [{ url: RELAY, read: true, write: true }],
    knowstrHome,
  };

  const firstClient = makeClient({
    [RELAY]: [contactListEvent(), existingDoc],
  });
  const firstManifest = await pullSyncWorkspace(firstClient.client, profile, {
    now: new Date("2026-03-10T12:00:00.000Z"),
  });
  const documentPath = path.join(
    tempDir,
    firstManifest.documents[0]?.path || ""
  );
  fs.writeFileSync(
    documentPath,
    fs
      .readFileSync(documentPath, "utf8")
      .replace("Original Root", "Locally Edited Root")
  );

  const remoteUpdatedDoc = documentEvent({
    pubkey: ALICE,
    rootUuid: "local-root",
    text: "Remote Updated Root",
    createdAt: FIRST_ALICE_CREATED_AT + ONE_DAY_SECONDS,
  });
  const secondClient = makeClient({
    [RELAY]: [contactListEvent(), existingDoc, remoteUpdatedDoc],
  });
  const manifest = await pullSyncWorkspace(secondClient.client, profile, {
    now: new Date("2026-03-10T13:00:00.000Z"),
  });

  expect(manifest.documents).toHaveLength(1);
  expect(fs.readFileSync(documentPath, "utf8")).toContain(
    "Locally Edited Root"
  );
  expect(fs.readFileSync(documentPath, "utf8")).not.toContain(
    "Remote Updated Root"
  );
});
