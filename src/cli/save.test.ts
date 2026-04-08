/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { runSaveCommand } from "./save";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-save-"));
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

test("save assigns knowstr_doc_id and node ids in place and writes a baseline by doc id", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const notesDir = path.join(workspaceDir, "notes", "nested");
  fs.mkdirSync(notesDir, { recursive: true });
  const documentPath = path.join(notesDir, "project.md");
  fs.writeFileSync(documentPath, "# Project\n- alpha\n- beta\n");

  const result = await runSaveCommand(["--config", profilePath]);

  if ("help" in result) {
    throw new Error("unexpected help");
  }

  expect(result.changed_paths).toEqual([documentPath]);
  expect(result.updated_paths).toEqual([documentPath]);

  const savedContent = fs.readFileSync(documentPath, "utf8");
  expect(savedContent).toMatch(/^---\nknowstr_doc_id:\s.+\n---\n#/);
  expect(savedContent).toContain("# Project <!-- id:");
  expect(savedContent).toContain("- alpha <!-- id:");
  expect(savedContent).toContain("- beta <!-- id:");

  const docId = extractDocId(savedContent);
  const baselinePath = path.join(
    workspaceDir,
    ".knowstr",
    "base",
    "by-doc-id",
    `${docId}.md`
  );
  expect(fs.existsSync(baselinePath)).toBe(true);
  expect(fs.readFileSync(baselinePath, "utf8")).toBe(savedContent);
  expect(path.relative(workspaceDir, documentPath)).toBe(
    "notes/nested/project.md"
  );
});

test("save preserves existing frontmatter and only adds knowstr_doc_id", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "doc.md");
  fs.writeFileSync(
    documentPath,
    `---
title: "Doc"
custom: yes
---

- one
`
  );

  const result = await runSaveCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }

  const savedContent = fs.readFileSync(documentPath, "utf8");
  expect(savedContent).toContain('title: "Doc"');
  expect(savedContent).toContain("custom: yes");
  expect(savedContent).toContain("knowstr_doc_id:");
  expect(savedContent).toContain("# Doc <!-- id:");
});

test("save is a no-op when nothing changed", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "doc.md");
  fs.writeFileSync(documentPath, "# Doc\n- one\n");

  await runSaveCommand(["--config", profilePath]);
  const second = await runSaveCommand(["--config", profilePath]);

  if ("help" in second) {
    throw new Error("unexpected help");
  }

  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
});

test("save allows moving a node from one document to another", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const docAPath = path.join(workspaceDir, "a.md");
  const docBPath = path.join(workspaceDir, "b.md");
  fs.writeFileSync(docAPath, "# Alpha\n- keep here\n- move me\n");
  fs.writeFileSync(docBPath, "# Beta\n- keep there\n");

  await runSaveCommand(["--config", profilePath]);

  const docA = fs.readFileSync(docAPath, "utf8");
  const docB = fs.readFileSync(docBPath, "utf8");
  const movedLine = extractLine(docA, "move me");
  const targetLine = extractLine(docB, "keep there");

  fs.writeFileSync(docAPath, docA.replace(`${movedLine}\n`, ""));
  fs.writeFileSync(
    docBPath,
    docB.replace(`${targetLine}\n`, `${targetLine}\n${movedLine}\n`)
  );

  const result = await runSaveCommand(["--config", profilePath]);

  if ("help" in result) {
    throw new Error("unexpected help");
  }

  expect(result.updated_paths).toHaveLength(2);
  expect(result.updated_paths).toEqual(
    expect.arrayContaining([docAPath, docBPath])
  );
  expect(fs.readFileSync(docAPath, "utf8")).not.toContain("move me");
  expect(fs.readFileSync(docBPath, "utf8")).toContain("move me");
});

test("save rejects losing an existing node id from the workspace", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "doc.md");
  fs.writeFileSync(documentPath, "# Doc\n- keep\n- remove me\n");

  await runSaveCommand(["--config", profilePath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  const removedLine = extractLine(saved, "remove me");
  fs.writeFileSync(documentPath, saved.replace(`${removedLine}\n`, ""));

  await expect(runSaveCommand(["--config", profilePath])).rejects.toMatchObject(
    {
      message: expect.stringContaining("Workspace loses existing node ids"),
    }
  );
  await expect(runSaveCommand(["--config", profilePath])).rejects.toMatchObject(
    {
      message: expect.stringContaining(removedLine),
    }
  );
  await expect(runSaveCommand(["--config", profilePath])).rejects.toMatchObject(
    {
      message: expect.stringContaining(
        'Restore the missing line, or move it under "# Delete" to delete it explicitly.'
      ),
    }
  );
});

test("save error message groups lost nodes by docId, labels file presence, and points to knowstr rm", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const stillPresentPath = path.join(workspaceDir, "notes", "projects.md");
  const fullyLostPath = path.join(workspaceDir, "holiday.md");
  fs.mkdirSync(path.dirname(stillPresentPath), { recursive: true });
  fs.writeFileSync(
    stillPresentPath,
    "# Projects\n- Buy ingredients\n- Plan menu\n"
  );
  fs.writeFileSync(
    fullyLostPath,
    "# Holiday Plans\n- Spain\n- France\n- Italy\n"
  );

  await runSaveCommand(["--config", profilePath]);

  const savedProjects = fs.readFileSync(stillPresentPath, "utf8");
  const savedHoliday = fs.readFileSync(fullyLostPath, "utf8");
  const projectsDocId = extractDocId(savedProjects);
  const holidayDocId = extractDocId(savedHoliday);

  const buyIngredientsLine = extractLine(savedProjects, "Buy ingredients");
  const planMenuLine = extractLine(savedProjects, "Plan menu");
  fs.writeFileSync(
    stillPresentPath,
    savedProjects
      .replace(`${buyIngredientsLine}\n`, "")
      .replace(`${planMenuLine}\n`, "")
  );

  const holidayHeadingLine = extractLine(savedHoliday, "# Holiday Plans");
  const spainLine = extractLine(savedHoliday, "Spain");
  const franceLine = extractLine(savedHoliday, "France");
  const italyLine = extractLine(savedHoliday, "Italy");
  fs.rmSync(fullyLostPath);

  const error = await runSaveCommand(["--config", profilePath]).then(
    () => {
      throw new Error("expected save to reject");
    },
    (err: Error) => err
  );

  expect(error.message).toContain("Workspace loses existing node ids");
  expect(error.message).toContain(
    `${holidayDocId} — file no longer in workspace (fully lost):`
  );
  expect(error.message).toContain(
    `${projectsDocId} — file at notes/projects.md:`
  );
  expect(error.message).toContain(holidayHeadingLine);
  expect(error.message).toContain(spainLine);
  expect(error.message).toContain(franceLine);
  expect(error.message).toContain(italyLine);
  expect(error.message).toContain(buyIngredientsLine);
  expect(error.message).toContain(planMenuLine);
  expect(error.message).toContain("knowstr rm <id-or-path> [<id-or-path> ...]");
  expect(error.message).toContain(
    "file paths, doc ids, and node ids in a single"
  );

  const holidayIdx = error.message.indexOf(holidayHeadingLine);
  const spainIdx = error.message.indexOf(spainLine);
  const franceIdx = error.message.indexOf(franceLine);
  const italyIdx = error.message.indexOf(italyLine);
  expect(holidayIdx).toBeLessThan(spainIdx);
  expect(spainIdx).toBeLessThan(franceIdx);
  expect(franceIdx).toBeLessThan(italyIdx);

  const buyIdx = error.message.indexOf(buyIngredientsLine);
  const planIdx = error.message.indexOf(planMenuLine);
  expect(buyIdx).toBeLessThan(planIdx);
});

test("save allows explicit deletion via # Delete", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "doc.md");
  fs.writeFileSync(documentPath, "# Doc\n- keep\n- delete me\n");

  await runSaveCommand(["--config", profilePath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  const deletedLine = extractLine(saved, "delete me");
  fs.writeFileSync(
    documentPath,
    `${saved.replace(`${deletedLine}\n`, "")}\n# Delete\n${deletedLine}\n`
  );

  const result = await runSaveCommand(["--config", profilePath]);

  if ("help" in result) {
    throw new Error("unexpected help");
  }

  const rewritten = fs.readFileSync(documentPath, "utf8");
  expect(rewritten).not.toContain("delete me");
  expect(rewritten).not.toContain("# Delete");
  expect(result.updated_paths).toEqual([documentPath]);
});

test("save preserves heading levels", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "headings.md");
  fs.writeFileSync(
    documentPath,
    "# Project\n## Section\n### Subsection\n- bullet under sub\n"
  );

  const result = await runSaveCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }
  expect(result.changed_paths).toEqual([documentPath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  expect(saved).toContain("# Project <!-- id:");
  expect(saved).toContain("## Section <!-- id:");
  expect(saved).toContain("### Subsection <!-- id:");
  expect(saved).toContain("- bullet under sub <!-- id:");

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }
  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
});

test("save preserves ordered lists", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "recipe.md");
  fs.writeFileSync(documentPath, "# Recipe\n1. one\n2. two\n3. three\n");

  const result = await runSaveCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }
  expect(result.changed_paths).toEqual([documentPath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  expect(saved).toContain("1. one <!-- id:");
  expect(saved).toContain("2. two <!-- id:");
  expect(saved).toContain("3. three <!-- id:");

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }
  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
});

test("save preserves mixed structure with ordered items and nested bullets", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "mixed.md");
  fs.writeFileSync(
    documentPath,
    "# Project\n## Steps\n1. first\n   - nested a\n   - nested b\n2. second\n"
  );

  const result = await runSaveCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }
  expect(result.changed_paths).toEqual([documentPath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  expect(saved).toContain("# Project <!-- id:");
  expect(saved).toContain("## Steps <!-- id:");
  expect(saved).toContain("1. first <!-- id:");
  expect(saved).toContain("   - nested a <!-- id:");
  expect(saved).toContain("   - nested b <!-- id:");
  expect(saved).toContain("2. second <!-- id:");

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }
  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
});

test("save preserves siblings under multiple headings", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "siblings.md");
  fs.writeFileSync(
    documentPath,
    "# Project\n## Section A\n- one\n- two\n## Section B\n- three\n"
  );

  const result = await runSaveCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }
  expect(result.changed_paths).toEqual([documentPath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  expect(saved).toContain("## Section A <!-- id:");
  expect(saved).toContain("## Section B <!-- id:");
  expect(saved).toContain("- one <!-- id:");
  expect(saved).toContain("- two <!-- id:");
  expect(saved).toContain("- three <!-- id:");

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }
  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
});

test("save preserves headings, ordered lists, and bullets end-to-end", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "kitchen-sink.md");
  fs.writeFileSync(
    documentPath,
    [
      "# Project",
      "## Section",
      "### Subsection",
      "1. one",
      "2. two",
      "- bullet",
      "",
    ].join("\n")
  );

  const result = await runSaveCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }
  expect(result.changed_paths).toEqual([documentPath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  expect(saved).toContain("# Project <!-- id:");
  expect(saved).toContain("## Section <!-- id:");
  expect(saved).toContain("### Subsection <!-- id:");
  expect(saved).toContain("1. one <!-- id:");
  expect(saved).toContain("2. two <!-- id:");
  expect(saved).toContain("- bullet <!-- id:");

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }
  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
});

test("save skips .knowstr, .git, and node_modules and does not need nsec", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    nsec_file: "./.knowstr/missing.nsec",
    relays: [],
  });
  fs.mkdirSync(path.join(workspaceDir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, "node_modules", "pkg"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(workspaceDir, ".knowstr", "ignored"), {
    recursive: true,
  });
  fs.writeFileSync(path.join(workspaceDir, ".git", "ignored.md"), "# Ignore\n");
  fs.writeFileSync(
    path.join(workspaceDir, "node_modules", "pkg", "ignored.md"),
    "# Ignore\n"
  );
  fs.writeFileSync(
    path.join(workspaceDir, ".knowstr", "ignored", "ignored.md"),
    "# Ignore\n"
  );
  const documentPath = path.join(workspaceDir, "notes.md");
  fs.writeFileSync(documentPath, "# Real Doc\n- one\n");

  const result = await runSaveCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }

  expect(result.updated_paths).toEqual([documentPath]);
  expect(
    fs.readFileSync(path.join(workspaceDir, ".git", "ignored.md"), "utf8")
  ).toBe("# Ignore\n");
});
