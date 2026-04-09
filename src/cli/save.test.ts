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
  expect(savedContent).toMatch(/^---\nknowstr_doc_id:\s.+\n/);
  expect(savedContent).toMatch(/\n---\n\n# Project /);
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

test("save inserts blank line after frontmatter and is idempotent", async () => {
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
---

- one
`
  );

  await runSaveCommand(["--config", profilePath]);

  const savedContent = fs.readFileSync(documentPath, "utf8");
  expect(savedContent).toMatch(/\n---\n\n# /);

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }
  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
});

test("save inserts blank lines around headings but not between siblings", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "blank-lines.md");
  fs.writeFileSync(
    documentPath,
    "# Project\n## Section A\n- item 1\n- item 2\n## Section B\n1. step one\n"
  );

  await runSaveCommand(["--config", profilePath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  const lines = saved.split("\n");

  const findIndex = (needle: string): number => {
    const index = lines.findIndex((line) => line.includes(needle));
    if (index === -1) {
      throw new Error(`missing line containing ${needle}`);
    }
    return index;
  };

  const sectionAIndex = findIndex("## Section A");
  const item1Index = findIndex("- item 1 <!-- id:");
  const item2Index = findIndex("- item 2 <!-- id:");
  const sectionBIndex = findIndex("## Section B");
  const stepOneIndex = findIndex("1. step one <!-- id:");

  expect(lines[sectionAIndex - 1]).toBe("");
  expect(lines[item1Index - 1]).toBe("");
  expect(lines[sectionBIndex - 1]).toBe("");
  expect(lines[stepOneIndex - 1]).toBe("");
  expect(item2Index).toBe(item1Index + 1);

  lines.forEach((line, index) => {
    if (index === 0) return;
    expect(line === "" && lines[index - 1] === "").toBe(false);
  });

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }
  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
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

test("save succeeds when a previously saved node id is removed", async () => {
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

  const result = await runSaveCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }
  expect(result.updated_paths).toEqual([documentPath]);
  const rewritten = fs.readFileSync(documentPath, "utf8");
  expect(rewritten).not.toContain("remove me");
  expect(rewritten).toContain("- keep <!-- id:");
});

test("save rejects duplicate node ids across documents", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const docAPath = path.join(workspaceDir, "a.md");
  const docBPath = path.join(workspaceDir, "b.md");
  fs.writeFileSync(docAPath, "# Alpha\n- item one\n");
  fs.writeFileSync(docBPath, "# Beta\n- item two\n");

  await runSaveCommand(["--config", profilePath]);

  const docA = fs.readFileSync(docAPath, "utf8");
  const docB = fs.readFileSync(docBPath, "utf8");
  const itemOneLine = extractLine(docA, "item one");

  fs.writeFileSync(docBPath, `${docB}${itemOneLine}\n`);

  await expect(runSaveCommand(["--config", profilePath])).rejects.toMatchObject(
    {
      message: expect.stringContaining("Workspace contains duplicate node ids"),
    }
  );
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

test("save preserves inline code in bullet items", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "inline-code.md");
  fs.writeFileSync(
    documentPath,
    "# Project\n- run `knowstr save` after editing\n- nothing fancy here\n"
  );

  const result = await runSaveCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }
  expect(result.changed_paths).toEqual([documentPath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  expect(saved).toContain("- run `knowstr save` after editing <!-- id:");
  expect(saved).toContain("- nothing fancy here <!-- id:");

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }
  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
});

test("save preserves inline code in headings", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "heading-code.md");
  fs.writeFileSync(
    documentPath,
    "# Using `knowstr`\n## The `save` command\n- sub\n"
  );

  const result = await runSaveCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }
  expect(result.changed_paths).toEqual([documentPath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  expect(saved).toContain("# Using `knowstr` <!-- id:");
  expect(saved).toContain("## The `save` command <!-- id:");

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }
  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
});

test("save preserves backtick-wrapped link markdown literally", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "backtick-link.md");
  fs.writeFileSync(
    documentPath,
    "# Project\n- to demo use `[Title](#abc)` syntax\n"
  );

  const result = await runSaveCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }
  expect(result.changed_paths).toEqual([documentPath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  expect(saved).toContain("- to demo use `[Title](#abc)` syntax <!-- id:");

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }
  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
});

test("save preserves inline code combined with prefix markers", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "prefix-code.md");
  fs.writeFileSync(
    documentPath,
    "# Project\n- (!) see `foo.ts`\n- (?) maybe `bar`\n"
  );

  const result = await runSaveCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }
  expect(result.changed_paths).toEqual([documentPath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  expect(saved).toContain("- (!) see `foo.ts` <!-- id:");
  expect(saved).toContain("- (?) maybe `bar` <!-- id:");

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }
  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
});

test("save preserves bold and italic emphasis", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "emphasis.md");
  fs.writeFileSync(
    documentPath,
    "# Project\n- this is **bold** and *italic*\n"
  );

  const result = await runSaveCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }
  expect(result.changed_paths).toEqual([documentPath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  expect(saved).toContain("- this is **bold** and *italic* <!-- id:");

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }
  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
});

test("save preserves non-ref external link markdown literally", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "external-link.md");
  fs.writeFileSync(
    documentPath,
    "# Project\n- see [docs](https://example.com) for details\n"
  );

  const result = await runSaveCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }
  expect(result.changed_paths).toEqual([documentPath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  expect(saved).toContain(
    "- see [docs](https://example.com) for details <!-- id:"
  );

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }
  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
});

test("save still treats whole-line ref-style link as ref node", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "ref-node.md");
  fs.writeFileSync(documentPath, "# Project\n- target\n");

  await runSaveCommand(["--config", profilePath]);

  const firstSave = fs.readFileSync(documentPath, "utf8");
  const targetLine = extractLine(firstSave, "- target <!-- id:");
  const idMatch = targetLine.match(/id:(\S+)/);
  if (!idMatch?.[1]) {
    throw new Error("missing target id");
  }
  const targetId = idMatch[1];

  fs.writeFileSync(
    documentPath,
    firstSave.replace(
      `${targetLine}\n`,
      `${targetLine}\n- [Linked](#${targetId})\n`
    )
  );

  const secondResult = await runSaveCommand(["--config", profilePath]);
  if ("help" in secondResult) {
    throw new Error("unexpected help");
  }

  const secondSave = fs.readFileSync(documentPath, "utf8");
  expect(secondSave).toContain(`- [Linked](#${targetId})`);
  const linkedLine = extractLine(secondSave, `- [Linked](#${targetId})`);
  expect(linkedLine).toBe(`- [Linked](#${targetId})`);

  const third = await runSaveCommand(["--config", profilePath]);
  if ("help" in third) {
    throw new Error("unexpected help");
  }
  expect(third.changed_paths).toEqual([]);
  expect(third.updated_paths).toEqual([]);
});

test("save still treats prefixed whole-line ref-style link as ref node", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "prefixed-ref-node.md");
  fs.writeFileSync(documentPath, "# Project\n- target\n");

  await runSaveCommand(["--config", profilePath]);

  const firstSave = fs.readFileSync(documentPath, "utf8");
  const targetLine = extractLine(firstSave, "- target <!-- id:");
  const idMatch = targetLine.match(/id:(\S+)/);
  if (!idMatch?.[1]) {
    throw new Error("missing target id");
  }
  const targetId = idMatch[1];

  fs.writeFileSync(
    documentPath,
    firstSave.replace(
      `${targetLine}\n`,
      `${targetLine}\n- (!) [Linked](#${targetId})\n`
    )
  );

  const secondResult = await runSaveCommand(["--config", profilePath]);
  if ("help" in secondResult) {
    throw new Error("unexpected help");
  }

  const secondSave = fs.readFileSync(documentPath, "utf8");
  expect(secondSave).toContain(`- (!) [Linked](#${targetId})`);
  const linkedLine = extractLine(secondSave, `- (!) [Linked](#${targetId})`);
  expect(linkedLine).toBe(`- (!) [Linked](#${targetId})`);

  const third = await runSaveCommand(["--config", profilePath]);
  if ("help" in third) {
    throw new Error("unexpected help");
  }
  expect(third.changed_paths).toEqual([]);
  expect(third.updated_paths).toEqual([]);
});

test("save kitchen-sink idempotency for inline formatting", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "inline-kitchen-sink.md");
  fs.writeFileSync(
    documentPath,
    [
      "# Using `knowstr`",
      "## The `save` command",
      "1. run `knowstr save` then **verify**",
      "2. check *output* carefully",
      "- (!) see `foo.ts` for details",
      "",
    ].join("\n")
  );

  const result = await runSaveCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }
  expect(result.changed_paths).toEqual([documentPath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  expect(saved).toContain("# Using `knowstr` <!-- id:");
  expect(saved).toContain("## The `save` command <!-- id:");
  expect(saved).toContain("1. run `knowstr save` then **verify** <!-- id:");
  expect(saved).toContain("2. check *output* carefully <!-- id:");
  expect(saved).toContain("- (!) see `foo.ts` for details <!-- id:");

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }
  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
});

test("save kitchen-sink blank-line layout around headings and chains", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "blank-kitchen-sink.md");
  fs.writeFileSync(
    documentPath,
    [
      "# Project",
      "## Overview",
      "- intro bullet",
      "- another intro",
      "## Steps",
      "### Prep",
      "1. prep one",
      "2. prep two",
      "## Followups",
      "### Notes",
      "- note one",
      "",
    ].join("\n")
  );

  await runSaveCommand(["--config", profilePath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  const lines = saved.split("\n");

  const findIndex = (needle: string): number => {
    const index = lines.findIndex((line) => line.includes(needle));
    if (index === -1) {
      throw new Error(`missing line containing ${needle}`);
    }
    return index;
  };

  const headingNeedles = [
    "# Project",
    "## Overview",
    "## Steps",
    "### Prep",
    "## Followups",
    "### Notes",
  ];
  const headingIndices = headingNeedles.map(findIndex);
  headingIndices.forEach((index, position) => {
    if (position === 0) {
      return;
    }
    expect(lines[index - 1]).toBe("");
  });
  headingIndices.forEach((index) => {
    if (index + 1 >= lines.length) {
      return;
    }
    const nextLine = lines[index + 1];
    expect(nextLine === "").toBe(true);
  });

  const overviewIndex = findIndex("## Overview");
  const stepsIndex = findIndex("## Steps");
  const prepIndex = findIndex("### Prep");
  const adjacentHeadingPairs: [number, number][] = [
    [stepsIndex, prepIndex],
    [findIndex("## Followups"), findIndex("### Notes")],
  ];
  adjacentHeadingPairs.forEach(([first, second]) => {
    expect(second - first).toBe(2);
    expect(lines[first + 1]).toBe("");
  });

  const introIndex = findIndex("- intro bullet <!-- id:");
  const anotherIntroIndex = findIndex("- another intro <!-- id:");
  expect(anotherIntroIndex).toBe(introIndex + 1);
  expect(introIndex - 1).toBe(overviewIndex + 1);

  lines.forEach((line, index) => {
    if (index === 0) return;
    expect(line === "" && lines[index - 1] === "").toBe(false);
  });

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

test("save writes editing instructions with markers and save command hint into frontmatter", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "notes.md");
  fs.writeFileSync(documentPath, "# Notes\n- one\n");

  await runSaveCommand(["--config", profilePath]);

  const savedContent = fs.readFileSync(documentPath, "utf8");
  expect(savedContent).toContain("editing: |");
  expect(savedContent).toContain(
    "Edit text freely. Never modify <!-- id:... --> comments."
  );
  expect(savedContent).toContain(
    "Never add <!-- id:... --> to new items. knowstr save will reject invented IDs."
  );
  expect(savedContent).toContain(
    "Markers: (!) relevant (?) maybe relevant (~) little relevant (x) not relevant (+) confirms (-) contra"
  );
  expect(savedContent).toContain("Save changes with: knowstr save");

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }
  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
});

test("save refreshes a stale editing block next to existing user frontmatter", async () => {
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
editing: |
  stale instructions that should be overwritten
  second stale line
custom: yes
---

# Doc
- one
`
  );

  await runSaveCommand(["--config", profilePath]);

  const savedContent = fs.readFileSync(documentPath, "utf8");
  expect(savedContent).toContain('title: "Doc"');
  expect(savedContent).toContain("custom: yes");
  expect(savedContent).toContain("knowstr_doc_id:");
  expect(savedContent).not.toContain("stale instructions");
  expect(savedContent).not.toContain("second stale line");
  expect(savedContent).toContain("Save changes with: knowstr save");
  expect(savedContent).toContain("Markers: (!) relevant (?) maybe relevant");

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }
  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
});

test("save preserves an HTML id-comment placeholder inside an inline code span", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "comment-in-code.md");
  fs.writeFileSync(
    documentPath,
    "# Project\n- Every node has a UUID stored as an HTML comment: `<!-- id:uuid -->`.\n"
  );

  const result = await runSaveCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }
  expect(result.changed_paths).toEqual([documentPath]);

  const saved = fs.readFileSync(documentPath, "utf8");
  expect(saved).toContain(
    "- Every node has a UUID stored as an HTML comment: `<!-- id:uuid -->`. <!-- id:"
  );

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }
  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
});

test("save preserves two inline code spans that look like HTML id comments", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "two-code-comments.md");
  fs.writeFileSync(
    documentPath,
    "# Project\n- Two code spans: `<!-- id:xxxx -->` and `<!-- id:yyyy -->` both inside.\n"
  );

  const result = await runSaveCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }

  const saved = fs.readFileSync(documentPath, "utf8");
  expect(saved).toContain(
    "- Two code spans: `<!-- id:xxxx -->` and `<!-- id:yyyy -->` both inside. <!-- id:"
  );

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }
  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
});

test("save preserves a trailing inline code span with comment-like content", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "trailing-code-comment.md");
  fs.writeFileSync(
    documentPath,
    "# Project\n- Trailing code span with comment-like content: ending in `<!-- id:qqqq -->`\n"
  );

  const result = await runSaveCommand(["--config", profilePath]);
  if ("help" in result) {
    throw new Error("unexpected help");
  }

  const saved = fs.readFileSync(documentPath, "utf8");
  expect(saved).toContain(
    "- Trailing code span with comment-like content: ending in `<!-- id:qqqq -->` <!-- id:"
  );

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }
  expect(second.changed_paths).toEqual([]);
  expect(second.updated_paths).toEqual([]);
});

test("save survives an inline code span whose content equals the line's id comment", async () => {
  const workspaceDir = makeTempDir();
  const profilePath = writeProfile(workspaceDir, {
    pubkey: "a".repeat(64),
    workspace_dir: ".",
    relays: [],
  });
  const documentPath = path.join(workspaceDir, "code-id-collision.md");
  fs.writeFileSync(
    documentPath,
    "# Project\n- collision line `<!-- id:placeholder -->` end\n"
  );

  await runSaveCommand(["--config", profilePath]);

  const firstSave = fs.readFileSync(documentPath, "utf8");
  const collisionLine = extractLine(firstSave, "- collision line");
  const idMatch = collisionLine.match(/<!-- id:(\S+) -->\s*$/);
  if (!idMatch?.[1]) {
    throw new Error("missing assigned id");
  }
  const assignedId = idMatch[1];

  const collidingLine = `- collision line \`<!-- id:${assignedId} -->\` end <!-- id:${assignedId} -->`;
  fs.writeFileSync(
    documentPath,
    firstSave.replace(collisionLine, collidingLine)
  );

  const second = await runSaveCommand(["--config", profilePath]);
  if ("help" in second) {
    throw new Error("unexpected help");
  }

  const afterSecond = fs.readFileSync(documentPath, "utf8");
  expect(afterSecond).toContain(collidingLine);
  expect(afterSecond).not.toContain("collision line `` end");
  const collidingLineCount = afterSecond
    .split("\n")
    .filter((line) => line === collidingLine).length;
  expect(collidingLineCount).toBe(1);

  const third = await runSaveCommand(["--config", profilePath]);
  if ("help" in third) {
    throw new Error("unexpected help");
  }
  expect(third.changed_paths).toEqual([]);
  expect(third.updated_paths).toEqual([]);
});
