/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { loadWorkspaceAsDocuments } from "./workspaceBackend";

const TEST_PUBKEY = "a".repeat(64) as PublicKey;

function makeTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-backend-"));
}

test("loadWorkspaceAsDocuments returns empty array for an empty workspace", async () => {
  const workspaceDir = makeTempWorkspace();
  const documents = await loadWorkspaceAsDocuments({
    pubkey: TEST_PUBKEY,
    workspaceDir,
  });
  expect(documents).toEqual([]);
});

test("loadWorkspaceAsDocuments returns one Document per markdown file", async () => {
  const workspaceDir = makeTempWorkspace();
  fs.writeFileSync(
    path.join(workspaceDir, "project.md"),
    "# Project\n- alpha\n- beta\n"
  );

  const documents = await loadWorkspaceAsDocuments({
    pubkey: TEST_PUBKEY,
    workspaceDir,
  });

  expect(documents).toHaveLength(1);
  expect(documents[0].author).toBe(TEST_PUBKEY);
  expect(documents[0].relativePath).toBe("project.md");
  expect(documents[0].currentContent).toContain("# Project");
});

test("loadWorkspaceAsDocuments returns one Document per file across multiple files", async () => {
  const workspaceDir = makeTempWorkspace();
  fs.writeFileSync(path.join(workspaceDir, "one.md"), "# One\n- x\n");
  fs.writeFileSync(path.join(workspaceDir, "two.md"), "# Two\n- y\n");
  fs.mkdirSync(path.join(workspaceDir, "nested"));
  fs.writeFileSync(
    path.join(workspaceDir, "nested", "three.md"),
    "# Three\n- z\n"
  );

  const documents = await loadWorkspaceAsDocuments({
    pubkey: TEST_PUBKEY,
    workspaceDir,
  });

  expect(documents).toHaveLength(3);
});

test("loadWorkspaceAsDocuments respects .knowstrignore", async () => {
  const workspaceDir = makeTempWorkspace();
  fs.writeFileSync(path.join(workspaceDir, "keep.md"), "# Keep\n- a\n");
  fs.writeFileSync(path.join(workspaceDir, "skip.md"), "# Skip\n- b\n");
  fs.writeFileSync(path.join(workspaceDir, ".knowstrignore"), "skip.md\n");

  const documents = await loadWorkspaceAsDocuments({
    pubkey: TEST_PUBKEY,
    workspaceDir,
  });

  expect(documents).toHaveLength(1);
  expect(documents[0].currentContent).toContain("# Keep");
});

test("loadWorkspaceAsDocuments falls back to filename basename when frontmatter has no title", async () => {
  const workspaceDir = makeTempWorkspace();
  fs.writeFileSync(
    path.join(workspaceDir, "holiday-destinations.md"),
    "# Spain\n- Madrid\n"
  );

  const documents = await loadWorkspaceAsDocuments({
    pubkey: TEST_PUBKEY,
    workspaceDir,
  });

  expect(documents[0].title).toBe("holiday-destinations");
});

test("loadWorkspaceAsDocuments populates Document.title from frontmatter", async () => {
  const workspaceDir = makeTempWorkspace();
  fs.writeFileSync(
    path.join(workspaceDir, "trip.md"),
    `---\ntitle: "Holiday Destinations"\n---\n# Spain\n- Madrid\n`
  );

  const documents = await loadWorkspaceAsDocuments({
    pubkey: TEST_PUBKEY,
    workspaceDir,
  });

  expect(documents).toHaveLength(1);
  expect(documents[0].title).toBe("Holiday Destinations");
});

test("loadWorkspaceAsDocuments does not mutate files on disk", async () => {
  const workspaceDir = makeTempWorkspace();
  const before = "# Notes\n- alpha\n";
  fs.writeFileSync(path.join(workspaceDir, "notes.md"), before);

  await loadWorkspaceAsDocuments({ pubkey: TEST_PUBKEY, workspaceDir });

  expect(fs.readFileSync(path.join(workspaceDir, "notes.md"), "utf8")).toBe(
    before
  );
});
