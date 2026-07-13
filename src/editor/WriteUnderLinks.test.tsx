import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "fs";
import path from "path";
import { renderAppTree } from "../appTestUtils.test";
import { expectTree, findNewNodeEditor } from "../utils.test";
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
      `Founder of [Cantillon](#${cantillonID}) studied in [Vienna](#${viennaID})!`
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
