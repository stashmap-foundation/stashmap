import { parseToDocument } from "./Document";

const TEST_PUBKEY = "a".repeat(64) as PublicKey;

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
