import { cleanup, screen } from "@testing-library/react";
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

test("cursor after a link: Enter opens the editor in the next row", async () => {
  const { workspacePath } = await linkWorkspace();
  await renderAppTree({ path: workspacePath, search: "Notes" });

  // Click right of the link text: the caret zone. Enter opens the editor
  // below; the note lands as a sibling after the link row.
  await userEvent.click(
    await screen.findByLabelText("cursor after Topics / Cantillon")
  );
  await userEvent.keyboard("{Enter}");
  await userEvent.type(await findNewNodeEditor(), "My note{Escape}");

  await expectTree(`
Notes
  [R] Topics / Cantillon
  My note
  After
  `);
});

test("Tab indents onto the link: a placement note, file truth", async () => {
  const { workspacePath } = await linkWorkspace();
  await renderAppTree({ path: workspacePath, search: "Notes" });

  await userEvent.click(
    await screen.findByLabelText("cursor after Topics / Cantillon")
  );
  await userEvent.keyboard("{Enter}");
  const editor = await findNewNodeEditor();
  await userEvent.type(editor, "Placement note");
  await userEvent.keyboard("{Tab}");
  await userEvent.keyboard("{Escape}");

  // The link row expands to its OWN children — never the target's
  // subtree (that is embed territory; today only suggestion previews).
  await expectTree(`
Notes
  [R] Topics / Cantillon
    Placement note
  After
  `);

  // And it is file truth: the note nests under the link row on disk.
  const notes = fs.readFileSync(path.join(workspacePath, "notes.md"), "utf8");
  expect(notes).toMatch(
    /- \[Cantillon\]\(#[^)]+\)[^\n]*\n {2}- Placement note/u
  );

  // The triangle appears now that the link row has own children.
  await screen.findByLabelText("collapse Topics / Cantillon");
});
