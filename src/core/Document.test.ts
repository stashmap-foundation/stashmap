import { Map } from "immutable";
import { parseToDocument } from "./Document";
import { pathOf } from "./nodeRef";
import { renderDocumentMarkdown } from "../documentRenderer";

const TEST_PUBKEY = "a".repeat(64) as PublicKey;

test("parseToDocument names the document and every top-level root by its path", () => {
  const { document } = parseToDocument(TEST_PUBKEY, "# First\n\n# Second\n", {
    path: "notes/doc-1.md",
  });

  expect(document.docId).toBe("notes/doc-1.md");
  expect(document.topNodeShortIds.map(pathOf)).toEqual([
    "notes/doc-1.md",
    "notes/doc-1.md",
  ]);
});

test("parseToDocument extracts title from frontmatter", () => {
  const markdown = `---\ntitle: "Holiday Destinations"\n---\n# Spain\n`;
  const { document } = parseToDocument(TEST_PUBKEY, markdown, {
    path: "doc.md",
  });
  expect(document.title).toBe("Holiday Destinations");
});

test("parseToDocument frontmatter title beats fallbackTitle", () => {
  const markdown = `---\ntitle: "Frontmatter Wins"\n---\n# Body Heading\n`;
  const { document } = parseToDocument(TEST_PUBKEY, markdown, {
    path: "doc.md",
    fallbackTitle: "Fallback Loses",
  });
  expect(document.title).toBe("Frontmatter Wins");
});

test("parseToDocument falls back to fallbackTitle when no frontmatter title", () => {
  const markdown = "# Body Heading\n- alpha\n";
  const { document } = parseToDocument(TEST_PUBKEY, markdown, {
    path: "notes/projects.md",
    fallbackTitle: "projects",
  });
  expect(document.title).toBe("projects");
});

test("legacy publish state is ignored and omitted on render", () => {
  const markdown = [
    "---",
    "title: Notes",
    "knowstr_publish:",
    "  paused: true",
    "---",
    "# Notes <!-- id:notes -->",
    "",
  ].join("\n");
  const { document, nodes } = parseToDocument(TEST_PUBKEY, markdown, {
    path: "doc.md",
  });

  expect(document.frontMatter).not.toHaveProperty("knowstr_publish");
  const knowledgeDBs = Map<SourceId, KnowledgeData>([[TEST_PUBKEY, { nodes }]]);
  expect(renderDocumentMarkdown(knowledgeDBs, document)).not.toContain(
    "knowstr_publish"
  );
});

test("parseToDocument falls back to first top-level node text", () => {
  const markdown = "# Holiday Destinations\n- Spain\n";
  const { document } = parseToDocument(TEST_PUBKEY, markdown, {
    path: "doc.md",
  });
  expect(document.title).toBe("Holiday Destinations");
});

test("parseToDocument falls back to 'Untitled' when nothing else is available", () => {
  const { document } = parseToDocument(TEST_PUBKEY, "", { path: "doc.md" });
  expect(document.title).toBe("Untitled");
});

test("legacy basedOn and snapshot attributes survive as generic attributes", () => {
  const rootSnapshot = `snap_sha256_${"1".repeat(64)}`;
  const childSnapshot = `snap_sha256_${"2".repeat(64)}`;
  const markdown = [
    `# Houses <!-- id:u1 basedOn="a1" snapshot="${rootSnapshot}" -->`,
    "",
    `- Brick house <!-- id:u2 basedOn="a2" snapshot="${childSnapshot}" -->`,
    "",
  ].join("\n");

  const { document, nodes } = parseToDocument(TEST_PUBKEY, markdown, {
    path: "doc.md",
  });

  expect(nodes.get("doc.md#u1")?.extraAttrs).toEqual({
    basedOn: "a1",
    snapshot: rootSnapshot,
  });
  expect(nodes.get("doc.md#u2")?.extraAttrs).toEqual({
    basedOn: "a2",
    snapshot: childSnapshot,
  });

  const knowledgeDBs = Map<SourceId, KnowledgeData>([[TEST_PUBKEY, { nodes }]]);
  expect(renderDocumentMarkdown(knowledgeDBs, document)).toContain(
    `snapshot="${rootSnapshot}"`
  );
  expect(renderDocumentMarkdown(knowledgeDBs, document)).toContain(
    `snapshot="${childSnapshot}"`
  );
});

test("parseToDocument preserves arbitrary legacy snapshot values", () => {
  const markdown = [
    '# Houses <!-- id:u1 basedOn="a1" snapshot="garbage" -->',
    "",
    "- Brick house",
    "",
  ].join("\n");

  const { nodes } = parseToDocument(TEST_PUBKEY, markdown, { path: "doc.md" });

  expect(nodes.get("doc.md#u1")?.extraAttrs).toEqual({
    basedOn: "a1",
    snapshot: "garbage",
  });
});

test("unknown comment attributes survive parse and render", () => {
  const markdown = [
    '# Votes <!-- id:u1 knowstr_vote_id="v1" -->',
    "",
    '- Option A <!-- id:u2 knowstr_vote_id="v2" custom="x" -->',
    "",
  ].join("\n");

  const { document, nodes } = parseToDocument(TEST_PUBKEY, markdown, {
    path: "doc.md",
  });

  expect(nodes.get("doc.md#u1")?.extraAttrs).toEqual({ knowstr_vote_id: "v1" });
  expect(nodes.get("doc.md#u2")?.extraAttrs).toEqual({
    knowstr_vote_id: "v2",
    custom: "x",
  });

  const knowledgeDBs = Map<SourceId, KnowledgeData>([[TEST_PUBKEY, { nodes }]]);
  expect(renderDocumentMarkdown(knowledgeDBs, document)).toContain(
    '<!-- id:u1 knowstr_vote_id="v1" -->'
  );
  expect(renderDocumentMarkdown(knowledgeDBs, document)).toContain(
    '<!-- id:u2 knowstr_vote_id="v2" custom="x" -->'
  );
});

test("block-link rows keep generic attributes", () => {
  const snapshot = `snap_sha256_${"3".repeat(64)}`;
  const markdown = [
    "# Reading <!-- id:u1 -->",
    "",
    `- [Chapter](#t1) <!-- id:u2 basedOn="a5" snapshot="${snapshot}" knowstr_vote_id="v1" -->`,
    "",
  ].join("\n");

  const { document, nodes } = parseToDocument(TEST_PUBKEY, markdown, {
    path: "doc.md",
  });

  expect(nodes.get("doc.md#u2")?.extraAttrs).toEqual({
    basedOn: "a5",
    snapshot,
    knowstr_vote_id: "v1",
  });

  const knowledgeDBs = Map<SourceId, KnowledgeData>([[TEST_PUBKEY, { nodes }]]);
  expect(renderDocumentMarkdown(knowledgeDBs, document)).toContain(
    `- [Chapter](#t1) <!-- id:u2 basedOn="a5" snapshot="${snapshot}" knowstr_vote_id="v1" -->`
  );
});
