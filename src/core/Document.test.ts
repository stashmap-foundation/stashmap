import { contentToDocument } from "./Document";

const TEST_PUBKEY = "a".repeat(64) as PublicKey;

test("contentToDocument extracts title from frontmatter", () => {
  const markdown = `---\ntitle: "Holiday Destinations"\n---\n# Spain\n`;
  const doc = contentToDocument(TEST_PUBKEY, markdown);
  expect(doc.title).toBe("Holiday Destinations");
});

test("contentToDocument frontmatter title beats fallbackTitle", () => {
  const markdown = `---\ntitle: "Frontmatter Wins"\n---\n# Body Heading\n`;
  const doc = contentToDocument(
    TEST_PUBKEY,
    markdown,
    undefined,
    "Fallback Loses"
  );
  expect(doc.title).toBe("Frontmatter Wins");
});

test("contentToDocument falls back to fallbackTitle when no frontmatter title", () => {
  const markdown = "# Body Heading\n- alpha\n";
  const doc = contentToDocument(
    TEST_PUBKEY,
    markdown,
    "notes/projects.md",
    "projects"
  );
  expect(doc.title).toBe("projects");
});

test("contentToDocument falls back to first top-level node text", () => {
  const markdown = "# Holiday Destinations\n- Spain\n";
  const doc = contentToDocument(TEST_PUBKEY, markdown);
  expect(doc.title).toBe("Holiday Destinations");
});

test("contentToDocument falls back to 'Untitled' when nothing else is available", () => {
  const doc = contentToDocument(TEST_PUBKEY, "");
  expect(doc.title).toBe("Untitled");
});
