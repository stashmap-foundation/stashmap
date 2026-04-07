/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { getPublicKey, nip19 } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { runInitCommand } from "./init";
import { convertInputToPrivateKey } from "../nostrKey";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-init-"));
}

test("init creates profile.json and me.nsec with valid keypair and empty relays by default", () => {
  const cwd = makeTempDir();
  const result = runInitCommand([], cwd);

  if ("help" in result) {
    throw new Error("unexpected help");
  }

  expect(result.config_path).toBe(path.join(cwd, ".knowstr", "profile.json"));

  const profile = JSON.parse(fs.readFileSync(result.config_path, "utf8")) as {
    pubkey: string;
    nsec_file: string;
    relays: unknown[];
  };
  expect(profile.nsec_file).toBe("./.knowstr/me.nsec");
  expect(profile.pubkey.startsWith("npub1")).toBe(true);
  expect(profile.relays).toEqual([]);
  expect(result.relays).toEqual([]);

  const nsecContent = fs
    .readFileSync(path.join(cwd, ".knowstr", "me.nsec"), "utf8")
    .trim();
  expect(nsecContent.startsWith("nsec1")).toBe(true);

  const privateKeyHex = convertInputToPrivateKey(nsecContent) as string;
  const derivedPubkey = getPublicKey(hexToBytes(privateKeyHex));
  expect(derivedPubkey).toBe(result.pubkey);
  expect(result.npub).toBe(nip19.npubEncode(derivedPubkey));
});

test("init --relay adds explicit relays to profile", () => {
  const cwd = makeTempDir();
  const result = runInitCommand(
    ["--relay", "wss://a.example/", "--relay", "wss://b.example/"],
    cwd
  );

  if ("help" in result) {
    throw new Error("unexpected help");
  }

  const profile = JSON.parse(fs.readFileSync(result.config_path, "utf8")) as {
    relays: Array<{ url: string; read: boolean; write: boolean }>;
  };
  expect(profile.relays).toEqual([
    { url: "wss://a.example/", read: true, write: true },
    { url: "wss://b.example/", read: true, write: true },
  ]);
});

test("init refuses to overwrite existing profile.json", () => {
  const cwd = makeTempDir();
  runInitCommand([], cwd);
  expect(() => runInitCommand([], cwd)).toThrow("already exists");
});

test("init --doc sets workspace_dir", () => {
  const cwd = makeTempDir();
  const result = runInitCommand(["--doc", "./workspace"], cwd);

  if ("help" in result) {
    throw new Error("unexpected help");
  }

  const profile = JSON.parse(fs.readFileSync(result.config_path, "utf8")) as {
    workspace_dir: string;
  };
  expect(profile.workspace_dir).toBe("./workspace");
});
