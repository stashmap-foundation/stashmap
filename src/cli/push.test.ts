/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { hexToBytes } from "@noble/hashes/utils";
import { Event, Filter, matchFilter, getPublicKey } from "nostr-tools";
import { LoadedCliProfile } from "./config";
import { pushPendingWritesWithPool } from "./push";
import {
  pullSyncWorkspace,
  SyncPullProfile,
  SyncQueryClient,
} from "../core/syncPull";
import { loadWorkspaceManifest } from "../core/workspaceState";

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
    kind: 34770,
    sig: "0".repeat(128),
    tags: [
      ["d", rootUuid],
      ["ms", `${createdAt * 1000}`],
    ],
    content: `# ${text} {${rootUuid}}\n- ${text} child {${rootUuid}-child}\n`,
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
    "root-a-original-root.md"
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

  expect(result.changed_paths).toEqual([
    `DOCUMENTS/${ALICE}/root-a-original-root.md`,
  ]);
  expect(result.remaining_paths).toEqual([]);
  expect(result.updated_paths).toEqual([
    `DOCUMENTS/${ALICE}/root-a-original-root.md`,
  ]);
  expect(result.copied_paths).toEqual([]);
  expect(result.relay_urls).toEqual([RELAY]);
  expect(close).toHaveBeenCalledWith([RELAY]);

  const manifest = await loadWorkspaceManifest(tempDir);
  const editedDocument = manifest?.documents.find(
    (document) => document.author === ALICE && document.d_tag === "root-a"
  );
  const basePath = path.join(knowstrHome, editedDocument?.base_path || "");

  expect(editedDocument?.path).toBe(`DOCUMENTS/${ALICE}/root-a-edited-root.md`);
  expect(fs.readFileSync(basePath, "utf8")).toContain("Edited Root");
});
