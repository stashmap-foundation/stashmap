/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { hexToBytes } from "@noble/hashes/utils";
import { getPublicKey } from "nostr-tools";
import { pushPendingWritesWithPool } from "./push";
import { writeCreateRoot } from "../core/writeCreateRoot";

const PRIVATE_KEY = "1".repeat(64);
const PUBKEY = getPublicKey(hexToBytes(PRIVATE_KEY)) as PublicKey;

test("pushPendingWritesWithPool closes the relays it used", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-push-cli-"));
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

  const close = jest.fn();
  const pool = {
    close,
    publish: jest.fn((relayUrls: string[]) =>
      relayUrls.map(() => Promise.resolve("ok"))
    ),
  };

  const result = await pushPendingWritesWithPool(
    pool,
    {
      pubkey: PUBKEY,
      knowstrHome,
      relays: [{ url: "wss://write.example/", read: true, write: true }],
      nsecFile: nsecPath,
    },
    []
  );

  expect(result.relay_urls).toEqual(["wss://override.example/"]);
  expect(close).toHaveBeenCalledWith(["wss://override.example/"]);
});
