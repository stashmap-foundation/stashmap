import fs from "fs";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  expectMarkdown,
  knowstrInit,
  knowstrSave,
  ls,
  write,
} from "../testFixtures/workspace";
import { renderAppTree } from "../appTestUtils.test";
import {
  expectTree,
  findNewNodeEditor,
  navigateToNodeViaSearch,
  type,
} from "../utils.test";

async function expectKnowstrDocIdFrontmatter(
  workspacePath: string,
  relativePath: string
): Promise<void> {
  await waitFor(() => {
    const content = fs.readFileSync(`${workspacePath}/${relativePath}`, "utf8");
    expect(content).toMatch(/^---\n[\s\S]*knowstr_doc_id:/u);
  });
}

test("typing in the editor writes markdown files to the workspace", async () => {
  const { path } = await renderAppTree();
  if (!path) {
    throw new Error("expected renderAppTree to return a workspace path");
  }
  await findNewNodeEditor();

  await type("Holiday Destinations{Enter}{Tab}Spain{Enter}France{Escape}");

  await expectTree(`
Holiday Destinations
  Spain
  France
`);

  await expectMarkdown(
    path,
    "holiday-destinations.md",
    `
# Holiday Destinations <!-- id:... -->

- Spain <!-- id:... -->
- France <!-- id:... -->
`
  );
  expect(ls(path)).toEqual(["holiday-destinations.md", "log.md"]);
});

test("adding a sibling to a hand-written file updates the same file (no duplicate)", async () => {
  const { path } = knowstrInit();
  write(
    path,
    "holidays.md",
    `
# Holiday Destinations
## Bali
- Beaches
`
  );

  await renderAppTree({ path, search: "Holiday Destinations" });

  await expectTree(`
Holiday Destinations
  Bali
`);

  await userEvent.click(await screen.findByLabelText("edit Bali"));
  await userEvent.keyboard("{Enter}Spain{Escape}");

  await expectTree(`
Holiday Destinations
  Bali
  Spain
`);

  expect(ls(path)).toEqual(["holidays.md"]);
  await expectMarkdown(
    path,
    "holidays.md",
    `
# Holiday Destinations <!-- id:... -->

## Bali <!-- id:... -->

- Beaches <!-- id:... -->

## Spain <!-- id:... -->
`
  );
});

test("creating a new document via the app persists knowstr_doc_id frontmatter to disk", async () => {
  const { path } = await renderAppTree();
  if (!path) {
    throw new Error("expected renderAppTree to return a workspace path");
  }
  await findNewNodeEditor();
  await type("My Notes{Enter}{Tab}Spain{Escape}");

  await expectKnowstrDocIdFrontmatter(path, "my-notes.md");
});

test("adding a sibling to holidays.md persists frontmatter", async () => {
  const { path } = knowstrInit();
  write(path, "holidays.md", "# Holiday Destinations\n- France\n- Paris\n");

  await renderAppTree({ path, search: "Holiday Destinations" });
  await expectTree(`
Holiday Destinations
  France
  Paris
`);

  await userEvent.click(await screen.findByLabelText("edit Paris"));
  await userEvent.keyboard("{Enter}Spain{Escape}");

  await expectTree(`
Holiday Destinations
  France
  Paris
  Spain
`);

  await expectKnowstrDocIdFrontmatter(path, "holidays.md");
});

test("editing a hand-written file persists knowstr_doc_id frontmatter to disk", async () => {
  const { path } = knowstrInit();
  write(path, "notes.md", "# Notes\n- alpha\n");

  await renderAppTree({ path, search: "Notes" });
  await expectTree(`
Notes
  alpha
`);

  await userEvent.click(await screen.findByLabelText("edit alpha"));
  await userEvent.keyboard("{Enter}beta{Escape}");

  await expectTree(`
Notes
  alpha
  beta
`);

  await expectKnowstrDocIdFrontmatter(path, "notes.md");
});

test("opening a workspace does not write to any file on disk", async () => {
  const { path } = knowstrInit();
  const before = `
# Doc
- one
`;
  write(path, "doc.md", before);

  await renderAppTree({ path, search: "Doc" });
  await expectTree(`
Doc
  one
`);

  expect(ls(path)).toEqual(["doc.md"]);
  expect(fs.readFileSync(`${path}/doc.md`, "utf8")).toBe(before);
});

test("adding a sibling after a heading writes unambiguous markdown", async () => {
  const { path } = knowstrInit();
  write(
    path,
    "holidays.md",
    `
# Holiday Destinations
## Bali
- Beaches
`
  );
  await knowstrSave(path);

  await renderAppTree({ path, search: "Holiday Destinations" });

  await expectTree(`
Holiday Destinations
  Bali
`);

  await userEvent.click(await screen.findByLabelText("edit Bali"));
  await userEvent.keyboard("{Enter}Spain{Escape}");

  await expectTree(`
Holiday Destinations
  Bali
  Spain
`);

  expect(ls(path)).toEqual(["holidays.md"]);
  await expectMarkdown(
    path,
    "holidays.md",
    `
# Holiday Destinations <!-- id:... -->

## Bali <!-- id:... -->

- Beaches <!-- id:... -->

## Spain <!-- id:... -->
`
  );
});

test("a manually-created log.md does not collide with the auto-created Log root", async () => {
  const { path } = knowstrInit();
  write(path, "log.md", "# My Log\n- alpha\n");

  await renderAppTree({ path });
  await screen.findByLabelText("Navigate to Log");
  await findNewNodeEditor();

  await type("Holiday Destinations{Escape}");

  await expectTree(`
Holiday Destinations
`);

  const files = ls(path);
  expect(files).toContain("log.md");
  expect(files).toContain("holiday-destinations.md");
  expect(files).not.toContain("log-2.md");
  expect(files).not.toContain("~log.md");

  await userEvent.click(await screen.findByLabelText("Navigate to Log"));

  await expectTree(`
My Log
  [R] Holiday Destinations
  alpha
`);
});

test("paragraph siblings are preserved on round-trip", async () => {
  const { path } = knowstrInit();
  write(
    path,
    "doc.md",
    `
# Root

A standalone paragraph.

## Heading
`
  );
  await knowstrSave(path);

  await renderAppTree({ path, search: "Root" });

  await expectTree(`
Root
  A standalone paragraph.
  Heading
`);

  await userEvent.click(
    await screen.findByLabelText("edit A standalone paragraph.")
  );
  await userEvent.keyboard("{Enter}Mid{Escape}");

  await userEvent.click(await screen.findByLabelText("edit Heading"));
  await userEvent.keyboard("{Enter}Trailing{Escape}");

  await expectTree(`
Root
  A standalone paragraph.
  Mid
  Heading
  Trailing
`);

  await expectMarkdown(
    path,
    "doc.md",
    `
# Root <!-- id:... -->

A standalone paragraph. <!-- id:... -->

- Mid <!-- id:... -->

## Heading <!-- id:... -->

## Trailing <!-- id:... -->
`
  );
});

test("paragraph prefix marks render in the gutter and can be updated", async () => {
  const { path } = knowstrInit();
  write(
    path,
    "doc.md",
    `
# Root

(?-) marked paragraph

plain paragraph
`
  );

  await renderAppTree({ path, search: "Root" });

  await expectTree(
    `
Root
  {?-} marked paragraph
  plain paragraph
`,
    { showGutter: true }
  );

  await userEvent.click(
    await screen.findByLabelText("set plain paragraph to relevant")
  );

  await expectTree(
    `
Root
  {?-} marked paragraph
  {!} plain paragraph
`,
    { showGutter: true }
  );

  await expectMarkdown(
    path,
    "doc.md",
    `
# Root <!-- id:... -->

(-?) marked paragraph <!-- id:... -->

(!) plain paragraph <!-- id:... -->
`
  );
});

test("alt-drag link from a hand-written file points to the same id persisted on disk", async () => {
  const { path } = knowstrInit();
  write(path, "notes.md", "# First\n- Item One\n");
  write(path, "links.md", "# My Links");

  await renderAppTree({ path });

  await navigateToNodeViaSearch(0, "First");
  await userEvent.click(await screen.findByLabelText("Open new pane"));
  await navigateToNodeViaSearch(1, "My Links");

  await expectTree(`
First
  Item One
My Links
`);

  const myLinksItems = screen.getAllByRole("treeitem", { name: "My Links" });
  const myLinksInPane1 = myLinksItems[myLinksItems.length - 1];

  await userEvent.keyboard("{Alt>}");
  fireEvent.dragStart(screen.getAllByText("Item One")[0]);
  fireEvent.dragOver(myLinksInPane1, { altKey: true });
  fireEvent.drop(myLinksInPane1, { altKey: true });
  await userEvent.keyboard("{/Alt}");

  await expectTree(`
First
  Item One
My Links
  [R] First / Item One
`);

  await waitFor(() => {
    const notes = fs.readFileSync(`${path}/notes.md`, "utf8");
    expect(notes).toMatch(/Item One <!-- id:([0-9a-f-]+) -->/u);
    const links = fs.readFileSync(`${path}/links.md`, "utf8");
    expect(links).toMatch(/\]\(#[^)]+\)/u);
  });

  const notesContent = fs.readFileSync(`${path}/notes.md`, "utf8");
  const linksContent = fs.readFileSync(`${path}/links.md`, "utf8");

  const itemOneIdMatch = notesContent.match(
    /Item One <!-- id:([0-9a-f-]+) -->/u
  );
  const linkTargetMatch = linksContent.match(/\]\(#[^)]*?_?([0-9a-f-]+)\)/u);

  expect(itemOneIdMatch?.[1]).toBeDefined();
  expect(linkTargetMatch?.[1]).toBeDefined();
  expect(linkTargetMatch?.[1]).toBe(itemOneIdMatch?.[1]);
});
