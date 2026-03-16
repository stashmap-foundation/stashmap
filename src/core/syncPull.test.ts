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
const FIRST_ALICE_CREATED_AT = 1_700_000_000;
const FIRST_BOB_CREATED_AT = FIRST_ALICE_CREATED_AT + 24 * 60 * 60;

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
    kind: 34771,
    sig: "0".repeat(128),
    tags: [
      ["d", rootUuid],
      ["ms", `${createdAt * 1000}`],
    ],
    content: `# ${text} <!-- id:${rootUuid} -->\n- ${text} child <!-- id:${rootUuid}-child -->\n`,
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
  expect(content).toContain("---\n");
  expect(content).toContain(`root: ${rootUuid}`);
  expect(content).toContain(`author: ${author}`);
  expect(content).toContain(`sourceRoot: ${author}_${rootUuid}`);
  expect(content).toContain(`sourceRelation: ${author}_${rootUuid}`);
  expect(content).toContain("editing: |");
  expect(content).toContain("Never modify <!-- id:... --> comments.");
  expect(content).toContain("Push will reject invented IDs.");
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

test("pullSyncWorkspace writes editable markdown documents plus hidden baselines keyed by dTag", async () => {
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

  const result = await pullSyncWorkspace(client, profile);

  expect(result.relay_urls).toEqual([RELAY]);
  expect(result.contact_pubkeys).toEqual([BOB]);
  expect(
    calls.every(({ relays }) => relays.every((relay) => relay === RELAY))
  ).toBe(true);

  const alicePath = path.join(tempDir, "DOCUMENTS", ALICE, "alice-root.md");
  const bobPath = path.join(tempDir, "DOCUMENTS", BOB, "bob-root.md");
  const aliceBasePath = path.join(knowstrHome, "base", ALICE, "alice-root.md");
  const bobBasePath = path.join(knowstrHome, "base", BOB, "bob-root.md");

  const aliceContent = fs.readFileSync(alicePath, "utf8");
  const bobContent = fs.readFileSync(bobPath, "utf8");
  expectEditableHeader(aliceContent, ALICE, "alice-root");
  expectEditableHeader(bobContent, BOB, "bob-root");
  expect(aliceContent).toContain(aliceDoc.content.trim());
  expect(bobContent).toContain(bobDoc.content.trim());
  expect(fs.readFileSync(aliceBasePath, "utf8")).toBe(aliceContent);
  expect(fs.readFileSync(bobBasePath, "utf8")).toBe(bobContent);
  expect(result.updated_paths).toHaveLength(2);
  expect(fs.existsSync(path.join(tempDir, "manifest.json"))).toBe(false);
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

  const result = await pullSyncWorkspace(client, profile);

  expect(result.contact_pubkeys).toEqual([BOB]);
  expect(
    fs.existsSync(path.join(tempDir, "DOCUMENTS", ALICE, "alice-root.md"))
  ).toBe(true);
  expect(
    fs.existsSync(path.join(tempDir, "DOCUMENTS", BOB, "bob-root.md"))
  ).toBe(true);
});

test("pullSyncWorkspace updates documents on re-pull with new content", async () => {
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

  await pullSyncWorkspace(firstClient.client, profile);

  const bobDocV2 = documentEvent({
    pubkey: BOB,
    rootUuid: "bob-root",
    text: "Bob Root Updated",
    createdAt: FIRST_BOB_CREATED_AT + 24 * 60 * 60,
  });
  const secondClient = makeClient({
    [RELAY]: [contactListEvent(), aliceDoc, bobDocV2],
  });

  await pullSyncWorkspace(secondClient.client, profile);

  const bobPath = path.join(tempDir, "DOCUMENTS", BOB, "bob-root-updated.md");
  const bobContent = fs.readFileSync(bobPath, "utf8");
  expectEditableHeader(bobContent, BOB, "bob-root");
  expect(bobContent).toContain(bobDocV2.content.trim());

  expect(
    fs.existsSync(path.join(tempDir, "DOCUMENTS", BOB, "bob-root.md"))
  ).toBe(false);
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
  await pullSyncWorkspace(firstClient.client, profile);

  const documentPath = path.join(
    tempDir,
    "DOCUMENTS",
    ALICE,
    "original-root.md"
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
    createdAt: FIRST_ALICE_CREATED_AT + 24 * 60 * 60,
  });
  const secondClient = makeClient({
    [RELAY]: [contactListEvent(), existingDoc, remoteUpdatedDoc],
  });
  const result = await pullSyncWorkspace(secondClient.client, profile);

  expect(result.skipped_paths).toHaveLength(1);
  expect(fs.readFileSync(documentPath, "utf8")).toContain(
    "Locally Edited Root"
  );
  expect(fs.readFileSync(documentPath, "utf8")).not.toContain(
    "Remote Updated Root"
  );
});

test("pullSyncWorkspace preserves unpushed new documents", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-sync-"));
  const knowstrHome = path.join(tempDir, ".knowstr");
  const profile: SyncPullProfile = {
    pubkey: ALICE,
    readAs: ALICE,
    workspaceDir: tempDir,
    bootstrapRelays: [],
    relays: [{ url: RELAY, read: true, write: true }],
    knowstrHome,
  };

  const authorDir = path.join(tempDir, "DOCUMENTS", ALICE);
  fs.mkdirSync(authorDir, { recursive: true });
  const newDocPath = path.join(authorDir, "my-draft.md");
  fs.writeFileSync(newDocPath, "# My Draft\n- some notes\n");

  const { client } = makeClient({
    [RELAY]: [contactListEvent()],
  });
  await pullSyncWorkspace(client, profile);

  expect(fs.existsSync(newDocPath)).toBe(true);
  expect(fs.readFileSync(newDocPath, "utf8")).toContain("My Draft");
});
