/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { loadWorkspaceAsEvents } from "./workspaceBackend";

const TEST_PUBKEY = "a".repeat(64) as PublicKey;

function makeTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-backend-"));
}

test("loadWorkspaceAsEvents returns empty array for an empty workspace", async () => {
  const workspaceDir = makeTempWorkspace();
  const events = await loadWorkspaceAsEvents({
    pubkey: TEST_PUBKEY,
    workspaceDir,
  });
  expect(events).toEqual([]);
});

test("loadWorkspaceAsEvents returns one UnsignedEvent per markdown file", async () => {
  const workspaceDir = makeTempWorkspace();
  fs.writeFileSync(
    path.join(workspaceDir, "project.md"),
    "# Project\n- alpha\n- beta\n"
  );

  const events = await loadWorkspaceAsEvents({
    pubkey: TEST_PUBKEY,
    workspaceDir,
  });

  expect(events).toHaveLength(1);
  expect(events[0].pubkey).toBe(TEST_PUBKEY);
  expect(events[0].content).toContain("# Project");
});

test("loadWorkspaceAsEvents returns one event per file across multiple files", async () => {
  const workspaceDir = makeTempWorkspace();
  fs.writeFileSync(path.join(workspaceDir, "one.md"), "# One\n- x\n");
  fs.writeFileSync(path.join(workspaceDir, "two.md"), "# Two\n- y\n");
  fs.mkdirSync(path.join(workspaceDir, "nested"));
  fs.writeFileSync(
    path.join(workspaceDir, "nested", "three.md"),
    "# Three\n- z\n"
  );

  const events = await loadWorkspaceAsEvents({
    pubkey: TEST_PUBKEY,
    workspaceDir,
  });

  expect(events).toHaveLength(3);
});

test("loadWorkspaceAsEvents respects .knowstrignore", async () => {
  const workspaceDir = makeTempWorkspace();
  fs.writeFileSync(path.join(workspaceDir, "keep.md"), "# Keep\n- a\n");
  fs.writeFileSync(path.join(workspaceDir, "skip.md"), "# Skip\n- b\n");
  fs.writeFileSync(path.join(workspaceDir, ".knowstrignore"), "skip.md\n");

  const events = await loadWorkspaceAsEvents({
    pubkey: TEST_PUBKEY,
    workspaceDir,
  });

  expect(events).toHaveLength(1);
  expect(events[0].content).toContain("# Keep");
});
