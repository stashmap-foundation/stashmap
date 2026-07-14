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
  setDropIndentLevel,
} from "../utils.test";
import {
  knowstrInit,
  knowstrSave,
  readNodeId,
  write,
} from "../testFixtures/workspace";
import {
  MockWorkspaceIpc,
  mockWorkspaceIpc,
} from "../testFixtures/mockWorkspaceIpc";
import { FilesystemBackendProvider } from "../infra/filesystem/FilesystemBackendProvider";
import { FilesystemDataProvider } from "../infra/filesystem/FilesystemDataProvider";
import { FilesystemAppRoot } from "../desktop/FilesystemAppRoot";
import { SplitPaneLayout } from "./SplitPaneLayout";
import { PaneHistoryProvider } from "../PaneHistoryContext";
import { DND } from "../dnd";
import { modClick } from "./Multiselect.testUtils";

/* eslint-disable functional/immutable-data */
const ipcsToDispose: MockWorkspaceIpc[] = [];
/* eslint-enable functional/immutable-data */

function renderAppTreeMultiPane(workspacePath: string): void {
  const ipc = mockWorkspaceIpc(workspacePath);
  // eslint-disable-next-line functional/immutable-data
  ipcsToDispose.push(ipc);
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

afterEach(async () => {
  cleanup();
  // eslint-disable-next-line functional/immutable-data
  const pending = ipcsToDispose.splice(0);
  await Promise.all(pending.map((ipc) => ipc.dispose()));
});

test("Cross-file link round-trips through save and renders in tree", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "a.md", "# A\n\n- [Open B](./b.md)\n");
  write(workspacePath, "b.md", "# B\n\n- B-child\n");

  await knowstrSave(workspacePath);
  const after = fs.readFileSync(path.join(workspacePath, "a.md"), "utf8");

  expect(after).toContain("[Open B](./b.md)");

  await renderAppTree({ path: workspacePath, search: "A" });

  await expectTree(`
A
  Open B
  `);
});

test("Cross-directory link resolves and is clickable to target root", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "notes/a.md", "# A\n\n- [Open B](../topics/b.md)\n");
  write(workspacePath, "topics/b.md", "# B\n\n- B-child\n");

  await knowstrSave(workspacePath);
  await renderAppTree({ path: workspacePath, search: "A" });

  const navigateLink = await screen.findByRole("link", { name: "Open B" });
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
    (
      await screen.findAllByLabelText("open in split pane")
    )[0]
  );
  await navigateToNodeViaSearch(1, "C");

  const sourceLink = getPane(0).getByText("Open B");
  const targetC = getPane(1).getByRole("treeitem", { name: "C" });

  await userEvent.keyboard("{Alt>}");
  fireEvent.dragStart(sourceLink);
  setDropIndentLevel("Open B", "C", 2);
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
  [I] A ↩
  `);
});

test("Accepting a file-link incoming ref links back to the source row", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "a.md", "# A\n\n- [Open B](./b.md)\n");
  write(workspacePath, "b.md", "# B\n\n- B-child\n");

  await knowstrSave(workspacePath);
  await renderAppTree({ path: workspacePath, search: "B" });

  await expectTree(`
B
  B-child
  [I] A ↩
  `);

  const incoming = await screen.findByRole("treeitem", {
    name: "A ↩",
  });
  await userEvent.click(incoming);
  await userEvent.keyboard("!");

  await expectTree(`
B
  B-child
  A↩
  `);

  const reverseLink = await screen.findByRole("link", { name: "A" });
  expect(reverseLink.getAttribute("data-href")).toMatch(/^#/u);

  await userEvent.click(reverseLink);

  await expectTree(`
A
  Open B!↩
  `);
});

test("Deleted file link target renders per-link dead furniture", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "a.md", "# A\n\n- [Open B](./b.md)\n");
  write(workspacePath, "b.md", "# B\n\n- B-child\n");

  await knowstrSave(workspacePath);
  fs.unlinkSync(path.join(workspacePath, "b.md"));
  await knowstrSave(workspacePath);
  await renderAppTree({ path: workspacePath, search: "A" });

  await expectTree(`
A
  Open B†
  `);
  expect(
    screen.getByRole("link", {
      name: "Open B. Target no longer exists",
    }).style.cursor
  ).toBe("default");
});

test("Mixed node-links and file-links all render", async () => {
  const { path: workspacePath } = knowstrInit();
  write(
    workspacePath,
    "destinations.md",
    "# Holiday Destinations\n\n- France\n- Spain\n"
  );
  write(workspacePath, "hello.md", "# Hello Doc\n\n- Hello-child\n");
  await knowstrSave(workspacePath);

  const franceID = readNodeId(workspacePath, "destinations.md", "France");
  const helloRootID = readNodeId(workspacePath, "hello.md", "Hello Doc");

  write(
    workspacePath,
    "links.md",
    `# Links\n\n- [Holiday / France](#${franceID})\n- [Hello Doc](#${helloRootID})\n- [Hello](./hello.md)\n`
  );
  await knowstrSave(workspacePath);
  await renderAppTree({ path: workspacePath, search: "Links" });

  await expectTree(`
Links
  Holiday / France
  Hello Doc
  Hello
  `);
});

test("Cross-document node links survive a save round-trip", async () => {
  const { path: workspacePath } = knowstrInit();
  write(
    workspacePath,
    "destinations.md",
    "# Holiday Destinations\n\n- France\n- Spain\n"
  );
  write(workspacePath, "hello.md", "# Hello Doc\n\n- Hello-child\n");
  await knowstrSave(workspacePath);

  const franceID = readNodeId(workspacePath, "destinations.md", "France");
  const helloRootID = readNodeId(workspacePath, "hello.md", "Hello Doc");

  write(
    workspacePath,
    "links.md",
    `# Links\n\n- [Holiday / France](#${franceID})\n- [Hello Doc](#${helloRootID})\n- [Hello](./hello.md)\n`
  );
  await knowstrSave(workspacePath);

  const after = fs.readFileSync(path.join(workspacePath, "links.md"), "utf8");
  expect(after).toContain(`[Holiday / France](#${franceID})`);
  expect(after).toContain(`[Hello Doc](#${helloRootID})`);
  expect(after).toContain("[Hello](./hello.md)");
});

test("Cross-document node links survive an app reload", async () => {
  const { path: workspacePath } = knowstrInit();
  write(
    workspacePath,
    "destinations.md",
    "# Holiday Destinations\n\n- France\n- Spain\n"
  );
  write(workspacePath, "hello.md", "# Hello Doc\n\n- Hello-child\n");
  await knowstrSave(workspacePath);

  const franceID = readNodeId(workspacePath, "destinations.md", "France");

  write(
    workspacePath,
    "links.md",
    `# Links\n\n- [Holiday / France](#${franceID})\n- [Hello](./hello.md)\n`
  );
  await knowstrSave(workspacePath);

  await renderAppTree({ path: workspacePath, search: "Links" });
  await expectTree(`
Links
  Holiday / France
  Hello
  `);

  cleanup();
  await renderAppTree({ path: workspacePath, search: "Links" });

  await expectTree(`
Links
  Holiday / France
  Hello
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
  [I] A !+↩
  `,
    { showGutter: true }
  );

  await userEvent.click(screen.getByRole("treeitem", { name: "A !+↩" }));
  await userEvent.keyboard("?");
  await expectTree(
    `
B
  B-child
  {?} A!+↩
  `,
    { showGutter: true }
  );

  cleanup();
  await renderAppTree({ path: workspacePath, search: "A" });
  await expectTree(
    `
A
  {!+} Open B?↩
  `,
    { showGutter: true }
  );
});

test("Multiselect DnD of file links targets every document, not the source rows", async () => {
  const { path: workspacePath } = knowstrInit();
  write(
    workspacePath,
    "links.md",
    "# Links\n\n- [Open B](./b.md)\n- [Open D](./d.md)\n"
  );
  write(workspacePath, "b.md", "# B\n\n- B-child\n");
  write(workspacePath, "d.md", "# D\n\n- D-child\n");
  write(workspacePath, "c.md", "# C\n\n- C-child\n");

  await knowstrSave(workspacePath);
  renderAppTreeMultiPane(workspacePath);

  await navigateToNodeViaSearch(0, "Links");
  await userEvent.click(
    (
      await screen.findAllByLabelText("open in split pane")
    )[0]
  );
  await navigateToNodeViaSearch(1, "C");

  modClick(getPane(0).getByLabelText("Open B"), { metaKey: true });
  modClick(getPane(0).getByLabelText("Open D"), { metaKey: true });

  fireEvent.dragStart(getPane(0).getByText("Open B"));
  fireEvent.drop(getPane(1).getByRole("treeitem", { name: "C" }));

  // Every dragged link points at its document; the non-primary rows must
  // not degrade to node links into the source rows (they would open the
  // links document instead of the target).
  await waitFor(() => {
    const cContent = fs.readFileSync(path.join(workspacePath, "c.md"), "utf8");
    expect(cContent).toMatch(/\[[^\]]*\]\([^)#]*b\.md\)/u);
    expect(cContent).toMatch(/\[[^\]]*\]\([^)#]*d\.md\)/u);
    expect(cContent).not.toMatch(/\(#/u);
  });
});
