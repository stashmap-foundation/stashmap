/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { runApplyCommand } from "./apply";
import { runSaveCommand } from "./save";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-apply-"));
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

function extractLine(content: string, pattern: string): string {
  const line = content
    .split("\n")
    .find((candidate) => candidate.includes(pattern));
  if (!line) {
    throw new Error(`missing line matching ${pattern}`);
  }
  return line;
}

function extractId(line: string): string {
  const match = line.match(/id:(\S+)/u);
  if (!match?.[1]) {
    throw new Error(`missing id in ${line}`);
  }
  return match[1];
}

test("apply --dry-run reports a new child under a known parent", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "holidays.md");
  fs.writeFileSync(documentPath, "# Holiday Destinations\n- Spain\n- France\n");

  await runSaveCommand(["--config", profilePath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  const rootId = extractId(extractLine(saved, "# Holiday Destinations"));
  const spainId = extractId(extractLine(saved, "- Spain"));
  const franceId = extractId(extractLine(saved, "- France"));
  const inboxDir = path.join(workspaceDir, "inbox");
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.writeFileSync(
    path.join(inboxDir, "bob.md"),
    [
      `# Holiday Destinations <!-- id:${rootId} -->`,
      `- Spain <!-- id:${spainId} -->`,
      `- France <!-- id:${franceId} -->`,
      "- Germany <!-- id:germany -->",
      "",
    ].join("\n")
  );

  const result = await runApplyCommand(["--config", profilePath, "--dry-run"]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }

  expect(result.dry_run).toBe(true);
  expect(result.graph_additions).toEqual([
    {
      parent_id: rootId,
      node_id: "germany",
      source_path: path.join(inboxDir, "bob.md"),
      target_path: documentPath,
    },
  ]);
  expect(fs.readFileSync(documentPath, "utf8")).not.toContain("Germany");
  expect(fs.readdirSync(inboxDir)).toEqual(["bob.md"]);
});

test("apply assigns ids to new inbox nodes before inserting them", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "holidays.md");
  fs.writeFileSync(documentPath, "# Holiday Destinations\n- Spain\n- France\n");

  await runSaveCommand(["--config", profilePath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  const rootId = extractId(extractLine(saved, "# Holiday Destinations"));
  const spainId = extractId(extractLine(saved, "- Spain"));
  const franceId = extractId(extractLine(saved, "- France"));
  const inboxDir = path.join(workspaceDir, "inbox");
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.writeFileSync(
    path.join(inboxDir, "bob.md"),
    [
      `# Holiday Destinations <!-- id:${rootId} -->`,
      `- Spain <!-- id:${spainId} -->`,
      `- France <!-- id:${franceId} -->`,
      "- Germany",
      "  - Berlin",
      "",
    ].join("\n")
  );

  const result = await runApplyCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }

  const updated = fs.readFileSync(documentPath, "utf8");
  expect(updated).toContain("- (?) Germany <!-- id:");
  expect(updated).toContain("  - Berlin <!-- id:");
  expect(result.invalid_inbox_paths).toEqual([]);
  expect(fs.readdirSync(inboxDir)).toEqual([]);
});

test("apply writes a new child under a known parent with preserved id and clears inbox", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "holidays.md");
  fs.writeFileSync(documentPath, "# Holiday Destinations\n- Spain\n- France\n");

  await runSaveCommand(["--config", profilePath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  const rootId = extractId(extractLine(saved, "# Holiday Destinations"));
  const spainId = extractId(extractLine(saved, "- Spain"));
  const franceId = extractId(extractLine(saved, "- France"));
  const inboxDir = path.join(workspaceDir, "inbox");
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.writeFileSync(
    path.join(inboxDir, "bob.md"),
    [
      `# Holiday Destinations <!-- id:${rootId} -->`,
      `- Spain <!-- id:${spainId} -->`,
      `- France <!-- id:${franceId} -->`,
      "- Germany <!-- id:germany -->",
      "",
    ].join("\n")
  );

  const result = await runApplyCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }

  expect(result.dry_run).toBe(false);
  expect(fs.readFileSync(documentPath, "utf8")).toContain(
    "- (?) Germany <!-- id:germany -->"
  );
  expect(fs.readdirSync(inboxDir)).toEqual([]);
  expect(
    fs.readFileSync(path.join(workspaceDir, "knowstr_log.md"), "utf8")
  ).toContain("applied (?) germany under");
});

test("apply puts a fully unknown subtree into maybe_relevant", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "notes.md");
  fs.writeFileSync(documentPath, "# Notes\n- Existing\n");

  await runSaveCommand(["--config", profilePath]);

  const inboxDir = path.join(workspaceDir, "inbox");
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.writeFileSync(
    path.join(inboxDir, "unknown.md"),
    [
      "# Travel Ideas <!-- id:travel -->",
      "- Austria <!-- id:austria -->",
      "",
    ].join("\n")
  );

  const result = await runApplyCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }

  const maybeRelevantPath = path.join(
    workspaceDir,
    "maybe_relevant",
    "unknown.md"
  );
  expect(result.maybe_relevant_paths).toEqual([maybeRelevantPath]);
  expect(fs.readFileSync(maybeRelevantPath, "utf8")).toContain(
    "# Travel Ideas <!-- id:travel -->"
  );
  expect(fs.readFileSync(maybeRelevantPath, "utf8")).toContain(
    "- Austria <!-- id:austria -->"
  );
  expect(fs.readdirSync(inboxDir)).toEqual([]);
});
