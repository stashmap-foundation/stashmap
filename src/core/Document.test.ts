import { Map } from "immutable";
import {
  parseToDocument,
  parseToDocumentPreservingExplicitIds,
} from "./Document";
import { renderDocumentMarkdown } from "../documentRenderer";

const TEST_PUBKEY = "a".repeat(64) as PublicKey;

test("parseToDocument assigns the document id to every top-level root", () => {
  const { document, nodes } = parseToDocument(
    TEST_PUBKEY,
    "# First\n\n# Second\n",
    { docIdFallback: "doc-1" }
  );

  const rootDocIds = document.topNodeShortIds.map((id) => nodes.get(id)?.docId);

  expect(rootDocIds).toEqual(["doc-1", "doc-1"]);
});

test("parseToDocument extracts title from frontmatter", () => {
  const markdown = `---\ntitle: "Holiday Destinations"\n---\n# Spain\n`;
  const { document } = parseToDocument(TEST_PUBKEY, markdown);
  expect(document.title).toBe("Holiday Destinations");
});

test("parseToDocument frontmatter title beats fallbackTitle", () => {
  const markdown = `---\ntitle: "Frontmatter Wins"\n---\n# Body Heading\n`;
  const { document } = parseToDocument(TEST_PUBKEY, markdown, {
    fallbackTitle: "Fallback Loses",
  });
  expect(document.title).toBe("Frontmatter Wins");
});

test("parseToDocument falls back to fallbackTitle when no frontmatter title", () => {
  const markdown = "# Body Heading\n- alpha\n";
  const { document } = parseToDocument(TEST_PUBKEY, markdown, {
    filePath: "notes/projects.md",
    fallbackTitle: "projects",
  });
  expect(document.title).toBe("projects");
});

test("parseToDocument falls back to first top-level node text", () => {
  const markdown = "# Holiday Destinations\n- Spain\n";
  const { document } = parseToDocument(TEST_PUBKEY, markdown);
  expect(document.title).toBe("Holiday Destinations");
});

test("parseToDocument falls back to 'Untitled' when nothing else is available", () => {
  const { document } = parseToDocument(TEST_PUBKEY, "");
  expect(document.title).toBe("Untitled");
});

test("node-level basedOn and snapshot survive parse and render", () => {
  const rootSnapshot = `snap_sha256_${"1".repeat(64)}`;
  const childSnapshot = `snap_sha256_${"2".repeat(64)}`;
  const markdown = [
    `# Houses <!-- id:u1 basedOn="a1" snapshot="${rootSnapshot}" -->`,
    "",
    `- Brick house <!-- id:u2 basedOn="a2" snapshot="${childSnapshot}" -->`,
    "",
  ].join("\n");

  const { document, nodes } = parseToDocumentPreservingExplicitIds(
    TEST_PUBKEY,
    markdown,
    { docIdFallback: "doc-1" }
  );

  expect(nodes.get("u1")?.basedOn).toBe("a1");
  expect(nodes.get("u1")?.snapshotId).toBe(rootSnapshot);
  expect(nodes.get("u2")?.basedOn).toBe("a2");
  expect(nodes.get("u2")?.snapshotId).toBe(childSnapshot);

  const knowledgeDBs = Map<SourceId, KnowledgeData>([[TEST_PUBKEY, { nodes }]]);
  expect(renderDocumentMarkdown(knowledgeDBs, document)).toContain(
    `snapshot="${rootSnapshot}"`
  );
  expect(renderDocumentMarkdown(knowledgeDBs, document)).toContain(
    `snapshot="${childSnapshot}"`
  );
});

test("parseToDocument tolerates malformed snapshot ids in foreign documents", () => {
  const markdown = [
    '# Houses <!-- id:u1 basedOn="a1" snapshot="garbage" -->',
    "",
    "- Brick house",
    "",
  ].join("\n");

  const { nodes } = parseToDocumentPreservingExplicitIds(
    TEST_PUBKEY,
    markdown,
    { docIdFallback: "doc-1" }
  );

  expect(nodes.get("u1")?.snapshotId).toBe("garbage");
});

test("unknown comment attributes survive parse and render", () => {
  const markdown = [
    '# Votes <!-- id:u1 knowstr_vote_id="v1" -->',
    "",
    '- Option A <!-- id:u2 knowstr_vote_id="v2" custom="x" -->',
    "",
  ].join("\n");

  const { document, nodes } = parseToDocumentPreservingExplicitIds(
    TEST_PUBKEY,
    markdown,
    { docIdFallback: "doc-1" }
  );

  expect(nodes.get("u1")?.extraAttrs).toEqual({ knowstr_vote_id: "v1" });
  expect(nodes.get("u2")?.extraAttrs).toEqual({
    knowstr_vote_id: "v2",
    custom: "x",
  });

  const knowledgeDBs = Map<SourceId, KnowledgeData>([[TEST_PUBKEY, { nodes }]]);
  const rendered = renderDocumentMarkdown(knowledgeDBs, document);
  expect(rendered).toContain('<!-- id:u1 knowstr_vote_id="v1" -->');
  expect(rendered).toContain(
    '<!-- id:u2 knowstr_vote_id="v2" custom="x" -->'
  );
});

test("block-link rows keep basedOn, snapshot, and unknown attributes", () => {
  const snapshot = `snap_sha256_${"3".repeat(64)}`;
  const markdown = [
    "# Reading <!-- id:u1 -->",
    "",
    `- [Chapter](#t1) <!-- id:u2 basedOn="a5" snapshot="${snapshot}" knowstr_vote_id="v1" -->`,
    "",
  ].join("\n");

  const { document, nodes } = parseToDocumentPreservingExplicitIds(
    TEST_PUBKEY,
    markdown,
    { docIdFallback: "doc-1" }
  );

  expect(nodes.get("u2")?.basedOn).toBe("a5");
  expect(nodes.get("u2")?.snapshotId).toBe(snapshot);
  expect(nodes.get("u2")?.extraAttrs).toEqual({ knowstr_vote_id: "v1" });

  const knowledgeDBs = Map<SourceId, KnowledgeData>([[TEST_PUBKEY, { nodes }]]);
  expect(renderDocumentMarkdown(knowledgeDBs, document)).toContain(
    `- [Chapter](#t1) <!-- id:u2 basedOn="a5" snapshot="${snapshot}" knowstr_vote_id="v1" -->`
  );
});
