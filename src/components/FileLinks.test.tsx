import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "fs";
import path from "path";
import { renderAppTree } from "../appTestUtils.test";
import {
  expectTree,
  getPane,
  navigateToNodeViaSearch,
  renderWithTestData,
} from "../utils.test";
import {
  knowstrInit,
  knowstrSave,
  write,
} from "../testFixtures/workspace";
import { mockWorkspaceIpc } from "../testFixtures/mockWorkspaceIpc";
import { FilesystemBackendProvider } from "../infra/filesystem/FilesystemBackendProvider";
import { FilesystemDataProvider } from "../infra/filesystem/FilesystemDataProvider";
import { FilesystemAppRoot } from "../desktop/FilesystemAppRoot";
import { SplitPaneLayout } from "./SplitPaneLayout";
import { PaneHistoryProvider } from "../PaneHistoryContext";
import { DND } from "../dnd";

function renderAppTreeMultiPane(workspacePath: string): void {
  const ipc = mockWorkspaceIpc(workspacePath);
  renderWithTestData(
    <FilesystemAppRoot>
      <DND>
        <PaneHistoryProvider>
          <SplitPaneLayout />
        </PaneHistoryProvider>
      </DND>
    </FilesystemAppRoot>,
    {
      BackendProvider: ({ children }: { children: React.ReactNode }) => (
        <FilesystemBackendProvider ipc={ipc}>
          {children}
        </FilesystemBackendProvider>
      ),
      DataProvider: FilesystemDataProvider,
    }
  );
}

test("Cross-file link round-trips through save and renders in tree", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "a.md", "# A\n\n- [Open B](./b.md)\n");
  write(workspacePath, "b.md", "# B\n\n- B-child\n");

  await knowstrSave(workspacePath);
  const after = fs.readFileSync(path.join(workspacePath, "a.md"), "utf8");

  expect(after).toContain("[Open B](./b.md)");

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

test("DnD copy of a file-link bullet between panes preserves resolution to original target", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "a.md", "# A\n\n- [Open B](./b.md)\n");
  write(workspacePath, "b.md", "# B\n\n- B-child\n");
  write(workspacePath, "c.md", "# C\n\n- C-child\n");

  await knowstrSave(workspacePath);
  renderAppTreeMultiPane(workspacePath);

  await navigateToNodeViaSearch(0, "A");

  await userEvent.click(
    (await screen.findAllByLabelText("open in split pane"))[0]
  );
  await navigateToNodeViaSearch(1, "C");

  const sourceLink = getPane(0).getByText("Open B");
  const targetC = getPane(1).getByRole("treeitem", { name: "C" });

  await userEvent.keyboard("{Alt>}");
  fireEvent.dragStart(sourceLink);
  fireEvent.dragOver(targetC, { altKey: true });
  fireEvent.drop(targetC, { altKey: true });
  await userEvent.keyboard("{/Alt}");

  await waitFor(() => {
    const cContent = fs.readFileSync(path.join(workspacePath, "c.md"), "utf8");
    expect(cContent).toMatch(/Open B/u);
  });
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
  [I] A
  `);
});

test("Mixed node-links and file-links all render", async () => {
  const { path: workspacePath } = knowstrInit();
  write(
    workspacePath,
    "links.md",
    "# Links\n\n- [Holiday / France](#abc_def)\n- [Barna](#xyz)\n- [Hello](./hello.md)\n"
  );
  write(workspacePath, "hello.md", "# Hello Doc\n\n- Hello-child\n");

  await knowstrSave(workspacePath);
  // eslint-disable-next-line no-console
  console.log("links.md after save:", fs.readFileSync(path.join(workspacePath, "links.md"), "utf8"));
  await renderAppTree({ path: workspacePath, search: "Links" });

  await screen.findByText(/Holiday \/ France/u);
  await screen.findByText("Barna");
  await screen.findByText("Hello");
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
  [I] A !+
  `,
    { showGutter: true }
  );
});

afterEach(cleanup);
