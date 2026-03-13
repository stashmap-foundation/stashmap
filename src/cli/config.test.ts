/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { loadCliProfile } from "./config";

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

test("loadCliProfile defaults the workspace root to the current agent directory", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-config-"));
  const agentDir = path.join(tempDir, "agents", "codex-me");
  const knowstrDir = path.join(agentDir, ".knowstr");
  const configPath = path.join(knowstrDir, "profile.json");

  writeJson(configPath, {
    pubkey: "a".repeat(64),
    nsec_file: "./.knowstr/me.nsec",
    bootstrap_relays: ["wss://bootstrap.example/"],
    relays: [{ url: "wss://profile.example/", read: true, write: false }],
  });

  const profile = loadCliProfile({ cwd: agentDir });

  expect(profile.configPath).toBe(configPath);
  expect(profile.agentRoot).toBe(agentDir);
  expect(profile.workspaceDir).toBe(agentDir);
  expect(profile.readAs).toBe("a".repeat(64));
  expect(profile.nsecFile).toBe(path.join(agentDir, ".knowstr", "me.nsec"));
  expect(profile.bootstrapRelays.map((relay) => relay.url)).toEqual([
    "wss://bootstrap.example/",
  ]);
  expect(profile.relays.map((relay) => relay.url)).toEqual([
    "wss://profile.example/",
  ]);
});

test("loadCliProfile supports reading as another user", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-config-"));
  const agentDir = path.join(tempDir, "agents", "codex-me");
  const knowstrDir = path.join(agentDir, ".knowstr");
  const configPath = path.join(knowstrDir, "profile.json");

  writeJson(configPath, {
    pubkey: "a".repeat(64),
    read_as: "b".repeat(64),
    relays: ["wss://profile.example/"],
  });

  const profile = loadCliProfile({ cwd: agentDir });

  expect(profile.pubkey).toBe("a".repeat(64));
  expect(profile.readAs).toBe("b".repeat(64));
});
