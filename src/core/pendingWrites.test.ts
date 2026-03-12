/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { Map } from "immutable";
import { getPublicKey } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import {
  loadPendingWriteEntries,
  pushPendingWriteEntries,
} from "./pendingWrites";
import { writeCreateRoot } from "./writeCreateRoot";

const PRIVATE_KEY = "1".repeat(64);
const PUBKEY = getPublicKey(hexToBytes(PRIVATE_KEY)) as PublicKey;

test("pushPendingWriteEntries publishes queued events and clears them on success", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-push-"));
  const knowstrHome = path.join(tempDir, ".knowstr");
  const nsecPath = path.join(tempDir, "me.nsec");
  fs.writeFileSync(nsecPath, PRIVATE_KEY);

  await writeCreateRoot(
    {
      pubkey: PUBKEY,
      knowstrHome,
      relays: [{ url: "wss://write.example/", read: true, write: true }],
      nsecFile: nsecPath,
    },
    {
      title: "My Root",
      relayUrls: ["wss://override.example/"],
    }
  );

  const publishEvent = jest.fn((relayUrls, event) =>
    Promise.resolve({
      event,
      results: Map<string, PublishStatus>().set(relayUrls[0] || "", {
        status: "fulfilled",
      }),
    })
  );

  const result = await pushPendingWriteEntries(
    { publishEvent },
    {
      pubkey: PUBKEY,
      knowstrHome,
      relays: [{ url: "wss://write.example/", read: true, write: true }],
      nsecFile: nsecPath,
    }
  );
  const pendingEntries = await loadPendingWriteEntries(knowstrHome);

  expect(result.event_ids).toHaveLength(1);
  expect(result.remaining_event_ids).toEqual([]);
  expect(result.relay_urls).toEqual(["wss://override.example/"]);
  expect(pendingEntries).toEqual([]);
});
