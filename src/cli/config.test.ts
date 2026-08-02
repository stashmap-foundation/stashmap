/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { LoadedCliProfile, loadCliProfile } from "./config";
import { createWorkspaceProfile } from "./init";
import { WorkspaceConfig } from "../workspaceConfig";

function workspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-config-"));
}

function configured(config: WorkspaceConfig): LoadedCliProfile {
  const workspaceDir = workspace();
  createWorkspaceProfile({ workspaceDir, workspaceConfig: config });
  return loadCliProfile({ cwd: workspaceDir });
}

test("a folder without a profile is a local workspace", () => {
  const workspaceDir = workspace();
  const profile = loadCliProfile({ cwd: workspaceDir });

  expect(profile.workspaceConfig).toEqual({
    storageRelays: [],
    roomRelays: [],
  });
  expect(profile.workspaceDir).toBe(workspaceDir);
  expect(profile.pubkey).toBeUndefined();
  expect(profile.nsecFile).toBeUndefined();
});

test("loads the room profile and derives its pubkey", () => {
  const profile = configured({
    storageRelays: [],
    roomRelays: ["wss://room.example/"],
  });

  expect(profile.workspaceConfig).toEqual({
    storageRelays: [],
    roomRelays: ["wss://room.example/"],
  });
  expect(profile.pubkey).toMatch(/^[0-9a-f]{64}$/u);
  expect(profile.nsecFile).toBe(
    path.join(profile.workspaceDir, ".knowstr", "me.nsec")
  );
});

test("profile parsing rejects legacy and unknown fields", () => {
  const workspaceDir = workspace();
  const profilePath = path.join(workspaceDir, ".knowstr", "profile.json");
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(
    profilePath,
    JSON.stringify({
      pubkey: "a".repeat(64),
      nsec_file: "./.knowstr/me.nsec",
      relays: ["wss://room.example/"],
    })
  );

  expect(() => loadCliProfile({ cwd: workspaceDir })).toThrow(
    "unsupported fields"
  );
});

test("profile parsing rejects storage relays", () => {
  const workspaceDir = workspace();
  const profilePath = path.join(workspaceDir, ".knowstr", "profile.json");
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(
    profilePath,
    JSON.stringify({
      nsec_file: "./.knowstr/me.nsec",
      storage_relays: ["wss://storage.example/"],
    })
  );

  expect(() => loadCliProfile({ cwd: workspaceDir })).toThrow(
    "unsupported fields"
  );
});

test("profile parsing rejects empty and invalid relay lists", () => {
  const workspaceDir = workspace();
  const knowstrDir = path.join(workspaceDir, ".knowstr");
  fs.mkdirSync(knowstrDir, { recursive: true });
  const profilePath = path.join(knowstrDir, "profile.json");
  fs.writeFileSync(
    profilePath,
    JSON.stringify({
      nsec_file: "./.knowstr/me.nsec",
      shared: { relays: [] },
    })
  );
  expect(() => loadCliProfile({ cwd: workspaceDir })).toThrow(
    "non-empty relay URL array"
  );

  fs.writeFileSync(
    profilePath,
    JSON.stringify({
      nsec_file: "./.knowstr/me.nsec",
      shared: { relays: ["https://room.example/"] },
    })
  );
  expect(() => loadCliProfile({ cwd: workspaceDir })).toThrow("ws or wss");
});

test("profile parsing rejects keys outside the workspace", () => {
  const workspaceDir = workspace();
  const profilePath = path.join(workspaceDir, ".knowstr", "profile.json");
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(
    profilePath,
    JSON.stringify({
      nsec_file: "../me.nsec",
      shared: { relays: ["wss://room.example/"] },
    })
  );

  expect(() => loadCliProfile({ cwd: workspaceDir })).toThrow(
    "relative workspace path"
  );
});
