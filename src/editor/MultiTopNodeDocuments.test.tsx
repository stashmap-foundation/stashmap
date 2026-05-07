import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderAppTree } from "../appTestUtils.test";
import {
  expectTree,
  getPane,
  navigateToNodeViaSearch,
  setDropIndentLevel,
} from "../utils.test";
import { expectMarkdown, knowstrInit, write } from "../testFixtures/workspace";
import { loadCliProfile } from "../cli/config";
import { buildDocumentRouteUrl } from "../navigationUrl";

async function renderDocumentRoute(
  workspacePath: string,
  relativePath: string
): Promise<void> {
  const profile = loadCliProfile({ cwd: workspacePath });
  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(profile.pubkey, relativePath),
  });
}

async function altDropFromPane0ToPane1(
  sourceName: string,
  targetName: string,
  targetDepth: number
): Promise<void> {
  const source = getPane(0).getByRole("treeitem", { name: sourceName });
  const target = getPane(1).getByRole("treeitem", { name: targetName });
  await userEvent.keyboard("{Alt>}");
  fireEvent.dragStart(source);
  setDropIndentLevel(sourceName, targetName, targetDepth);
  fireEvent.dragOver(target, { altKey: true });
  fireEvent.drop(target, { altKey: true });
  await userEvent.keyboard("{/Alt}");
}

test("Dropping onto a row inside a document pane keeps the document open", async () => {
  const { path: workspacePath } = knowstrInit();
  write(
    workspacePath,
    "multi.md",
    "# Holiday Destinations\n\n- Spain\n  - Barcelona\n\n# Packlist\n\n- Charger\n"
  );
  write(workspacePath, "source.md", "# Source\n\n- Child\n");

  await renderDocumentRoute(workspacePath, "multi.md");
  await userEvent.click(
    (
      await screen.findAllByLabelText("open in split pane")
    )[0]
  );
  await navigateToNodeViaSearch(1, "Source");

  await userEvent.keyboard("{Alt>}");
  fireEvent.dragStart(getPane(1).getByRole("treeitem", { name: "Source" }));
  const documentPane = getPane(0).getByLabelText("Pane 0 content");
  fireEvent.dragOver(documentPane, { altKey: true });
  fireEvent.drop(documentPane, { altKey: true });
  await userEvent.keyboard("{/Alt}");

  await expectTree(`
Holiday Destinations
  Spain
Packlist
  Charger
Source
  Child
  `);

  await userEvent.keyboard("{Alt>}");
  fireEvent.dragStart(getPane(1).getByRole("treeitem", { name: "Source" }));
  const spain = getPane(0).getByRole("treeitem", { name: "Spain" });
  setDropIndentLevel("Source", "Spain", 3);
  fireEvent.dragOver(spain, { altKey: true });
  fireEvent.drop(spain, { altKey: true });
  await userEvent.keyboard("{/Alt}");

  await expectTree(`
Holiday Destinations
  Spain
    Barcelona
    [R] Source
Packlist
  Charger
Source
  Child
  [I] Spain <<< Holiday Destinations
  `);

  cleanup();
});

test("Searching from a document pane replaces document content with search results", async () => {
  const { path: workspacePath } = knowstrInit();
  write(
    workspacePath,
    "multi.md",
    "# Holiday Destinations\n\n- Spain\n\n# Packlist\n\n- Charger\n"
  );
  write(workspacePath, "target.md", "# Target\n\n- Result child\n");

  await renderDocumentRoute(workspacePath, "multi.md");

  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );
  await userEvent.type(
    await screen.findByLabelText("search input"),
    "Target{Enter}"
  );

  await screen.findByLabelText("Navigate to Target");
  expect(
    getPane(0).queryByRole("treeitem", { name: "Holiday Destinations" })
  ).toBeNull();

  await userEvent.click(await screen.findByLabelText("Navigate to Target"));

  await expectTree(`
Target
  Result child
  `);

  cleanup();
});

test("Alt-dragging document graph nodes creates graph refs", async () => {
  const { path: workspacePath } = knowstrInit();
  write(
    workspacePath,
    "multi.md",
    "# Holiday Destinations\n\n- Spain\n\n# Packlist\n\n- Charger\n"
  );
  write(workspacePath, "target.md", "# Target\n\n- Drop here\n");

  await renderDocumentRoute(workspacePath, "multi.md");
  await userEvent.click(
    (
      await screen.findAllByLabelText("open in split pane")
    )[0]
  );
  await navigateToNodeViaSearch(1, "Target");

  await altDropFromPane0ToPane1("Holiday Destinations", "Target", 2);
  await altDropFromPane0ToPane1("Packlist", "Target", 2);
  await altDropFromPane0ToPane1("Spain", "Target", 2);

  await expectTree(`
Holiday Destinations
  Spain
  [I] Target
Packlist
  Charger
  [I] Target
Target
  [R] Holiday Destinations / Spain
  [R] Packlist
  [R] Holiday Destinations
  Drop here
  `);

  const packlistLink = await getPane(1).findByLabelText("Navigate to Packlist");
  expect(packlistLink.getAttribute("href")).toMatch(/^\/r\//u);
  await userEvent.click(packlistLink);

  await expectTree(`
Holiday Destinations
  Spain
  [I] Target
Packlist
  Charger
  [I] Target
Packlist
  Charger
  [I] Target
  `);

  cleanup();
  await renderDocumentRoute(workspacePath, "multi.md");
  await navigateToNodeViaSearch(0, "Target");

  await expectTree(`
Target
  [R] Holiday Destinations / Spain
  [R] Packlist
  [R] Holiday Destinations
  Drop here
  `);

  cleanup();
});

test("Alt-dragged child refs from unsaved markdown survive reload", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "holidays.md", "# Holiday Destinations\n\n- Spain\n");
  write(workspacePath, "links.md", "# My Links\n");

  await renderDocumentRoute(workspacePath, "holidays.md");
  await userEvent.click(
    (
      await screen.findAllByLabelText("open in split pane")
    )[0]
  );
  await navigateToNodeViaSearch(1, "My Links");

  await userEvent.keyboard("{Alt>}");
  fireEvent.dragStart(getPane(0).getByRole("treeitem", { name: "Spain" }));
  const myLinks = getPane(1).getByRole("treeitem", { name: "My Links" });
  setDropIndentLevel("Spain", "My Links", 2);
  fireEvent.dragOver(myLinks, { altKey: true });
  fireEvent.drop(myLinks, { altKey: true });
  await userEvent.keyboard("{/Alt}");

  await expectTree(`
Holiday Destinations
  Spain
My Links
  [R] Holiday Destinations / Spain
  `);

  cleanup();
  await renderDocumentRoute(workspacePath, "holidays.md");
  await navigateToNodeViaSearch(0, "My Links");

  await expectTree(`
My Links
  [R] Holiday Destinations / Spain
  `);

  cleanup();
});

test("Dragging an existing file link preserves document-link behavior", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "a.md", "# A\n\n- [Open B](./b.md)\n");
  write(workspacePath, "b.md", "# B\n\n- B-child\n");
  write(workspacePath, "links.md", "# My Links\n");

  await renderDocumentRoute(workspacePath, "a.md");
  await userEvent.click(
    (
      await screen.findAllByLabelText("open in split pane")
    )[0]
  );
  await navigateToNodeViaSearch(1, "My Links");

  const sourceLink = getPane(0).getByText("B");
  const myLinks = getPane(1).getByRole("treeitem", { name: "My Links" });

  await userEvent.keyboard("{Alt>}");
  fireEvent.dragStart(sourceLink);
  setDropIndentLevel("B", "My Links", 2);
  fireEvent.dragOver(myLinks, { altKey: true });
  fireEvent.drop(myLinks, { altKey: true });
  await userEvent.keyboard("{/Alt}");

  await expectTree(`
A
  [R] B
My Links
  [R] B
  `);

  await expectMarkdown(
    workspacePath,
    "links.md",
    `
# My Links <!-- id:... -->

- [Open B](./b.md)
`
  );

  const copiedLink = await getPane(1).findByLabelText("Navigate to B");
  expect(copiedLink.getAttribute("href")).toMatch(/^\/d\//u);

  cleanup();
  await renderDocumentRoute(workspacePath, "a.md");
  await navigateToNodeViaSearch(0, "My Links");

  await expectTree(`
My Links
  [R] B
  `);

  const reloadedLink = await getPane(0).findByLabelText("Navigate to B");
  expect(reloadedLink.getAttribute("href")).toMatch(/^\/d\//u);
  await userEvent.click(reloadedLink);

  await expectTree(`
B
  B-child
[I] A
[I] My Links
  `);

  cleanup();
});

test("Document file links are italic and incoming refs render at document level", async () => {
  const { path: workspacePath } = knowstrInit();
  write(
    workspacePath,
    "holidays.md",
    "# Holiday Destinations\n\nSpain\n\n# Pack List\n\n- Charger\n"
  );
  write(workspacePath, "files.md", "# Links\n\n[Holidays](./holidays.md)\n");

  await renderDocumentRoute(workspacePath, "files.md");

  await expectTree(`
Links
  [R] Holiday Destinations
  `);

  const holidaysLink = await screen.findByLabelText(
    "Navigate to Holiday Destinations"
  );
  expect(holidaysLink.getAttribute("href")).toMatch(/^\/d\//u);
  expect(window.getComputedStyle(holidaysLink).fontStyle).toBe("italic");

  await userEvent.click(holidaysLink);

  await expectTree(`
Holiday Destinations
  Spain
Pack List
  Charger
[I] Links
  `);

  cleanup();
});
