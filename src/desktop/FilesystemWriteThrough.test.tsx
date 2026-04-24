import fs from "fs";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  expectMarkdown,
  knowstrInit,
  knowstrSave,
  ls,
  write,
} from "../testFixtures/workspace";
import { renderAppTree } from "../appTestUtils.test";
import { expectTree, findNewNodeEditor, type } from "../utils.test";

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

  const content = fs.readFileSync(`${path}/my-notes.md`, "utf8");
  expect(content).toMatch(/^---\n[\s\S]*knowstr_doc_id:/u);
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

  const content = fs.readFileSync(`${path}/holidays.md`, "utf8");
  expect(content).toMatch(/^---\n[\s\S]*knowstr_doc_id:/u);
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

  const content = fs.readFileSync(`${path}/notes.md`, "utf8");
  expect(content).toMatch(/^---\n[\s\S]*knowstr_doc_id:/u);
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

test("dragging nodes reorders markdown in the workspace file", async () => {
  const { path } = knowstrInit();
  write(path, "tasks.md", "# Root\n- A\n- B\n- C\n");
  await knowstrSave(path);

  await renderAppTree({ path, search: "Root" });
  await expectTree(`
Root
  A
  B
  C
`);

  fireEvent.dragStart(screen.getByText("C"));
  fireEvent.drop(screen.getByText("A"));

  await expectTree(`
Root
  C
  A
  B
`);

  await expectMarkdown(
    path,
    "tasks.md",
    `
# Root <!-- id:... -->

- C <!-- id:... -->
- A <!-- id:... -->
- B <!-- id:... -->
`
  );
});

test("dragging nodes under another node persists markdown indentation", async () => {
  const { path } = knowstrInit();
  write(path, "tasks.md", "# Root\n- Parent\n- Child\n");
  await knowstrSave(path);

  await renderAppTree({ path, search: "Root" });
  await expectTree(`
Root
  Parent
  Child
`);

  fireEvent.dragStart(screen.getByText("Child"));
  fireEvent.drop(screen.getByText("Parent"));

  await expectTree(`
Root
  Parent
    Child
`);

  await expectMarkdown(
    path,
    "tasks.md",
    `
# Root <!-- id:... -->

- Parent <!-- id:... -->
  - Child <!-- id:... -->
`
  );
});
