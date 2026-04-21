/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { createWorkspaceProfile, runInitCommand } from "./init";
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

test("createWorkspaceProfile generates a fresh keypair when secretKey omitted", () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-cwp-"));
  const result = createWorkspaceProfile({ workspaceDir });

  const nsecRaw = fs.readFileSync(result.nsecPath, "utf8").trim();
  expect(nsecRaw.startsWith("nsec1")).toBe(true);
  expect(result.npub.startsWith("npub1")).toBe(true);

  const stat = fs.statSync(result.nsecPath);
  // eslint-disable-next-line no-bitwise
  expect(stat.mode & 0o777).toBe(0o600);

  const privateKeyHex = convertInputToPrivateKey(nsecRaw) as string;
  const derivedPubkey = getPublicKey(hexToBytes(privateKeyHex));
  expect(derivedPubkey).toBe(result.pubkey);
  expect(nip19.npubEncode(derivedPubkey)).toBe(result.npub);

  const profile = JSON.parse(fs.readFileSync(result.profilePath, "utf8")) as {
    pubkey: string;
    nsec_file: string;
    relays: unknown[];
  };
  expect(profile.pubkey).toBe(result.npub);
  expect(profile.nsec_file).toBe("./.knowstr/me.nsec");
  expect(profile.relays).toEqual([]);
});

test("createWorkspaceProfile uses the provided secretKey", () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-cwp-"));
  const secretKey = generateSecretKey();
  const expectedPubkey = getPublicKey(secretKey);
  const expectedNpub = nip19.npubEncode(expectedPubkey);

  const result = createWorkspaceProfile({ workspaceDir, secretKey });

  expect(result.pubkey).toBe(expectedPubkey);
  expect(result.npub).toBe(expectedNpub);

  const profile = JSON.parse(fs.readFileSync(result.profilePath, "utf8")) as {
    pubkey: string;
  };
  expect(profile.pubkey).toBe(expectedNpub);

  const nsecRaw = fs.readFileSync(result.nsecPath, "utf8").trim();
  const privateKeyHex = convertInputToPrivateKey(nsecRaw) as string;
  expect(getPublicKey(hexToBytes(privateKeyHex))).toBe(expectedPubkey);
});

test("createWorkspaceProfile refuses to overwrite an existing profile.json", () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-cwp-"));
  createWorkspaceProfile({ workspaceDir });
  expect(() => createWorkspaceProfile({ workspaceDir })).toThrow(
    "already exists"
  );
});

test("createWorkspaceProfile records relays and documentDir", () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-cwp-"));
  const relays: Relays = [
    { url: "wss://r.example/", read: true, write: false },
  ];
  const result = createWorkspaceProfile({
    workspaceDir,
    relays,
    documentDir: "./docs",
  });

  const profile = JSON.parse(fs.readFileSync(result.profilePath, "utf8")) as {
    relays: Array<{ url: string; read: boolean; write: boolean }>;
    workspace_dir: string;
  };
  expect(profile.relays).toEqual(relays);
  expect(profile.workspace_dir).toBe("./docs");
});
