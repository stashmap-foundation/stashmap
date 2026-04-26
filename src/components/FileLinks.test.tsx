import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "fs";
import path from "path";
import { renderAppTree } from "../appTestUtils.test";
import { expectTree, getPane, navigateToNodeViaSearch } from "../utils.test";
import {
  knowstrInit,
  knowstrSave,
  write,
} from "../testFixtures/workspace";

test("Cross-file link round-trips through save and renders in tree", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "a.md", "# A\n\n- [Open B](./b.md)\n");
  write(workspacePath, "b.md", "# B\n\n- B-child\n");

  const before = fs.readFileSync(path.join(workspacePath, "a.md"), "utf8");
  await knowstrSave(workspacePath);
  const after = fs.readFileSync(path.join(workspacePath, "a.md"), "utf8");

  expect(after).toContain("[Open B](./b.md)");
  expect(after.replace(/<!--[^>]+-->/g, "")).toEqual(
    before.replace(/<!--[^>]+-->/g, "")
  );

  await renderAppTree({ path: workspacePath, search: "A" });

  await screen.findByText("Open B");
});

test("Cross-directory link resolves and is clickable to target root", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "notes/a.md", "# A\n\n- [Open B](../topics/b.md)\n");
  write(workspacePath, "topics/b.md", "# B\n\n- B-child\n");

  await knowstrSave(workspacePath);
  await renderAppTree({ path: workspacePath, search: "A" });

  await screen.findByText("Open B");
  const navigateLink = await screen.findByLabelText("Navigate to Open B");
  await userEvent.click(navigateLink);

  await screen.findByLabelText(/^edit B(\s|$)/);
  await screen.findByText("B-child");
});

test("DnD copy of a file-link bullet preserves resolution to original target", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "a.md", "# A\n\n- [Open B](./b.md)\n");
  write(workspacePath, "b.md", "# B\n\n- B-child\n");
  write(workspacePath, "c.md", "# C\n\n- C-child\n");

  await knowstrSave(workspacePath);
  await renderAppTree({ path: workspacePath, search: "A" });

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await navigateToNodeViaSearch(1, "C");

  const sourceLink = getPane(0).getByText("Open B");
  const targetC = getPane(1).getByRole("treeitem", { name: "C" });

  await userEvent.keyboard("{Alt>}");
  fireEvent.dragStart(sourceLink);
  fireEvent.dragOver(targetC, { altKey: true });
  fireEvent.drop(targetC, { altKey: true });
  await userEvent.keyboard("{/Alt}");

  const copiedLink = await getPane(1).findByLabelText("Navigate to Open B");
  await userEvent.click(copiedLink);

  await screen.findByLabelText(/^edit B(\s|$)/);
  await screen.findByText("B-child");
});

test("File link surfaces as incoming reference on target's root", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "a.md", "# A\n\n- [Open B](./b.md)\n");
  write(workspacePath, "b.md", "# B\n\n- B-child\n");

  await knowstrSave(workspacePath);
  await renderAppTree({ path: workspacePath, search: "B" });

  await expectTree(`
B
  B-child
  [I] B <<< A
  `);
});

test("File link with prefix markers preserves them on the incoming reference", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "a.md", "# A\n\n- (!+)[Open B](./b.md)\n");
  write(workspacePath, "b.md", "# B\n\n- B-child\n");

  await knowstrSave(workspacePath);
  await renderAppTree({ path: workspacePath, search: "B" });

  await expectTree(
    `
B
  B-child
  [I] B ! <<< A
  `,
    { showGutter: true }
  );
});

afterEach(cleanup);
