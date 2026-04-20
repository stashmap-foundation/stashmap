/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { getPublicKey, nip19 } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { runInitCommand } from "./init";
import { convertInputToPrivateKey } from "../nostrKey";
import { knowstrInit } from "../testFixtures/workspace";

test("knowstrInit generates a fresh nsec + npub and writes profile.json / me.nsec", () => {
  const { nsec, npub, path: workspaceDir, profilePath } = knowstrInit();

  expect(nsec.startsWith("nsec1")).toBe(true);
  expect(npub.startsWith("npub1")).toBe(true);
  expect(profilePath).toBe(path.join(workspaceDir, ".knowstr", "profile.json"));

  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8")) as {
    pubkey: string;
    nsec_file: string;
    relays: unknown[];
  };
  expect(profile.pubkey).toBe(npub);
  expect(profile.nsec_file).toBe("./.knowstr/me.nsec");
  expect(profile.relays).toEqual([]);

  const privateKeyHex = convertInputToPrivateKey(nsec) as string;
  const derivedPubkey = getPublicKey(hexToBytes(privateKeyHex));
  expect(nip19.npubEncode(derivedPubkey)).toBe(npub);
});

test("knowstrInit with relays adds them to profile.json", () => {
  const { profilePath } = knowstrInit({
    relays: ["wss://a.example/", "wss://b.example/"],
  });

  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8")) as {
    relays: Array<{ url: string; read: boolean; write: boolean }>;
  };
  expect(profile.relays).toEqual([
    { url: "wss://a.example/", read: true, write: true },
    { url: "wss://b.example/", read: true, write: true },
  ]);
});

test("knowstrInit with doc sets workspace_dir", () => {
  const { profilePath } = knowstrInit({ doc: "./workspace" });

  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8")) as {
    workspace_dir: string;
  };
  expect(profile.workspace_dir).toBe("./workspace");
});

test("init refuses to overwrite existing profile.json", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-init-"));
  runInitCommand([], cwd);
  expect(() => runInitCommand([], cwd)).toThrow("already exists");
});
