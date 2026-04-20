/** @jest-environment node */

import fs from "fs";
import path from "path";
import {
  expectMarkdown,
  knowstrInit,
  knowstrSave,
  readNodeId,
  write,
} from "../testFixtures/workspace";

test("save assigns knowstr_doc_id and node ids in place", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "notes/nested/project.md",
    `
# Project
- alpha
- beta
`
  );

  const result = await knowstrSave(workspaceDir);
  expect(result.changed_paths).toEqual([
    path.join(workspaceDir, "notes/nested/project.md"),
  ]);

  expectMarkdown(
    workspaceDir,
    "notes/nested/project.md",
    `
# Project <!-- id:... -->

- alpha <!-- id:... -->
- beta <!-- id:... -->
`
  );

  const raw = fs.readFileSync(
    path.join(workspaceDir, "notes/nested/project.md"),
    "utf8"
  );
  expect(raw).toMatch(/^---\nknowstr_doc_id:\s.+\n/u);
});

test("save preserves existing frontmatter and only adds knowstr_doc_id", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "doc.md",
    `---
title: "Doc"
custom: yes
---

- one
`
  );

  await knowstrSave(workspaceDir);

  const raw = fs.readFileSync(path.join(workspaceDir, "doc.md"), "utf8");
  expect(raw).toContain('title: "Doc"');
  expect(raw).toContain("custom: yes");
  expect(raw).toContain("knowstr_doc_id:");
  expectMarkdown(
    workspaceDir,
    "doc.md",
    `
# Doc <!-- id:... -->

- one <!-- id:... -->
`
  );
});

test("save inserts blank line after frontmatter and is idempotent", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "doc.md",
    `---
title: "Doc"
---

- one
`
  );

  await knowstrSave(workspaceDir);
  const raw = fs.readFileSync(path.join(workspaceDir, "doc.md"), "utf8");
  expect(raw).toMatch(/\n---\n\n# /u);

  const second = await knowstrSave(workspaceDir);
  expect(second.changed_paths).toEqual([]);
});

test("save inserts blank lines around headings but not between siblings", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "blank-lines.md",
    `
# Project
## Section A
- item 1
- item 2
## Section B
1. step one
`
  );

  await knowstrSave(workspaceDir);

  expectMarkdown(
    workspaceDir,
    "blank-lines.md",
    `
# Project <!-- id:... -->

## Section A <!-- id:... -->

- item 1 <!-- id:... -->
- item 2 <!-- id:... -->

## Section B <!-- id:... -->

1. step one <!-- id:... -->
`
  );

  const second = await knowstrSave(workspaceDir);
  expect(second.changed_paths).toEqual([]);
});

test("save is a no-op when nothing changed", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(workspaceDir, "doc.md", "# Doc\n- one\n");

  await knowstrSave(workspaceDir);
  const second = await knowstrSave(workspaceDir);
  expect(second.changed_paths).toEqual([]);
});

test("save allows moving a node from one document to another", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(workspaceDir, "a.md", "# Alpha\n- keep here\n- move me\n");
  write(workspaceDir, "b.md", "# Beta\n- keep there\n");

  await knowstrSave(workspaceDir);

  const moveMeId = readNodeId(workspaceDir, "a.md", "- move me");
  const targetId = readNodeId(workspaceDir, "b.md", "- keep there");

  // Remove the `move me` line from a.md, and append it after `keep there` in b.md
  const aAfterFirst = fs.readFileSync(path.join(workspaceDir, "a.md"), "utf8");
  const moveLine = aAfterFirst
    .split("\n")
    .find((l) => l.includes("- move me")) as string;
  fs.writeFileSync(
    path.join(workspaceDir, "a.md"),
    aAfterFirst.replace(`${moveLine}\n`, "")
  );
  const bAfterFirst = fs.readFileSync(path.join(workspaceDir, "b.md"), "utf8");
  const targetLine = bAfterFirst
    .split("\n")
    .find((l) => l.includes("- keep there")) as string;
  fs.writeFileSync(
    path.join(workspaceDir, "b.md"),
    bAfterFirst.replace(`${targetLine}\n`, `${targetLine}\n${moveLine}\n`)
  );

  await knowstrSave(workspaceDir);

  expect(readNodeId(workspaceDir, "b.md", "- move me")).toBe(moveMeId);
  expect(readNodeId(workspaceDir, "b.md", "- keep there")).toBe(targetId);
  const aAfter = fs.readFileSync(path.join(workspaceDir, "a.md"), "utf8");
  expect(aAfter).not.toContain("move me");
});

test("save succeeds when a previously saved node id is removed", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(workspaceDir, "doc.md", "# Doc\n- keep\n- remove me\n");

  await knowstrSave(workspaceDir);

  const firstSave = fs.readFileSync(path.join(workspaceDir, "doc.md"), "utf8");
  const removeLine = firstSave
    .split("\n")
    .find((l) => l.includes("- remove me")) as string;
  fs.writeFileSync(
    path.join(workspaceDir, "doc.md"),
    firstSave.replace(`${removeLine}\n`, "")
  );

  await knowstrSave(workspaceDir);

  expectMarkdown(
    workspaceDir,
    "doc.md",
    `
# Doc <!-- id:... -->

- keep <!-- id:... -->
`
  );
});

test("save rejects duplicate node ids across documents", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(workspaceDir, "a.md", "# Alpha\n- item one\n");
  write(workspaceDir, "b.md", "# Beta\n- item two\n");

  await knowstrSave(workspaceDir);

  const itemOneLine = fs
    .readFileSync(path.join(workspaceDir, "a.md"), "utf8")
    .split("\n")
    .find((l) => l.includes("- item one")) as string;

  fs.appendFileSync(path.join(workspaceDir, "b.md"), `${itemOneLine}\n`);

  await expect(knowstrSave(workspaceDir)).rejects.toMatchObject({
    message: expect.stringContaining("Workspace contains duplicate node ids"),
  });
});

test("save preserves heading levels", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "headings.md",
    `
# Project
## Section
### Subsection
- bullet under sub
`
  );

  await knowstrSave(workspaceDir);
  expectMarkdown(
    workspaceDir,
    "headings.md",
    `
# Project <!-- id:... -->

## Section <!-- id:... -->

### Subsection <!-- id:... -->

- bullet under sub <!-- id:... -->
`
  );
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save preserves ordered lists", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(workspaceDir, "recipe.md", "# Recipe\n1. one\n2. two\n3. three\n");

  await knowstrSave(workspaceDir);
  expectMarkdown(
    workspaceDir,
    "recipe.md",
    `
# Recipe <!-- id:... -->

1. one <!-- id:... -->
2. two <!-- id:... -->
3. three <!-- id:... -->
`
  );
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save preserves mixed structure with ordered items and nested bullets", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "mixed.md",
    `
# Project
## Steps
1. first
   - nested a
   - nested b
2. second
`
  );

  await knowstrSave(workspaceDir);
  expectMarkdown(
    workspaceDir,
    "mixed.md",
    `
# Project <!-- id:... -->

## Steps <!-- id:... -->

1. first <!-- id:... -->
   - nested a <!-- id:... -->
   - nested b <!-- id:... -->
2. second <!-- id:... -->
`
  );
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save preserves siblings under multiple headings", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "siblings.md",
    `
# Project
## Section A
- one
- two
## Section B
- three
`
  );

  await knowstrSave(workspaceDir);
  expectMarkdown(
    workspaceDir,
    "siblings.md",
    `
# Project <!-- id:... -->

## Section A <!-- id:... -->

- one <!-- id:... -->
- two <!-- id:... -->

## Section B <!-- id:... -->

- three <!-- id:... -->
`
  );
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save preserves ordered list numbers when preceded by bullet siblings", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "mixed-siblings.md",
    `
# Topic
- intro bullet
37. first ordered
38. second ordered
39. third ordered
`
  );

  await knowstrSave(workspaceDir);
  expectMarkdown(
    workspaceDir,
    "mixed-siblings.md",
    `
# Topic <!-- id:... -->

- intro bullet <!-- id:... -->
37. first ordered <!-- id:... -->
38. second ordered <!-- id:... -->
39. third ordered <!-- id:... -->
`
  );
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save preserves inline code in bullet items", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "inline-code.md",
    `
# Project
- run \`knowstr save\` after editing
- nothing fancy here
`
  );

  await knowstrSave(workspaceDir);
  expectMarkdown(
    workspaceDir,
    "inline-code.md",
    `
# Project <!-- id:... -->

- run \`knowstr save\` after editing <!-- id:... -->
- nothing fancy here <!-- id:... -->
`
  );
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save preserves inline code in headings", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "heading-code.md",
    `
# Using \`knowstr\`
## The \`save\` command
- sub
`
  );

  await knowstrSave(workspaceDir);
  expectMarkdown(
    workspaceDir,
    "heading-code.md",
    `
# Using \`knowstr\` <!-- id:... -->

## The \`save\` command <!-- id:... -->

- sub <!-- id:... -->
`
  );
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save preserves backtick-wrapped link markdown literally", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "backtick-link.md",
    "# Project\n- to demo use `[Title](#abc)` syntax\n"
  );

  await knowstrSave(workspaceDir);
  expectMarkdown(
    workspaceDir,
    "backtick-link.md",
    `
# Project <!-- id:... -->

- to demo use \`[Title](#abc)\` syntax <!-- id:... -->
`
  );
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save preserves inline code combined with prefix markers", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "prefix-code.md",
    "# Project\n- (!) see `foo.ts`\n- (?) maybe `bar`\n"
  );

  await knowstrSave(workspaceDir);
  expectMarkdown(
    workspaceDir,
    "prefix-code.md",
    `
# Project <!-- id:... -->

- (!) see \`foo.ts\` <!-- id:... -->
- (?) maybe \`bar\` <!-- id:... -->
`
  );
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save round-trips combined prefix markers like (-!) and (-~)", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "combined-markers.md",
    `
# Project
- (-!) contra relevant
- (-~) contra little
- (+!) confirms relevant
`
  );

  await knowstrSave(workspaceDir);
  expectMarkdown(
    workspaceDir,
    "combined-markers.md",
    `
# Project <!-- id:... -->

- (-!) contra relevant <!-- id:... -->
- (-~) contra little <!-- id:... -->
- (+!) confirms relevant <!-- id:... -->
`
  );
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save preserves bold and italic emphasis", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "emphasis.md",
    "# Project\n- this is **bold** and *italic*\n"
  );

  await knowstrSave(workspaceDir);
  expectMarkdown(
    workspaceDir,
    "emphasis.md",
    `
# Project <!-- id:... -->

- this is **bold** and *italic* <!-- id:... -->
`
  );
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save preserves non-ref external link markdown literally", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "external-link.md",
    "# Project\n- see [docs](https://example.com) for details\n"
  );

  await knowstrSave(workspaceDir);
  expectMarkdown(
    workspaceDir,
    "external-link.md",
    `
# Project <!-- id:... -->

- see [docs](https://example.com) for details <!-- id:... -->
`
  );
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save still treats whole-line ref-style link as ref node", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(workspaceDir, "ref-node.md", "# Project\n- target\n");

  await knowstrSave(workspaceDir);
  const targetId = readNodeId(workspaceDir, "ref-node.md", "- target");

  const firstSave = fs.readFileSync(
    path.join(workspaceDir, "ref-node.md"),
    "utf8"
  );
  const targetLine = firstSave
    .split("\n")
    .find((l) => l.includes("- target <!-- id:")) as string;
  fs.writeFileSync(
    path.join(workspaceDir, "ref-node.md"),
    firstSave.replace(
      `${targetLine}\n`,
      `${targetLine}\n- [Linked](#${targetId})\n`
    )
  );

  await knowstrSave(workspaceDir);

  const second = fs.readFileSync(
    path.join(workspaceDir, "ref-node.md"),
    "utf8"
  );
  const linkedLine = second
    .split("\n")
    .find((l) => l.includes(`- [Linked](#${targetId})`)) as string;
  expect(linkedLine).toBe(`- [Linked](#${targetId})`);
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save still treats prefixed whole-line ref-style link as ref node", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(workspaceDir, "prefixed-ref-node.md", "# Project\n- target\n");

  await knowstrSave(workspaceDir);
  const targetId = readNodeId(workspaceDir, "prefixed-ref-node.md", "- target");

  const firstSave = fs.readFileSync(
    path.join(workspaceDir, "prefixed-ref-node.md"),
    "utf8"
  );
  const targetLine = firstSave
    .split("\n")
    .find((l) => l.includes("- target <!-- id:")) as string;
  fs.writeFileSync(
    path.join(workspaceDir, "prefixed-ref-node.md"),
    firstSave.replace(
      `${targetLine}\n`,
      `${targetLine}\n- (!) [Linked](#${targetId})\n`
    )
  );

  await knowstrSave(workspaceDir);

  const second = fs.readFileSync(
    path.join(workspaceDir, "prefixed-ref-node.md"),
    "utf8"
  );
  const linkedLine = second
    .split("\n")
    .find((l) => l.includes(`- (!) [Linked](#${targetId})`)) as string;
  expect(linkedLine).toBe(`- (!) [Linked](#${targetId})`);
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save treats ref-style link with bracketed text as ref node", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(workspaceDir, "bracketed-ref.md", "# Project\n- target\n");

  await knowstrSave(workspaceDir);
  const targetId = readNodeId(workspaceDir, "bracketed-ref.md", "- target");

  const firstSave = fs.readFileSync(
    path.join(workspaceDir, "bracketed-ref.md"),
    "utf8"
  );
  const targetLine = firstSave
    .split("\n")
    .find((l) => l.includes("- target <!-- id:")) as string;
  const linkedText = `Kant […] took the argument (p. 43)`;
  fs.writeFileSync(
    path.join(workspaceDir, "bracketed-ref.md"),
    firstSave.replace(
      `${targetLine}\n`,
      `${targetLine}\n- [${linkedText}](#${targetId})\n`
    )
  );

  await knowstrSave(workspaceDir);

  const second = fs.readFileSync(
    path.join(workspaceDir, "bracketed-ref.md"),
    "utf8"
  );
  const linkedLine = second
    .split("\n")
    .find((l) => l.includes(`- [${linkedText}](#${targetId})`)) as string;
  expect(linkedLine).toBe(`- [${linkedText}](#${targetId})`);
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save kitchen-sink idempotency for inline formatting", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "inline-kitchen-sink.md",
    `
# Using \`knowstr\`
## The \`save\` command
1. run \`knowstr save\` then **verify**
2. check *output* carefully
- (!) see \`foo.ts\` for details
`
  );

  await knowstrSave(workspaceDir);
  expectMarkdown(
    workspaceDir,
    "inline-kitchen-sink.md",
    `
# Using \`knowstr\` <!-- id:... -->

## The \`save\` command <!-- id:... -->

1. run \`knowstr save\` then **verify** <!-- id:... -->
2. check *output* carefully <!-- id:... -->
- (!) see \`foo.ts\` for details <!-- id:... -->
`
  );
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save ignores .git, node_modules, and .knowstr directories", async () => {
  const { path: workspaceDir } = knowstrInit();
  fs.mkdirSync(path.join(workspaceDir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, ".git", "ignored.md"), "# Ignore\n");
  write(workspaceDir, "node_modules/pkg/ignored.md", "# Ignore\n");
  write(workspaceDir, ".knowstr/ignored/ignored.md", "# Ignore\n");
  write(workspaceDir, "notes.md", "# Real Doc\n- one\n");

  const result = await knowstrSave(workspaceDir);
  expect(result.changed_paths).toEqual([path.join(workspaceDir, "notes.md")]);
  expect(
    fs.readFileSync(path.join(workspaceDir, ".git", "ignored.md"), "utf8")
  ).toBe("# Ignore\n");
});

test("save writes editing instructions into the frontmatter", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(workspaceDir, "notes.md", "# Notes\n- one\n");

  await knowstrSave(workspaceDir);

  const raw = fs.readFileSync(path.join(workspaceDir, "notes.md"), "utf8");
  expect(raw).toContain("editing: |");
  expect(raw).toContain(
    "Edit text freely. Never modify <!-- id:... --> comments."
  );
  expect(raw).toContain("Save changes with: knowstr save");
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save refreshes a stale editing block next to existing user frontmatter", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "doc.md",
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

  await knowstrSave(workspaceDir);

  const raw = fs.readFileSync(path.join(workspaceDir, "doc.md"), "utf8");
  expect(raw).toContain('title: "Doc"');
  expect(raw).toContain("custom: yes");
  expect(raw).not.toContain("stale instructions");
  expect(raw).not.toContain("second stale line");
  expect(raw).toContain("Save changes with: knowstr save");
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save preserves HTML-comment-looking content inside inline code spans", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "comment-in-code.md",
    "# Project\n- Every node has a UUID stored as an HTML comment: `<!-- id:uuid -->`.\n"
  );

  await knowstrSave(workspaceDir);
  expectMarkdown(
    workspaceDir,
    "comment-in-code.md",
    `
# Project <!-- id:... -->

- Every node has a UUID stored as an HTML comment: \`<!-- id:uuid -->\`. <!-- id:... -->
`
  );
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save preserves two inline code spans that look like HTML id comments", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "two-code-comments.md",
    "# Project\n- Two code spans: `<!-- id:xxxx -->` and `<!-- id:yyyy -->` both inside.\n"
  );

  await knowstrSave(workspaceDir);
  expectMarkdown(
    workspaceDir,
    "two-code-comments.md",
    `
# Project <!-- id:... -->

- Two code spans: \`<!-- id:xxxx -->\` and \`<!-- id:yyyy -->\` both inside. <!-- id:... -->
`
  );
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save preserves a trailing inline code span with comment-like content", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "trailing-code-comment.md",
    "# Project\n- Trailing code span with comment-like content: ending in `<!-- id:qqqq -->`\n"
  );

  await knowstrSave(workspaceDir);
  expectMarkdown(
    workspaceDir,
    "trailing-code-comment.md",
    `
# Project <!-- id:... -->

- Trailing code span with comment-like content: ending in \`<!-- id:qqqq -->\` <!-- id:... -->
`
  );
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});

test("save ignores the top-level inbox folder", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "inbox/foreign.md",
    "# Foreign\n- should stay untouched\n"
  );
  write(workspaceDir, "public.md", "# Public\n- visible\n");

  const result = await knowstrSave(workspaceDir);
  expect(result.changed_paths).toEqual([path.join(workspaceDir, "public.md")]);
  expect(
    fs.readFileSync(path.join(workspaceDir, "inbox", "foreign.md"), "utf8")
  ).toBe("# Foreign\n- should stay untouched\n");
});

test(".knowstrignore ignores a directory", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(workspaceDir, "drafts/secret.md", "# Secret\n- hidden\n");
  write(workspaceDir, "public.md", "# Public\n- visible\n");
  write(workspaceDir, ".knowstrignore", "drafts/\n");

  const result = await knowstrSave(workspaceDir);
  expect(result.changed_paths).toEqual([path.join(workspaceDir, "public.md")]);
  expect(
    fs.readFileSync(path.join(workspaceDir, "drafts", "secret.md"), "utf8")
  ).toBe("# Secret\n- hidden\n");
});

test(".knowstrignore ignores a specific file", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(workspaceDir, "secret.md", "# Secret\n- hidden\n");
  write(workspaceDir, "public.md", "# Public\n- visible\n");
  write(workspaceDir, ".knowstrignore", "secret.md\n");

  const result = await knowstrSave(workspaceDir);
  expect(result.changed_paths).toEqual([path.join(workspaceDir, "public.md")]);
  expect(fs.readFileSync(path.join(workspaceDir, "secret.md"), "utf8")).toBe(
    "# Secret\n- hidden\n"
  );
});

test(".knowstrignore supports glob patterns", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(workspaceDir, "temp-notes.md", "# Temp\n- scratch\n");
  write(workspaceDir, "real-notes.md", "# Real\n- keep\n");
  write(workspaceDir, ".knowstrignore", "temp-*\n");

  const result = await knowstrSave(workspaceDir);
  expect(result.changed_paths).toEqual([
    path.join(workspaceDir, "real-notes.md"),
  ]);
  expect(
    fs.readFileSync(path.join(workspaceDir, "temp-notes.md"), "utf8")
  ).toBe("# Temp\n- scratch\n");
});

test(".knowstrignore handles comments and blank lines", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(workspaceDir, "secret.md", "# Secret\n- hidden\n");
  write(workspaceDir, "public.md", "# Public\n- visible\n");
  write(
    workspaceDir,
    ".knowstrignore",
    "# This is a comment\n\nsecret.md\n\n# Another comment\n"
  );

  const result = await knowstrSave(workspaceDir);
  expect(result.changed_paths).toEqual([path.join(workspaceDir, "public.md")]);
});

test("save survives an inline code span whose content equals the line's id comment", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "code-id-collision.md",
    "# Project\n- collision line `<!-- id:placeholder -->` end\n"
  );

  await knowstrSave(workspaceDir);

  const firstSave = fs.readFileSync(
    path.join(workspaceDir, "code-id-collision.md"),
    "utf8"
  );
  const collisionLine = firstSave
    .split("\n")
    .find((l) => l.includes("- collision line")) as string;
  const idMatch = collisionLine.match(/<!-- id:(\S+) -->\s*$/u);
  if (!idMatch?.[1]) {
    throw new Error("missing assigned id");
  }
  const assignedId = idMatch[1];

  const collidingLine = `- collision line \`<!-- id:${assignedId} -->\` end <!-- id:${assignedId} -->`;
  fs.writeFileSync(
    path.join(workspaceDir, "code-id-collision.md"),
    firstSave.replace(collisionLine, collidingLine)
  );

  await knowstrSave(workspaceDir);

  const afterSecond = fs.readFileSync(
    path.join(workspaceDir, "code-id-collision.md"),
    "utf8"
  );
  const count = afterSecond
    .split("\n")
    .filter((l) => l === collidingLine).length;
  expect(count).toBe(1);
  expect((await knowstrSave(workspaceDir)).changed_paths).toEqual([]);
});
