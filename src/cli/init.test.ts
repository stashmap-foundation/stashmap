/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { createWorkspaceProfile, runInitCommand } from "./init";
import { convertInputToPrivateKey } from "../nostrKey";
import { DEFAULT_ROOM_RELAYS } from "../nostr";

function workspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-init-"));
}

function init(
  args: string[],
  cwd: string
): Exclude<
  ReturnType<typeof runInitCommand>,
  { help: true } | { configured: false }
> {
  const result = runInitCommand(args, cwd);
  if ("help" in result || !result.configured) {
    throw new Error("expected configured init result");
  }
  return result;
}

function readProfile(workspaceDir: string): ReturnType<typeof JSON.parse> {
  return JSON.parse(
    fs.readFileSync(path.join(workspaceDir, ".knowstr", "profile.json"), "utf8")
  );
}

test("bare init leaves a local workspace unconfigured", () => {
  const workspaceDir = workspace();
  const result = runInitCommand([], workspaceDir);

  expect(result).toEqual({
    configured: false,
    message: "Local work needs no configuration.",
    workspace_dir: workspaceDir,
  });
  expect(fs.existsSync(path.join(workspaceDir, ".knowstr"))).toBe(false);
});

test("relay arguments require a shared workspace", () => {
  const workspaceDir = workspace();

  expect(() =>
    runInitCommand(["--relay", "wss://room.example/"], workspaceDir)
  ).toThrow("--relay requires --shared");
  expect(fs.existsSync(path.join(workspaceDir, ".knowstr"))).toBe(false);
});

test("shared init creates the exact room profile", () => {
  const workspaceDir = workspace();
  init(["--shared", "--relay", "wss://room.example/"], workspaceDir);

  expect(readProfile(workspaceDir)).toEqual({
    nsec_file: "./.knowstr/me.nsec",
    shared: { relays: ["wss://room.example/"] },
  });
});

test("shared init persists the pinned default room relays", () => {
  const workspaceDir = workspace();
  init(["--shared"], workspaceDir);

  expect(readProfile(workspaceDir).shared.relays).toEqual(DEFAULT_ROOM_RELAYS);
});

test("doc selects the workspace directory without entering the profile", () => {
  const cwd = workspace();
  const workspaceDir = path.join(cwd, "documents");
  init(
    ["--doc", "documents", "--shared", "--relay", "wss://room.example/"],
    cwd
  );

  expect(readProfile(workspaceDir)).toEqual({
    nsec_file: "./.knowstr/me.nsec",
    shared: { relays: ["wss://room.example/"] },
  });
  expect(readProfile(workspaceDir)).not.toHaveProperty("workspace_dir");
});

test("shared init writes one mode-0600 nsec and derives the pubkey", () => {
  const workspaceDir = workspace();
  const result = init(
    ["--shared", "--relay", "wss://room.example/"],
    workspaceDir
  );
  const nsecPath = path.join(workspaceDir, ".knowstr", "me.nsec");
  const nsec = fs.readFileSync(nsecPath, "utf8").trim();
  const privateKeyHex = convertInputToPrivateKey(nsec);
  if (!privateKeyHex) {
    throw new Error("expected valid generated nsec");
  }

  expect(nsec.startsWith("nsec1")).toBe(true);
  expect(result.npub).toBe(
    nip19.npubEncode(getPublicKey(hexToBytes(privateKeyHex)))
  );
  expect(result.pubkey).toBe(getPublicKey(hexToBytes(privateKeyHex)));
  expect(fs.statSync(nsecPath).mode % 0o1000).toBe(0o600);
});

test("createWorkspaceProfile uses a supplied secret key", () => {
  const workspaceDir = workspace();
  const secretKey = generateSecretKey();
  const result = createWorkspaceProfile({
    workspaceDir,
    workspaceConfig: {
      storageRelays: [],
      roomRelays: ["wss://room.example/"],
    },
    secretKey,
  });

  expect(result.pubkey).toBe(getPublicKey(secretKey));
  expect(result.npub).toBe(nip19.npubEncode(getPublicKey(secretKey)));
});

test("init validates relays before creating key material", () => {
  const workspaceDir = workspace();
  expect(() =>
    init(["--shared", "--relay", "https://invalid.example/"], workspaceDir)
  ).toThrow("ws or wss");
  expect(fs.existsSync(path.join(workspaceDir, ".knowstr"))).toBe(false);
});

test("init refuses to overwrite an existing profile", () => {
  const workspaceDir = workspace();
  init(["--shared", "--relay", "wss://room.example/"], workspaceDir);
  expect(() =>
    init(["--shared", "--relay", "wss://room.example/"], workspaceDir)
  ).toThrow("already exists");
});
