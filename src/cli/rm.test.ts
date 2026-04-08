/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { runSaveCommand } from "./save";
import { runRmCommand } from "./rm";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-rm-"));
}

function writeProfile(
  workspaceDir: string,
  profile: Record<string, unknown>
): string {
  const knowstrHome = path.join(workspaceDir, ".knowstr");
  const profilePath = path.join(knowstrHome, "profile.json");
  fs.mkdirSync(knowstrHome, { recursive: true });
  fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
  return profilePath;
}

function setupWorkspace(): { workspaceDir: string; profilePath: string } {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  return { workspaceDir, profilePath };
}

function extractDocId(content: string): string {
  const match = content.match(/^knowstr_doc_id:\s*(.+)$/m);
  if (!match?.[1]) {
    throw new Error("missing knowstr_doc_id");
  }
  return match[1].trim();
}

function extractLine(content: string, pattern: string): string {
  const line = content
    .split("\n")
    .find((candidate) => candidate.includes(pattern));
  if (!line) {
    throw new Error(`missing line matching ${pattern}`);
  }
  return line;
}

function extractNodeId(line: string): string {
  const match = line.match(/<!--\s*id:(\S+)/);
  if (!match?.[1]) {
    throw new Error(`no id marker in line: ${line}`);
  }
  return match[1];
}

function readNodeIndex(workspaceDir: string): {
  version: number;
  nodes: Record<string, string>;
} {
  const indexPath = path.join(
    workspaceDir,
    ".knowstr",
    "state",
    "node-index.json"
  );
  return JSON.parse(fs.readFileSync(indexPath, "utf8"));
}

function baselinePath(workspaceDir: string, docId: string): string {
  return path.join(
    workspaceDir,
    ".knowstr",
    "base",
    "by-doc-id",
    `${docId}.md`
  );
}

async function expectNoOpSave(profilePath: string): Promise<void> {
  const result = await runSaveCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }
  expect(result.changed_paths).toEqual([]);
  expect(result.updated_paths).toEqual([]);
}

test("rm of an existing file deletes the file, baseline, and index entries", async () => {
  const { workspaceDir, profilePath } = setupWorkspace();
  const docPath = path.join(workspaceDir, "a.md");
  fs.writeFileSync(docPath, "# Alpha\n- one\n- two\n");

  await runSaveCommand(["--config", profilePath]);

  const saved = fs.readFileSync(docPath, "utf8");
  const docId = extractDocId(saved);
  expect(fs.existsSync(baselinePath(workspaceDir, docId))).toBe(true);
  const indexBefore = readNodeIndex(workspaceDir);
  expect(Object.values(indexBefore.nodes)).toContain(docId);

  const result = await runRmCommand(["--config", profilePath, "a.md"]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }

  expect(result.removed_files).toEqual([docPath]);
  expect(result.removed_baselines).toEqual([docId]);
  expect(result.removed_node_ids.length).toBeGreaterThan(0);
  expect(fs.existsSync(docPath)).toBe(false);
  expect(fs.existsSync(baselinePath(workspaceDir, docId))).toBe(false);

  const indexAfter = readNodeIndex(workspaceDir);
  expect(Object.values(indexAfter.nodes)).not.toContain(docId);

  await expectNoOpSave(profilePath);
});

test("rm of a renamed file works because frontmatter is the source of truth", async () => {
  const { workspaceDir, profilePath } = setupWorkspace();
  const oldPath = path.join(workspaceDir, "a.md");
  fs.writeFileSync(oldPath, "# Alpha\n- one\n");

  await runSaveCommand(["--config", profilePath]);
  const saved = fs.readFileSync(oldPath, "utf8");
  const docId = extractDocId(saved);

  const subDir = path.join(workspaceDir, "sub");
  fs.mkdirSync(subDir, { recursive: true });
  const newPath = path.join(subDir, "b.md");
  fs.renameSync(oldPath, newPath);

  const result = await runRmCommand(["--config", profilePath, "sub/b.md"]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }

  expect(result.removed_files).toEqual([newPath]);
  expect(result.removed_baselines).toEqual([docId]);
  expect(fs.existsSync(newPath)).toBe(false);
  expect(fs.existsSync(baselinePath(workspaceDir, docId))).toBe(false);

  await expectNoOpSave(profilePath);
});

test("rm of a doc by docId after manual file removal cleans up baseline and index", async () => {
  const { workspaceDir, profilePath } = setupWorkspace();
  const docPath = path.join(workspaceDir, "doc.md");
  fs.writeFileSync(docPath, "# Doc\n- one\n");

  await runSaveCommand(["--config", profilePath]);
  const docId = extractDocId(fs.readFileSync(docPath, "utf8"));

  fs.rmSync(docPath);

  const result = await runRmCommand(["--config", profilePath, docId]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }

  expect(result.removed_files).toEqual([]);
  expect(result.removed_baselines).toEqual([docId]);
  expect(fs.existsSync(baselinePath(workspaceDir, docId))).toBe(false);

  const indexAfter = readNodeIndex(workspaceDir);
  expect(Object.values(indexAfter.nodes)).not.toContain(docId);

  await expectNoOpSave(profilePath);
});

test("rm of a doc by docId errors when the file is still present", async () => {
  const { workspaceDir, profilePath } = setupWorkspace();
  const docPath = path.join(workspaceDir, "doc.md");
  fs.writeFileSync(docPath, "# Doc\n- one\n");

  await runSaveCommand(["--config", profilePath]);
  const savedBefore = fs.readFileSync(docPath, "utf8");
  const docId = extractDocId(savedBefore);

  await expect(runRmCommand(["--config", profilePath, docId])).rejects.toThrow(
    /still has a workspace file at doc\.md/
  );

  expect(fs.readFileSync(docPath, "utf8")).toBe(savedBefore);
  expect(fs.existsSync(baselinePath(workspaceDir, docId))).toBe(true);
});

test("rm of a lost node id removes it from the index without touching files", async () => {
  const { workspaceDir, profilePath } = setupWorkspace();
  const docPath = path.join(workspaceDir, "doc.md");
  fs.writeFileSync(docPath, "# Doc\n- keep\n- drop me\n");

  await runSaveCommand(["--config", profilePath]);
  const saved = fs.readFileSync(docPath, "utf8");
  const dropLine = extractLine(saved, "drop me");
  const droppedNodeId = extractNodeId(dropLine);

  fs.writeFileSync(docPath, saved.replace(`${dropLine}\n`, ""));

  await expect(runSaveCommand(["--config", profilePath])).rejects.toThrow(
    /Workspace loses existing node ids/
  );

  const result = await runRmCommand(["--config", profilePath, droppedNodeId]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }
  expect(result.removed_files).toEqual([]);
  expect(result.removed_baselines).toEqual([]);
  expect(result.removed_node_ids).toEqual([droppedNodeId]);

  const indexAfter = readNodeIndex(workspaceDir);
  expect(indexAfter.nodes[droppedNodeId]).toBeUndefined();
  expect(fs.existsSync(docPath)).toBe(true);
  expect(fs.readFileSync(docPath, "utf8")).toContain("- keep");

  await expectNoOpSave(profilePath);
});

test("rm of a node id that is still in the workspace errors with the file path", async () => {
  const { workspaceDir, profilePath } = setupWorkspace();
  const docPath = path.join(workspaceDir, "doc.md");
  fs.writeFileSync(docPath, "# Doc\n- still here\n");

  await runSaveCommand(["--config", profilePath]);
  const saved = fs.readFileSync(docPath, "utf8");
  const stillHereLine = extractLine(saved, "still here");
  const stillHereNodeId = extractNodeId(stillHereLine);

  await expect(
    runRmCommand(["--config", profilePath, stillHereNodeId])
  ).rejects.toThrow(/still in workspace at doc\.md/);

  expect(fs.readFileSync(docPath, "utf8")).toBe(saved);
  const indexAfter = readNodeIndex(workspaceDir);
  expect(indexAfter.nodes[stillHereNodeId]).toBeDefined();
});

test("rm of an unknown UUID errors with no matching doc or node id", async () => {
  const { workspaceDir, profilePath } = setupWorkspace();
  const docPath = path.join(workspaceDir, "doc.md");
  fs.writeFileSync(docPath, "# Doc\n- one\n");
  await runSaveCommand(["--config", profilePath]);

  const indexBefore = JSON.stringify(readNodeIndex(workspaceDir));
  const unknownUuid = "00000000-0000-4000-8000-000000000000";

  await expect(
    runRmCommand(["--config", profilePath, unknownUuid])
  ).rejects.toThrow(/no matching doc or node id/);

  expect(JSON.stringify(readNodeIndex(workspaceDir))).toBe(indexBefore);
});

test("rm of a path that does not exist errors with a hint about docId", async () => {
  const { workspaceDir, profilePath } = setupWorkspace();
  const docPath = path.join(workspaceDir, "doc.md");
  fs.writeFileSync(docPath, "# Doc\n- one\n");
  await runSaveCommand(["--config", profilePath]);

  const indexBefore = JSON.stringify(readNodeIndex(workspaceDir));

  await expect(
    runRmCommand(["--config", profilePath, "missing.md"])
  ).rejects.toThrow(/no such file[\s\S]*knowstr rm <docId>/);

  expect(JSON.stringify(readNodeIndex(workspaceDir))).toBe(indexBefore);
});

test("rm with no targets shows help and changes nothing", async () => {
  const { workspaceDir, profilePath } = setupWorkspace();
  const docPath = path.join(workspaceDir, "doc.md");
  fs.writeFileSync(docPath, "# Doc\n- one\n");
  await runSaveCommand(["--config", profilePath]);

  const indexBefore = JSON.stringify(readNodeIndex(workspaceDir));

  await expect(runRmCommand(["--config", profilePath])).rejects.toThrow(
    /at least one target/
  );

  expect(JSON.stringify(readNodeIndex(workspaceDir))).toBe(indexBefore);
});

test("rm with multiple mixed targets is atomic", async () => {
  const { workspaceDir, profilePath } = setupWorkspace();
  const aPath = path.join(workspaceDir, "a.md");
  const bPath = path.join(workspaceDir, "b.md");
  const cPath = path.join(workspaceDir, "c.md");
  fs.writeFileSync(aPath, "# A\n- one\n");
  fs.writeFileSync(bPath, "# B\n- two\n");
  fs.writeFileSync(cPath, "# C\n- keep\n- drop me\n");

  await runSaveCommand(["--config", profilePath]);

  const aDocId = extractDocId(fs.readFileSync(aPath, "utf8"));
  const bDocId = extractDocId(fs.readFileSync(bPath, "utf8"));
  const cContent = fs.readFileSync(cPath, "utf8");
  const dropLine = extractLine(cContent, "drop me");
  const droppedNodeId = extractNodeId(dropLine);

  fs.writeFileSync(cPath, cContent.replace(`${dropLine}\n`, ""));
  fs.rmSync(bPath);

  const result = await runRmCommand([
    "--config",
    profilePath,
    "a.md",
    bDocId,
    droppedNodeId,
  ]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }

  expect(result.removed_files).toEqual([aPath]);
  expect([...result.removed_baselines].sort()).toEqual([aDocId, bDocId].sort());
  expect(result.removed_node_ids).toContain(droppedNodeId);

  expect(fs.existsSync(aPath)).toBe(false);
  expect(fs.existsSync(baselinePath(workspaceDir, aDocId))).toBe(false);
  expect(fs.existsSync(baselinePath(workspaceDir, bDocId))).toBe(false);
  expect(fs.existsSync(cPath)).toBe(true);

  const indexAfter = readNodeIndex(workspaceDir);
  expect(Object.values(indexAfter.nodes)).not.toContain(aDocId);
  expect(Object.values(indexAfter.nodes)).not.toContain(bDocId);
  expect(indexAfter.nodes[droppedNodeId]).toBeUndefined();

  await expectNoOpSave(profilePath);
});

test("rm with one bad target among several rolls back", async () => {
  const { workspaceDir, profilePath } = setupWorkspace();
  const aPath = path.join(workspaceDir, "a.md");
  const bPath = path.join(workspaceDir, "b.md");
  fs.writeFileSync(aPath, "# A\n- one\n");
  fs.writeFileSync(bPath, "# B\n- two\n");
  await runSaveCommand(["--config", profilePath]);

  const indexBefore = JSON.stringify(readNodeIndex(workspaceDir));
  const unknownUuid = "00000000-0000-4000-8000-000000000000";

  await expect(
    runRmCommand(["--config", profilePath, "a.md", unknownUuid, "b.md"])
  ).rejects.toThrow(unknownUuid);

  expect(fs.existsSync(aPath)).toBe(true);
  expect(fs.existsSync(bPath)).toBe(true);
  expect(JSON.stringify(readNodeIndex(workspaceDir))).toBe(indexBefore);
});

test("rm of a file in a nested subdirectory resolves the relative path", async () => {
  const { workspaceDir, profilePath } = setupWorkspace();
  const nestedDir = path.join(workspaceDir, "deep", "deeper");
  fs.mkdirSync(nestedDir, { recursive: true });
  const docPath = path.join(nestedDir, "x.md");
  fs.writeFileSync(docPath, "# Deep\n- one\n");
  await runSaveCommand(["--config", profilePath]);

  const docId = extractDocId(fs.readFileSync(docPath, "utf8"));

  const result = await runRmCommand([
    "--config",
    profilePath,
    "deep/deeper/x.md",
  ]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }
  expect(result.removed_files).toEqual([docPath]);
  expect(result.removed_baselines).toEqual([docId]);
  expect(fs.existsSync(docPath)).toBe(false);

  await expectNoOpSave(profilePath);
});

test("rm of every file leaves a valid empty state and save still succeeds", async () => {
  const { workspaceDir, profilePath } = setupWorkspace();
  const aPath = path.join(workspaceDir, "a.md");
  const bPath = path.join(workspaceDir, "b.md");
  fs.writeFileSync(aPath, "# A\n- one\n");
  fs.writeFileSync(bPath, "# B\n- two\n");
  await runSaveCommand(["--config", profilePath]);

  const result = await runRmCommand(["--config", profilePath, "a.md", "b.md"]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }
  expect([...result.removed_files].sort()).toEqual([aPath, bPath].sort());

  expect(fs.existsSync(aPath)).toBe(false);
  expect(fs.existsSync(bPath)).toBe(false);
  expect(readNodeIndex(workspaceDir).nodes).toEqual({});

  await expectNoOpSave(profilePath);
});

test("rm --help returns the help text", async () => {
  const { profilePath } = setupWorkspace();
  const result = await runRmCommand(["--config", profilePath, "--help"]);
  if (!("help" in result)) {
    throw new Error("expected help");
  }
  expect(result.text).toContain("knowstr rm");
});
