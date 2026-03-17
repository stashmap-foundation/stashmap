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

test("init creates profile.json and me.nsec with valid keypair", () => {
  const cwd = makeTempDir();
  const result = runInitCommand([], cwd);

  if ("help" in result) {
    throw new Error("unexpected help");
  }

  expect(result.readonly).toBe(false);
  expect(result.config_path).toBe(path.join(cwd, ".knowstr", "profile.json"));

  const profile = JSON.parse(fs.readFileSync(result.config_path, "utf8")) as {
    pubkey: string;
    nsec_file: string;
    relays: unknown[];
  };
  expect(profile.nsec_file).toBe("./.knowstr/me.nsec");
  expect(profile.pubkey.startsWith("npub1")).toBe(true);
  expect(profile.relays.length).toBeGreaterThan(0);

  const nsecContent = fs
    .readFileSync(path.join(cwd, ".knowstr", "me.nsec"), "utf8")
    .trim();
  expect(nsecContent.startsWith("nsec1")).toBe(true);

  const privateKeyHex = convertInputToPrivateKey(nsecContent) as string;
  const derivedPubkey = getPublicKey(hexToBytes(privateKeyHex));
  expect(derivedPubkey).toBe(result.pubkey);
  expect(result.npub).toBe(nip19.npubEncode(derivedPubkey));
});

test("init --readonly --as-user creates read-only profile without nsec", () => {
  const cwd = makeTempDir();
  const hex = "a".repeat(64);
  const npub = nip19.npubEncode(hex);
  const result = runInitCommand(["--readonly", "--as-user", npub], cwd);

  if ("help" in result) {
    throw new Error("unexpected help");
  }

  expect(result.readonly).toBe(true);
  expect(result.pubkey).toBe(hex);
  expect(fs.existsSync(path.join(cwd, ".knowstr", "me.nsec"))).toBe(false);

  const profile = JSON.parse(fs.readFileSync(result.config_path, "utf8")) as {
    pubkey: string;
    nsec_file?: string;
    relays: Array<{ write: boolean }>;
  };
  expect(profile.nsec_file).toBeUndefined();
  expect(profile.pubkey).toBe(npub);
  expect(profile.relays.every((r) => r.write === false)).toBe(true);
});

test("init --readonly without --as-user throws", () => {
  const cwd = makeTempDir();
  expect(() => runInitCommand(["--readonly"], cwd)).toThrow(
    "--readonly requires --as-user"
  );
});

test("init refuses to overwrite existing profile.json", () => {
  const cwd = makeTempDir();
  runInitCommand([], cwd);
  expect(() => runInitCommand([], cwd)).toThrow("already exists");
});

test("init --as-user sets read_as and --doc sets workspace_dir", () => {
  const cwd = makeTempDir();
  const hex = "b".repeat(64);
  const result = runInitCommand(
    ["--as-user", hex, "--doc", "./workspace"],
    cwd
  );

  if ("help" in result) {
    throw new Error("unexpected help");
  }

  expect(result.read_as).toBe(hex);

  const profile = JSON.parse(fs.readFileSync(result.config_path, "utf8")) as {
    read_as: string;
    workspace_dir: string;
  };
  expect(profile.read_as).toBe(nip19.npubEncode(hex));
  expect(profile.workspace_dir).toBe("./workspace");
});
