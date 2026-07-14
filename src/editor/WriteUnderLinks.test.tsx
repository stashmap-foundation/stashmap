import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "fs";
import path from "path";
import { renderAppTree } from "../appTestUtils.test";
import {
  expectTree,
  findNewNodeEditor,
  setDropIndentLevel,
} from "../utils.test";
import {
  knowstrInit,
  knowstrSave,
  readNodeId,
  write,
} from "../testFixtures/workspace";

afterEach(cleanup);

function placeCursorAtEnd(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function selectContents(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function placeCursorAfter(element: HTMLElement): void {
  const range = document.createRange();
  range.setStartAfter(element);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

async function linkWorkspace(): Promise<{ workspacePath: string }> {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "topics.md", "# Topics\n\n- Cantillon\n");
  await knowstrSave(workspacePath);
  const targetID = readNodeId(workspacePath, "topics.md", "Cantillon");
  write(
    workspacePath,
    "notes.md",
    `# Notes\n\n- [Cantillon](#${targetID})\n- After\n`
  );
  await knowstrSave(workspacePath);
  return { workspacePath };
}

async function multipleLinkWorkspace(): Promise<{
  workspacePath: string;
  cantillonID: string;
  viennaID: string;
}> {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "topics.md", "# Topics\n\n- Cantillon\n- Vienna\n");
  await knowstrSave(workspacePath);
  const cantillonID = readNodeId(workspacePath, "topics.md", "Cantillon");
  const viennaID = readNodeId(workspacePath, "topics.md", "Vienna");
  write(
    workspacePath,
    "notes.md",
    `# Notes\n\n- Founder of [Cantillon](#${cantillonID}) studied in [Vienna](#${viennaID})\n`
  );
  await knowstrSave(workspacePath);
  return { workspacePath, cantillonID, viennaID };
}

test("bare and mixed links use one span-native editor", async () => {
  const { workspacePath, cantillonID, viennaID } =
    await multipleLinkWorkspace();
  await renderAppTree({ path: workspacePath, search: "Notes" });
  const mixedEditor = await screen.findByRole("textbox", {
    name: "edit Founder of Cantillon studied in Vienna",
  });
  const marks = within(mixedEditor).getAllByRole("link");
  expect(marks.map((mark) => mark.getAttribute("data-href"))).toEqual([
    `#${cantillonID}`,
    `#${viennaID}`,
  ]);
  mixedEditor.focus();
  placeCursorAtEnd(mixedEditor);
  await userEvent.keyboard("!{Escape}");
  await waitFor(() => {
    const notes = fs.readFileSync(path.join(workspacePath, "notes.md"), "utf8");
    expect(notes).toContain(
      `Founder of [Cantillon](#${cantillonID}) studied in [Vienna](#${viennaID}) !`
    );
  });
});

test("each link in a mixed row contributes its own backlink", async () => {
  const { workspacePath, cantillonID, viennaID } =
    await multipleLinkWorkspace();
  await renderAppTree({ path: workspacePath, search: "Notes" });
  await userEvent.click(await screen.findByRole("link", { name: "Cantillon" }));
  expect(
    screen
      .getByRole("treeitem", { name: "Cantillon" })
      .getAttribute("data-node-id")
  ).toBe(cantillonID);
  await userEvent.click(await screen.findByLabelText("expand Cantillon"));
  await expectTree(`
Topics
  Cantillon
    [I] Notes / Founder of Cantillon studied in Vienna ↩
  Vienna
  `);

  cleanup();
  await renderAppTree({ path: workspacePath, search: "Notes" });
  await userEvent.click(await screen.findByRole("link", { name: "Vienna" }));
  expect(
    screen
      .getByRole("treeitem", { name: "Vienna" })
      .getAttribute("data-node-id")
  ).toBe(viennaID);
  await userEvent.click(await screen.findByLabelText("expand Vienna"));
  await expectTree(`
Topics
  Cantillon
    [I] Notes / Founder of Cantillon studied in Vienna ↩
  Vienna
    [I] Notes / Founder of Cantillon studied in Vienna ↩
  `);
});

test("sole-link placements close reciprocal relationships through their parent speaker", async () => {
  const { path: workspacePath } = knowstrInit();
  const bookClubID = "11111111-1111-4111-8111-111111111111";
  const favoriteAuthorsID = "22222222-2222-4222-8222-222222222222";
  write(
    workspacePath,
    "book-club.md",
    `# Book Club <!-- id:${bookClubID} -->\n\n- [Favorite Authors](#${favoriteAuthorsID})\n`
  );
  write(
    workspacePath,
    "favorite-authors.md",
    `# Favorite Authors <!-- id:${favoriteAuthorsID} -->\n`
  );
  await knowstrSave(workspacePath);

  await renderAppTree({ path: workspacePath, search: "Favorite Authors" });
  await expectTree(`
Favorite Authors
  [I] Book Club ↩
  `);

  const incoming = screen.getByRole("treeitem", { name: "Book Club ↩" });
  await userEvent.click(incoming);
  await userEvent.keyboard("!");

  await waitFor(() => {
    const target = fs.readFileSync(
      path.join(workspacePath, "favorite-authors.md"),
      "utf8"
    );
    expect(target).toMatch(
      new RegExp(`- \\(!\\) \\[Book Club\\]\\(#${bookClubID}\\)`)
    );
  });
  await expectTree(`
Favorite Authors
  Book Club↩
  `);
  expect(screen.queryByText("Book Club ↩")).toBeNull();

  cleanup();
  await renderAppTree({ path: workspacePath, search: "Book Club" });
  await expectTree(`
Book Club
  Favorite Authors!↩
  `);

  cleanup();
  await renderAppTree({ path: workspacePath, search: "Favorite Authors" });
  await expectTree(`
Favorite Authors
  Book Club↩
  `);
  expect(
    fs
      .readFileSync(path.join(workspacePath, "favorite-authors.md"), "utf8")
      .match(/<!-- id:(?!\.\.\.)[^ ]+ -->/gu)
  ).toHaveLength(2);

  await userEvent.click(await screen.findByLabelText("edit Book Club"));
  await userEvent.keyboard("{Escape}{Delete}");
  await expectTree(`
Favorite Authors
  [I] Book Club ↩
  `);

  cleanup();
  await renderAppTree({ path: workspacePath, search: "Book Club" });
  await expectTree(`
Book Club
  Favorite Authors
  `);
  await userEvent.click(await screen.findByLabelText("edit Favorite Authors"));
  await userEvent.keyboard("{Escape}{Delete}");
  await expectTree(`
Book Club
  `);

  cleanup();
  await renderAppTree({ path: workspacePath, search: "Favorite Authors" });
  await expectTree(`
Favorite Authors
  `);
});

test("moving a reciprocal placement recomputes both endpoint pairs", async () => {
  const { path: workspacePath } = knowstrInit();
  const bookClubID = "11111111-1111-4111-8111-111111111111";
  const favoriteAuthorsID = "22222222-2222-4222-8222-222222222222";
  write(
    workspacePath,
    "book-club.md",
    `# Book Club <!-- id:${bookClubID} -->\n\n- [Favorite Authors](#${favoriteAuthorsID})\n`
  );
  write(
    workspacePath,
    "favorite-authors.md",
    `# Favorite Authors <!-- id:${favoriteAuthorsID} -->\n\n- Other\n`
  );
  await knowstrSave(workspacePath);

  await renderAppTree({ path: workspacePath, search: "Favorite Authors" });
  const incoming = screen.getByRole("treeitem", { name: "Book Club ↩" });
  await userEvent.click(incoming);
  await userEvent.keyboard("!");

  const placement = screen.getByRole("treeitem", { name: "Book Club" });
  const other = screen.getByRole("treeitem", { name: "Other" });
  fireEvent.dragStart(placement);
  setDropIndentLevel("Book Club", "Other", 3);
  fireEvent.dragOver(other);
  fireEvent.drop(other);

  await expectTree(`
Favorite Authors
  Other
    Book Club
  [I] Book Club ↩
  `);
  await waitFor(() => {
    const target = fs.readFileSync(
      path.join(workspacePath, "favorite-authors.md"),
      "utf8"
    );
    expect(target).toMatch(
      new RegExp(
        `- Other[^\\n]*\\n  - \\(!\\) \\[Book Club\\]\\(#${bookClubID}\\)`
      )
    );
  });

  cleanup();
  await renderAppTree({ path: workspacePath, search: "Book Club" });
  await expectTree(`
Book Club
  Favorite Authors
  [I] Favorite Authors / Other !↩
  `);
});

test("repeated links produce one edge and one reciprocal result", async () => {
  const { path: workspacePath } = knowstrInit();
  const statementID = "11111111-1111-4111-8111-111111111111";
  const favoriteAuthorsID = "22222222-2222-4222-8222-222222222222";
  write(
    workspacePath,
    "notes.md",
    `# Notes\n\n- [Favorite Authors](#${favoriteAuthorsID}) and [Favorite Authors again](#${favoriteAuthorsID}) <!-- id:${statementID} -->\n`
  );
  write(
    workspacePath,
    "favorite-authors.md",
    `# Favorite Authors <!-- id:${favoriteAuthorsID} -->\n`
  );
  await knowstrSave(workspacePath);

  await renderAppTree({ path: workspacePath, search: "Favorite Authors" });
  const incoming = screen.getAllByRole("treeitem", {
    name: "Notes / Favorite Authors and Favorite Authors again ↩",
  });
  expect(incoming).toHaveLength(1);
  await userEvent.click(incoming[0]);
  await userEvent.keyboard("!");
  await expectTree(`
Favorite Authors
  Favorite Authors and Favorite Authors again↩
  `);

  cleanup();
  await renderAppTree({ path: workspacePath, search: "Notes" });
  await expectTree(`
Notes
  Favorite Authors!↩ and Favorite Authors again
  `);
});

test("mixed rows close directly without losing either statement's links", async () => {
  const { path: workspacePath } = knowstrInit();
  const firstStatementID = "11111111-1111-4111-8111-111111111111";
  const secondStatementID = "22222222-2222-4222-8222-222222222222";
  const firstEntityID = "33333333-3333-4333-8333-333333333333";
  const secondEntityID = "44444444-4444-4444-8444-444444444444";
  write(
    workspacePath,
    "statements.md",
    `# Statements\n\n- [First](#${firstEntityID}) links [Second statement](#${secondStatementID}) <!-- id:${firstStatementID} -->\n- [Second](#${secondEntityID}) has context <!-- id:${secondStatementID} -->\n`
  );
  write(
    workspacePath,
    "entities.md",
    `# Entities\n\n- First entity <!-- id:${firstEntityID} -->\n- Second entity <!-- id:${secondEntityID} -->\n`
  );
  await knowstrSave(workspacePath);

  await renderAppTree({ path: workspacePath, search: "Statements" });
  await userEvent.click(
    await screen.findByLabelText("expand Second has context")
  );
  const incoming = screen.getByRole("treeitem", {
    name: "Statements / First links Second statement ↩",
  });
  await userEvent.click(incoming);
  await userEvent.keyboard("!");

  await expectTree(`
Statements
  First links Second statement!↩
  Second has context
    First links Second statement↩
  `);
  await waitFor(() => {
    const markdown = fs.readFileSync(
      path.join(workspacePath, "statements.md"),
      "utf8"
    );
    expect(markdown).toContain(`[First](#${firstEntityID})`);
    expect(markdown).toContain(`[Second statement](#${secondStatementID})`);
    expect(markdown).toContain(`[Second](#${secondEntityID})`);
    expect(markdown).toContain(`](#${firstStatementID})`);
  });
});

test("link speaker follows sole and mixed shape transitions", async () => {
  const { path: workspacePath } = knowstrInit();
  const bookClubID = "11111111-1111-4111-8111-111111111111";
  const favoriteAuthorsID = "22222222-2222-4222-8222-222222222222";
  const occurrenceID = "33333333-3333-4333-8333-333333333333";
  const source = (prefix: string): string =>
    `# Book Club <!-- id:${bookClubID} -->\n\n- ${prefix}[Favorite Authors](#${favoriteAuthorsID}) <!-- id:${occurrenceID} -->\n`;
  write(workspacePath, "book-club.md", source(""));
  write(
    workspacePath,
    "favorite-authors.md",
    `# Favorite Authors <!-- id:${favoriteAuthorsID} -->\n`
  );
  await knowstrSave(workspacePath);

  await renderAppTree({ path: workspacePath, search: "Favorite Authors" });
  await expectTree(`
Favorite Authors
  [I] Book Club ↩
  `);

  cleanup();
  write(workspacePath, "book-club.md", source("About "));
  await knowstrSave(workspacePath);
  await renderAppTree({ path: workspacePath, search: "Favorite Authors" });
  await expectTree(`
Favorite Authors
  [I] Book Club / About Favorite Authors ↩
  `);

  cleanup();
  write(workspacePath, "book-club.md", source(""));
  await knowstrSave(workspacePath);
  await renderAppTree({ path: workspacePath, search: "Favorite Authors" });
  await expectTree(`
Favorite Authors
  [I] Book Club ↩
  `);
});

test("mixed statements close on their own speaker and keep other links independent", async () => {
  const { path: workspacePath } = knowstrInit();
  const statementID = "11111111-1111-4111-8111-111111111111";
  const cantillonID = "22222222-2222-4222-8222-222222222222";
  const viennaID = "33333333-3333-4333-8333-333333333333";
  write(
    workspacePath,
    "notes.md",
    `# Notes\n\n- Founder of [Cantillon](#${cantillonID}) studied in [Vienna](#${viennaID}) <!-- id:${statementID} -->\n`
  );
  write(
    workspacePath,
    "topics.md",
    `# Topics\n\n- Cantillon <!-- id:${cantillonID} -->\n- Vienna <!-- id:${viennaID} -->\n`
  );
  await knowstrSave(workspacePath);

  await renderAppTree({ path: workspacePath, search: "Topics" });
  await userEvent.click(await screen.findByLabelText("expand Vienna"));
  await expectTree(`
Topics
  Cantillon
  Vienna
    [I] Notes / Founder of Cantillon studied in Vienna ↩
  `);

  const incoming = screen.getByRole("treeitem", {
    name: "Notes / Founder of Cantillon studied in Vienna ↩",
  });
  await userEvent.click(incoming);
  await userEvent.keyboard("!");

  await waitFor(() => {
    const topics = fs.readFileSync(
      path.join(workspacePath, "topics.md"),
      "utf8"
    );
    expect(topics).toContain(`](#${statementID})`);
  });
  await expectTree(`
Topics
  Cantillon
  Vienna
    Founder of Cantillon studied in Vienna↩
  `);

  cleanup();
  await renderAppTree({ path: workspacePath, search: "Notes" });
  await expectTree(`
Notes
  Founder of Cantillon studied in Vienna!↩
  `);

  cleanup();
  await renderAppTree({ path: workspacePath, search: "Topics" });
  await userEvent.click(await screen.findByLabelText("expand Cantillon"));
  await expectTree(`
Topics
  Cantillon
    [I] Notes / Founder of Cantillon studied in Vienna ↩
  Vienna
    Founder of Cantillon studied in Vienna↩
  `);
});

test("rewriting a fully deleted link label preserves its target", async () => {
  const { path: workspacePath } = knowstrInit();
  const targetID = "wd:Q203411";
  const original = "Austrian School of Economics";
  write(
    workspacePath,
    "notes.md",
    `# Notes\n\n- The [${original}](#${targetID}) is from Vienna\n`
  );
  await knowstrSave(workspacePath);

  await renderAppTree({ path: workspacePath, search: "Notes" });
  const editor = await screen.findByRole("textbox", {
    name: `edit The ${original} is from Vienna`,
  });
  const mark = within(editor).getByRole("link");
  editor.focus();
  selectContents(mark);
  await userEvent.keyboard("{Backspace}");
  placeCursorAfter(mark);
  await userEvent.keyboard("Österreichische Schule{Delete}\u00a0{Escape}");

  await waitFor(() => {
    const markdown = fs.readFileSync(
      path.join(workspacePath, "notes.md"),
      "utf8"
    );
    expect(markdown).toContain(
      `The [Österreichische Schule](#${targetID}) is from Vienna`
    );
  });
  const renamed = await screen.findByRole("link", {
    name: "Österreichische Schule",
  });
  expect(renamed.getAttribute("data-href")).toBe(`#${targetID}`);
});

test("a link label left empty loses its target", async () => {
  const { path: workspacePath } = knowstrInit();
  const targetID = "wd:Q203411";
  write(
    workspacePath,
    "notes.md",
    `# Notes\n\n- The [A](#${targetID}) is from Vienna\n`
  );
  await knowstrSave(workspacePath);

  await renderAppTree({ path: workspacePath, search: "Notes" });
  const editor = await screen.findByRole("textbox", {
    name: "edit The A is from Vienna",
  });
  const mark = within(editor).getByRole("link");
  editor.focus();
  selectContents(mark);
  await userEvent.keyboard("{Backspace}{Escape}");

  await waitFor(() => {
    const markdown = fs.readFileSync(
      path.join(workspacePath, "notes.md"),
      "utf8"
    );
    expect(markdown).not.toContain(`#${targetID}`);
  });
});

test("terminal links provide a plain continuation slot", async () => {
  const { workspacePath } = await linkWorkspace();
  await renderAppTree({ path: workspacePath, search: "Notes" });
  const editor = await screen.findByRole("textbox", {
    name: "edit Cantillon",
  });
  expect(editor.textContent).toBe("Cantillon\u00a0");
  editor.focus();
  placeCursorAtEnd(editor);
  await userEvent.keyboard("notes{Escape}");

  await waitFor(() => {
    const notes = fs.readFileSync(path.join(workspacePath, "notes.md"), "utf8");
    expect(notes).toMatch(/\[Cantillon\]\(#[^)]+\) notes/u);
  });
});

test("an untouched continuation slot never reaches Markdown", async () => {
  const { workspacePath } = await linkWorkspace();
  const before = fs.readFileSync(path.join(workspacePath, "notes.md"), "utf8");
  await renderAppTree({ path: workspacePath, search: "Notes" });
  const editor = await screen.findByRole("textbox", {
    name: "edit Cantillon",
  });
  editor.focus();
  await userEvent.keyboard("{Escape}");

  await waitFor(() => {
    expect(fs.readFileSync(path.join(workspacePath, "notes.md"), "utf8")).toBe(
      before
    );
  });
});

test("bare links expose an editable target-preserving mark", async () => {
  const { workspacePath } = await linkWorkspace();
  await renderAppTree({ path: workspacePath, search: "Notes" });
  const editor = await screen.findByRole("textbox", {
    name: "edit Cantillon",
  });
  const mark = within(editor).getByRole("link");
  expect(mark.textContent).toBe("Cantillon");
  expect(mark.getAttribute("data-href")).toMatch(/^#/u);
  editor.focus();
  placeCursorAtEnd(mark);
  await userEvent.keyboard("!{Escape}");
  await waitFor(() => {
    const notes = fs.readFileSync(path.join(workspacePath, "notes.md"), "utf8");
    expect(notes).toMatch(/\[Cantillon!\]\(#[^)]+\)/u);
  });
});

test("Enter after a link creates the next sibling", async () => {
  const { workspacePath } = await linkWorkspace();
  await renderAppTree({ path: workspacePath, search: "Notes" });
  const linkEditor = await screen.findByRole("textbox", {
    name: "edit Cantillon",
  });
  linkEditor.focus();
  placeCursorAtEnd(linkEditor);
  await userEvent.keyboard("{Enter}");
  await userEvent.type(await findNewNodeEditor(), "My note{Escape}");
  await expectTree(`
Notes
  Cantillon
  My note
  After
  `);
});

test("Tab indents a new row onto a link row", async () => {
  const { workspacePath } = await linkWorkspace();
  await renderAppTree({ path: workspacePath, search: "Notes" });
  const linkEditor = await screen.findByRole("textbox", {
    name: "edit Cantillon",
  });
  linkEditor.focus();
  placeCursorAtEnd(linkEditor);
  await userEvent.keyboard("{Enter}");
  const editor = await findNewNodeEditor();
  await userEvent.type(editor, "Placement note");
  await userEvent.keyboard("{Tab}{Escape}");
  await expectTree(`
Notes
  Cantillon
    Placement note
  After
  `);
  await waitFor(() => {
    const notes = fs.readFileSync(path.join(workspacePath, "notes.md"), "utf8");
    expect(notes).toMatch(
      /- \[Cantillon\]\(#[^)]+\)[^\n]*\n {2}- Placement note/u
    );
  });
  await screen.findByLabelText("collapse Cantillon");
});
