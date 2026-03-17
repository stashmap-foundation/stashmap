/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { hexToBytes } from "@noble/hashes/utils";
import { Event, Filter, matchFilter, getPublicKey } from "nostr-tools";
import { LoadedCliProfile } from "./config";
import { pushPendingWritesWithPool } from "./push";
import { KIND_KNOWLEDGE_DOCUMENT } from "../nostrCore";
import {
  pullSyncWorkspace,
  SyncPullProfile,
  SyncQueryClient,
} from "../local-docs/syncPull";

const PRIVATE_KEY = "1".repeat(64);
const ALICE = getPublicKey(hexToBytes(PRIVATE_KEY)) as PublicKey;
const RELAY = "wss://write.example/";

function documentEvent(
  rootUuid: string,
  text: string,
  createdAt: number
): Event {
  return {
    id: `${rootUuid}-${createdAt}`.padEnd(64, "0"),
    pubkey: ALICE,
    created_at: createdAt,
    kind: KIND_KNOWLEDGE_DOCUMENT,
    sig: "0".repeat(128),
    tags: [
      ["d", rootUuid],
      ["ms", `${createdAt * 1000}`],
    ],
    content: `# ${text} <!-- id:${rootUuid} -->\n- ${text} child <!-- id:${rootUuid}-child -->\n`,
  };
}

function makeClient(eventsByRelay: Record<string, Event[]>): SyncQueryClient {
  return {
    querySync(relays: string[], filter: Filter): Promise<Event[]> {
      const events = relays.flatMap((relay) => eventsByRelay[relay] || []);
      return Promise.resolve(
        events.filter((event) => matchFilter(filter, event))
      );
    },
    close() {
      return undefined;
    },
  };
}

test("pushPendingWritesWithPool publishes edited workspace documents, refreshes the baseline, and closes the relays it used", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-push-cli-"));
  const knowstrHome = path.join(tempDir, ".knowstr");
  const profile: SyncPullProfile = {
    pubkey: ALICE,
    readAs: ALICE,
    workspaceDir: tempDir,
    knowstrHome,
    bootstrapRelays: [],
    relays: [{ url: RELAY, read: true, write: true }],
    nsecFile: path.join(tempDir, "me.nsec"),
  };
  fs.writeFileSync(profile.nsecFile as string, PRIVATE_KEY);

  const pulledEvent = documentEvent("root-a", "Original Root", 1_700_000_000);
  await pullSyncWorkspace(
    makeClient({
      [RELAY]: [pulledEvent],
    }),
    profile
  );

  const documentPath = path.join(
    tempDir,
    "DOCUMENTS",
    ALICE,
    "original-root.md"
  );
  const editedContent = fs
    .readFileSync(documentPath, "utf8")
    .replace("Original Root", "Edited Root");
  fs.writeFileSync(documentPath, editedContent);

  const close = jest.fn();
  const pool = {
    close,
    publish: jest.fn((relayUrls: string[]) =>
      relayUrls.map(() => Promise.resolve("ok"))
    ),
  };

  const result = await pushPendingWritesWithPool(
    pool,
    profile as LoadedCliProfile,
    []
  );

  expect(result.changed_paths).toHaveLength(1);
  expect(result.remaining_paths).toEqual([]);
  expect(result.updated_paths).toHaveLength(1);
  expect(result.relay_urls).toEqual([RELAY]);
  expect(close).toHaveBeenCalledWith([RELAY]);

  const basePath = path.join(knowstrHome, "base", ALICE, "root-a.md");
  expect(fs.readFileSync(basePath, "utf8")).toContain("Edited Root");
});

test("pushing a new document writes workspace file with UUIDs and editing header, second push is a no-op", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-push-new-"));
  const knowstrHome = path.join(tempDir, ".knowstr");
  const profile: SyncPullProfile = {
    pubkey: ALICE,
    readAs: ALICE,
    workspaceDir: tempDir,
    knowstrHome,
    bootstrapRelays: [],
    relays: [{ url: RELAY, read: true, write: true }],
    nsecFile: path.join(tempDir, "me.nsec"),
  };
  fs.writeFileSync(profile.nsecFile as string, PRIVATE_KEY);

  const authorDir = path.join(tempDir, "DOCUMENTS", ALICE);
  fs.mkdirSync(authorDir, { recursive: true });
  const originalPath = path.join(authorDir, "scratch.md");
  fs.writeFileSync(originalPath, "# My New Doc\n- child one\n- child two\n");

  const pool = {
    close: jest.fn(),
    publish: jest.fn((relayUrls: string[]) =>
      relayUrls.map(() => Promise.resolve("ok"))
    ),
  };

  const result = await pushPendingWritesWithPool(
    pool,
    profile as LoadedCliProfile,
    []
  );

  expect(result.changed_paths).toHaveLength(1);
  expect(result.updated_paths).toHaveLength(1);

  expect(fs.existsSync(originalPath)).toBe(false);
  const canonicalPath = path.join(authorDir, "my-new-doc.md");
  const updatedContent = fs.readFileSync(canonicalPath, "utf8");
  expect(updatedContent).toContain("---\n");
  expect(updatedContent).toContain("<!-- id:");
  expect(updatedContent).toContain("My New Doc");

  const baseFiles = fs.readdirSync(path.join(knowstrHome, "base", ALICE));
  expect(baseFiles).toHaveLength(1);
  const baseContent = fs.readFileSync(
    path.join(knowstrHome, "base", ALICE, baseFiles[0]),
    "utf8"
  );
  expect(baseContent).toEqual(updatedContent);

  pool.publish.mockClear();
  const result2 = await pushPendingWritesWithPool(
    pool,
    profile as LoadedCliProfile,
    []
  );
  expect(result2.changed_paths).toHaveLength(0);
  expect(pool.publish).not.toHaveBeenCalled();
});
