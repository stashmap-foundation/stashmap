import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderAppTree } from "../appTestUtils.test";
import {
  expectTree,
  getPane,
  navigateToNodeViaSearch,
  setDropIndentLevel,
  setDropIndentLevelForRows,
  textContent,
} from "../utils.test";
import {
  expectMarkdown,
  knowstrInit,
  knowstrSave,
  readNodeId,
  write,
} from "../testFixtures/workspace";
import { loadCliProfile } from "../cli/config";
import { buildDocumentRouteUrl, buildNodeRouteUrl } from "../navigationUrl";

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

async function renderNodeRoute(
  workspacePath: string,
  nodeId: ID
): Promise<void> {
  const profile = loadCliProfile({ cwd: workspacePath });
  await renderAppTree({
    path: workspacePath,
    initialRoute: buildNodeRouteUrl(nodeId, profile.pubkey),
  });
}

function savedNodeId(
  workspacePath: string,
  relativePath: string,
  needle: string
): ID {
  return readNodeId(workspacePath, relativePath, needle) as ID;
}

const titledMultiRootMarkdown = `---
title: First
---

# First

- one

# Second

- two
`;

function getPaneContainingTreeItem(
  itemName: string
): ReturnType<typeof within> {
  /* eslint-disable testing-library/no-node-access */
  const pane = Array.from(document.querySelectorAll("[data-pane-index]")).find(
    (candidate): candidate is HTMLElement =>
      candidate instanceof HTMLElement &&
      within(candidate).queryByRole("treeitem", { name: itemName }) !== null
  );
  /* eslint-enable testing-library/no-node-access */
  if (!pane) {
    throw new Error(`Expected a pane containing "${itemName}"`);
  }
  return within(pane);
}

function altDropFromPane0ToPane1(
  sourceName: string,
  targetName: string,
  targetDepth: number
): void {
  const source = getPane(0).getByRole("treeitem", { name: sourceName });
  const target = getPaneContainingTreeItem(targetName).getByRole("treeitem", {
    name: targetName,
  });
  setDropIndentLevelForRows(source, target, targetDepth);
  // eslint-disable-next-line testing-library/prefer-user-event
  fireEvent.keyDown(window, { key: "Alt", altKey: true });
  fireEvent.dragStart(source);
  fireEvent.dragOver(target, { altKey: true });
  fireEvent.drop(target, { altKey: true });
  fireEvent.dragEnd(source);
  // eslint-disable-next-line testing-library/prefer-user-event
  fireEvent.keyUp(window, { key: "Alt", altKey: false });
}

test("Graph route to a second document root shows the document breadcrumb", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "multi.md", titledMultiRootMarkdown);
  await knowstrSave(workspacePath);

  await renderNodeRoute(
    workspacePath,
    savedNodeId(workspacePath, "multi.md", "# Second")
  );

  await expectTree(`
Second
  two
  `);

  const breadcrumbs = await screen.findByRole("navigation", {
    name: "Navigation breadcrumbs",
  });
  await within(breadcrumbs).findByLabelText("Navigate to First");
  within(breadcrumbs).getByText("Second");

  cleanup();
});

test("Document breadcrumb from graph routes opens the document overview", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "multi.md", titledMultiRootMarkdown);
  await knowstrSave(workspacePath);

  await renderNodeRoute(
    workspacePath,
    savedNodeId(workspacePath, "multi.md", "# Second")
  );

  const breadcrumbs = await screen.findByRole("navigation", {
    name: "Navigation breadcrumbs",
  });
  await userEvent.click(
    await within(breadcrumbs).findByLabelText("Navigate to First")
  );

  await expectTree(`
First
  one
Second
  two
  `);

  cleanup();
});

test("Document breadcrumbs suppress duplicate document and first-root labels", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "multi.md", titledMultiRootMarkdown);
  await knowstrSave(workspacePath);

  await renderNodeRoute(
    workspacePath,
    savedNodeId(workspacePath, "multi.md", "one")
  );

  await expectTree(`
one
  `);

  expect(screen.queryByText(textContent("First/First/one"))).toBeNull();

  const breadcrumbs = await screen.findByRole("navigation", {
    name: "Navigation breadcrumbs",
  });
  await userEvent.click(
    await within(breadcrumbs).findByLabelText("Navigate to First")
  );

  await expectTree(`
First
  one
Second
  two
  `);

  cleanup();
});

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

  await expectMarkdown(
    workspacePath,
    "multi.md",
    `
# Holiday Destinations

- Spain
  - Barcelona

# Packlist

- Charger
`
  );

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
    Source
Packlist
  Charger
Source
  Child
  [I] Holiday Destinations / Spain ↩
  `);

  cleanup();
});

test("Dragging document top-level roots does not reorder or create refs", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "multi.md", "# First\n\n# Second\n\n# Third\n");

  await renderDocumentRoute(workspacePath, "multi.md");

  fireEvent.dragStart(getPane(0).getByRole("treeitem", { name: "First" }));
  const third = getPane(0).getByRole("treeitem", { name: "Third" });
  setDropIndentLevel("First", "Third", 2);
  fireEvent.dragOver(third);
  fireEvent.drop(third);

  await expectTree(`
First
Second
Third
  `);

  await expectMarkdown(
    workspacePath,
    "multi.md",
    `
# First

# Second

# Third
`
  );

  cleanup();
});

test("Dragging a document top-level root under another root is ignored", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "multi.md", "# Parent\n\n# Child Root\n\n# Third\n");

  await renderDocumentRoute(workspacePath, "multi.md");

  fireEvent.dragStart(getPane(0).getByRole("treeitem", { name: "Child Root" }));
  const parent = getPane(0).getByRole("treeitem", { name: "Parent" });
  setDropIndentLevel("Child Root", "Parent", 2);
  fireEvent.dragOver(parent);
  fireEvent.drop(parent);

  await expectTree(`
Parent
Child Root
Third
  `);

  await expectMarkdown(
    workspacePath,
    "multi.md",
    `
# Parent

# Child Root

# Third
`
  );

  cleanup();
});

test("Dragging a child to document top level is ignored", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "multi.md", "# First\n\n- one\n\n# Second\n");

  await renderDocumentRoute(workspacePath, "multi.md");

  fireEvent.dragStart(getPane(0).getByRole("treeitem", { name: "one" }));
  const documentPane = getPane(0).getByLabelText("Pane 0 content");
  fireEvent.dragOver(documentPane);
  fireEvent.drop(documentPane);

  await expectTree(`
First
  one
Second
  `);

  await expectMarkdown(
    workspacePath,
    "multi.md",
    `
# First

- one

# Second
`
  );

  cleanup();
});

test("Child-level drag inside a document root still works", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "multi.md", "# First\n\n- one\n- two\n\n# Second\n");

  await renderDocumentRoute(workspacePath, "multi.md");

  fireEvent.dragStart(getPane(0).getByRole("treeitem", { name: "one" }));
  const two = getPane(0).getByRole("treeitem", { name: "two" });
  setDropIndentLevel("one", "two", 2);
  fireEvent.dragOver(two);
  fireEvent.drop(two);

  await expectTree(`
First
  two
  one
Second
  `);

  await expectMarkdown(
    workspacePath,
    "multi.md",
    `
# First <!-- id:... -->

- two <!-- id:... -->
- one <!-- id:... -->

# Second <!-- id:... -->
`
  );

  cleanup();
});

test("Editing under the second top-level root persists to the same markdown file", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "multi.md", "# First\n\n- one\n\n# Second\n\n- two\n");

  await renderDocumentRoute(workspacePath, "multi.md");

  await expectTree(`
First
  one
Second
  two
  `);

  await userEvent.click(await screen.findByLabelText("edit two"));
  await userEvent.keyboard("{Enter}three{Escape}");

  await expectTree(`
First
  one
Second
  two
  three
  `);

  await expectMarkdown(
    workspacePath,
    "multi.md",
    `
# First <!-- id:... -->

- one <!-- id:... -->

# Second <!-- id:... -->

- two <!-- id:... -->
- three <!-- id:... -->
`
  );

  cleanup();
});

test("Editing the second top-level root text persists to the same markdown file", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "multi.md", "# First\n\n- one\n\n# Second\n\n- two\n");

  await renderDocumentRoute(workspacePath, "multi.md");

  const editor = await screen.findByLabelText("edit Second");
  await userEvent.click(editor);
  await userEvent.clear(editor);
  await userEvent.type(editor, "Updated Second{Escape}");

  await expectTree(`
First
  one
Updated Second
  two
  `);

  await expectMarkdown(
    workspacePath,
    "multi.md",
    `
# First <!-- id:... -->

- one <!-- id:... -->

# Updated Second <!-- id:... -->

- two <!-- id:... -->
`
  );

  cleanup();
});

test("Setting relevance on the second top-level root persists to markdown", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "multi.md", "# First\n\n# Second\n\n- child\n");

  await renderDocumentRoute(workspacePath, "multi.md");
  fireEvent.click(await screen.findByLabelText("set Second to relevant"));

  await screen.findByLabelText("Relevant for Second");
  await expectMarkdown(
    workspacePath,
    "multi.md",
    `
# First <!-- id:... -->

# (!) Second <!-- id:... -->

- child <!-- id:... -->
`
  );

  cleanup();
});

test("Setting argument on a top-level root persists to markdown", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "multi.md", "# First\n\n# Second\n\n- child\n");

  await renderDocumentRoute(workspacePath, "multi.md");
  fireEvent.click(
    await screen.findByLabelText("Evidence for Second: No evidence type")
  );

  await screen.findByLabelText("Evidence for Second: Confirms");
  await expectMarkdown(
    workspacePath,
    "multi.md",
    `
# First <!-- id:... -->

# (+) Second <!-- id:... -->

- child <!-- id:... -->
`
  );

  cleanup();
});

test("Editing top-level root text keeps the same node id", async () => {
  const { path: workspacePath } = knowstrInit();
  const secondId = "22222222-2222-4222-8222-222222222222";
  write(
    workspacePath,
    "multi.md",
    `# First <!-- id:11111111-1111-4111-8111-111111111111 -->\n\n# Second <!-- id:${secondId} -->\n\n- child <!-- id:33333333-3333-4333-8333-333333333333 -->\n`
  );

  await renderDocumentRoute(workspacePath, "multi.md");
  const editor = await screen.findByLabelText("edit Second");
  await userEvent.click(editor);
  await userEvent.clear(editor);
  await userEvent.type(editor, "Updated Second{Escape}");

  await expectMarkdown(
    workspacePath,
    "multi.md",
    `
# First <!-- id:... -->

# Updated Second <!-- id:... -->

- child <!-- id:... -->
`
  );
  expect(readNodeId(workspacePath, "multi.md", "# Updated Second")).toBe(
    secondId
  );

  cleanup();
});

test("Deleting the first top-level root keeps the document with remaining roots", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "multi.md", "# First\n\n- one\n\n# Second\n\n- two\n");

  await renderDocumentRoute(workspacePath, "multi.md");
  await userEvent.click(await screen.findByLabelText("edit First"));
  await userEvent.keyboard("{Escape}{Delete}");

  await expectTree(`
Second
  two
  `);

  await expectMarkdown(
    workspacePath,
    "multi.md",
    `
# Second <!-- id:... -->

- two <!-- id:... -->
`
  );

  cleanup();
});

test("Deleting the second top-level root keeps the document with remaining roots", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "multi.md", "# First\n\n- one\n\n# Second\n\n- two\n");

  await renderDocumentRoute(workspacePath, "multi.md");
  await userEvent.click(await screen.findByLabelText("edit Second"));
  await userEvent.keyboard("{Escape}{Delete}");

  await expectTree(`
First
  one
  `);

  await expectMarkdown(
    workspacePath,
    "multi.md",
    `
# First <!-- id:... -->

- one <!-- id:... -->
`
  );

  cleanup();
});

test("Deleting the last top-level root removes the document file", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "only.md", "# Only\n\n- child\n");

  await renderDocumentRoute(workspacePath, "only.md");
  await userEvent.click(await screen.findByLabelText("edit Only"));
  await userEvent.keyboard("{Escape}{Delete}");

  await expectMarkdown(workspacePath, "only.md", "");
  await waitFor(() => {
    expect(screen.queryByText("Only")).toBeNull();
    expect(screen.queryByText("child")).toBeNull();
  });

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

  await expectTree(`
Holiday Destinations
  Spain
Packlist
  Charger
Target
  Drop here
  `);

  altDropFromPane0ToPane1("Holiday Destinations", "Target", 2);

  await expectTree(`
Holiday Destinations
  Spain
  [I] Target ↩
Packlist
  Charger
Target
  Holiday Destinations
  Drop here
  `);

  altDropFromPane0ToPane1("Packlist", "Target", 2);

  await expectTree(`
Holiday Destinations
  Spain
  [I] Target ↩
Packlist
  Charger
  [I] Target ↩
Target
  Packlist
  Holiday Destinations
  Drop here
  `);

  cleanup();
  await renderDocumentRoute(workspacePath, "multi.md");
  await navigateToNodeViaSearch(0, "Target");

  await expectTree(`
Target
  Packlist
  Holiday Destinations
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
  Spain
  `);

  cleanup();
  await renderDocumentRoute(workspacePath, "holidays.md");
  await navigateToNodeViaSearch(0, "My Links");

  await expectTree(`
My Links
  Spain
  `);

  cleanup();
});

test("Deep-copying a node with graph refs keeps the copied ref live in markdown", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "graph.md", "# Source\n\n# Target\n\n# Copy Here\n");

  await renderDocumentRoute(workspacePath, "graph.md");
  await userEvent.click(
    (
      await screen.findAllByLabelText("open in split pane")
    )[0]
  );
  await navigateToNodeViaSearch(1, "Source");

  await userEvent.keyboard("{Alt>}");
  fireEvent.dragStart(getPane(0).getByRole("treeitem", { name: "Target" }));
  const source = getPane(1).getByRole("treeitem", { name: "Source" });
  setDropIndentLevel("Target", "Source", 2);
  fireEvent.dragOver(source, { altKey: true });
  fireEvent.drop(source, { altKey: true });
  await userEvent.keyboard("{/Alt}");

  await expectTree(`
Source
  Target
Target
  [I] Source ↩
Copy Here
Source
  Target
  `);

  await navigateToNodeViaSearch(1, "Copy Here");
  fireEvent.dragStart(
    getPane(0).getAllByRole("treeitem", { name: "Source" })[0]
  );
  const copyHere = getPane(1).getByRole("treeitem", { name: "Copy Here" });
  setDropIndentLevel("Source", "Copy Here", 2);
  fireEvent.dragOver(copyHere);
  fireEvent.drop(copyHere);
  await userEvent.click(await getPane(1).findByLabelText("expand Source"));

  await expectTree(`
Source
  Target
Target
  [I] Copy Here / Source ↩
  [I] Source ↩
Copy Here
  Source
Copy Here
  Source
    Target
  `);

  const targetId = readNodeId(workspacePath, "graph.md", "# Target");
  await expectMarkdown(
    workspacePath,
    "graph.md",
    `
# Source <!-- id:... -->

- [Target](#${targetId}) <!-- id:... -->

# Target <!-- id:... -->

# Copy Here <!-- id:... -->

- Source <!-- id:... basedOn="..." -->
  - [Target](#${targetId}) <!-- id:... basedOn="..." -->
`
  );

  cleanup();
});

test("Relative file links under the second top-level root resolve and show incoming refs", async () => {
  const { path: workspacePath } = knowstrInit();
  write(
    workspacePath,
    "docs/a.md",
    "# First\n\n- one\n\n# Second\n\n- [Open B](./b.md)\n"
  );
  write(workspacePath, "docs/b.md", "# B\n\n- B-child\n");

  await renderDocumentRoute(workspacePath, "docs/a.md");

  await expectTree(`
First
  one
Second
  Open B
  `);

  const bLink = await screen.findByRole("link", { name: "Open B" });
  expect(bLink.getAttribute("data-href")).toMatch(/b\.md$/u);
  await userEvent.click(bLink);

  await expectTree(`
B
  B-child
  [I] Second ↩
  `);

  cleanup();
});

test("Graph links under the second top-level root resolve and show incoming refs", async () => {
  const { path: workspacePath } = knowstrInit();
  const targetId = "22222222-2222-4222-8222-222222222222";
  write(
    workspacePath,
    "source.md",
    `# First\n\n- one\n\n# Second\n\n- [Target](#${targetId})\n`
  );
  write(
    workspacePath,
    "target.md",
    `# Target <!-- id:${targetId} -->\n\n- Target child\n`
  );

  await renderDocumentRoute(workspacePath, "source.md");

  await expectTree(`
First
  one
Second
  Target
  `);

  const targetLink = await screen.findByRole("link", { name: "Target" });
  expect(targetLink.getAttribute("data-href")).toBe(`#${targetId}`);
  await userEvent.click(targetLink);

  await expectTree(`
Target
  Target child
  [I] Second ↩
  `);

  cleanup();
});

test("Top-level file-link roots render as document links and incoming refs", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "files.md", "[Holidays](./holidays.md)\n");
  write(workspacePath, "holidays.md", "# Holiday Destinations\n\n- Spain\n");

  await renderDocumentRoute(workspacePath, "files.md");

  await expectTree(`
Holidays
  `);

  const holidaysLink = await screen.findByRole("link", { name: "Holidays" });
  expect(holidaysLink.getAttribute("data-href")).toMatch(/holidays\.md$/u);
  await userEvent.click(holidaysLink);

  await expectTree(`
Holiday Destinations
  Spain
  [I] Holidays ↩
  `);

  cleanup();
});

test("Top-level graph-link roots render as graph refs and incoming refs", async () => {
  const { path: workspacePath } = knowstrInit();
  const targetId = "22222222-2222-4222-8222-222222222222";
  write(workspacePath, "links.md", `[Target](#${targetId})\n`);
  write(
    workspacePath,
    "target.md",
    `# Target <!-- id:${targetId} -->\n\n- Target child\n`
  );

  await renderDocumentRoute(workspacePath, "links.md");

  await expectTree(`
Target
  `);

  const targetLink = await screen.findByRole("link", { name: "Target" });
  expect(targetLink.getAttribute("data-href")).toBe(`#${targetId}`);
  await userEvent.click(targetLink);

  await expectTree(`
Target
  Target child
  [I] Target ↩
  `);

  cleanup();
});

test("Mutual file links show outgoing from both sides without duplicate incoming refs", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "files.md", "# Links\n\n- [Holidays](./holidays.md)\n");
  write(
    workspacePath,
    "holidays.md",
    "# Holiday Destinations\n\n- [Files](./files.md)\n"
  );

  await renderDocumentRoute(workspacePath, "holidays.md");

  await expectTree(`
Holiday Destinations
  Files↩
  `);

  cleanup();
  await renderDocumentRoute(workspacePath, "files.md");

  await expectTree(`
Links
  Holidays↩
  `);

  cleanup();
});

test("Mutual graph links show each source row and its incoming edge", async () => {
  const { path: workspacePath } = knowstrInit();
  const aId = "11111111-1111-4111-8111-111111111111";
  const bId = "22222222-2222-4222-8222-222222222222";
  write(workspacePath, "a.md", `# A <!-- id:${aId} -->\n\n- [B](#${bId})\n`);
  write(workspacePath, "b.md", `# B <!-- id:${bId} -->\n\n- [A](#${aId})\n`);

  await renderDocumentRoute(workspacePath, "a.md");

  await expectTree(`
A
  B↩
  `);

  cleanup();
  await renderDocumentRoute(workspacePath, "b.md");

  await expectTree(`
B
  A↩
  `);

  cleanup();
});

test("Graph incoming refs can become bidirectional from both sides", async () => {
  const { path: workspacePath } = knowstrInit();
  const targetId = "22222222-2222-4222-8222-222222222222";
  write(workspacePath, "source.md", `# Source\n\n- [Target](#${targetId})\n`);
  write(
    workspacePath,
    "target.md",
    `# Target <!-- id:${targetId} -->\n\n- Target child\n`
  );

  await renderDocumentRoute(workspacePath, "target.md");

  await expectTree(`
Target
  Target child
  [I] Source ↩
  `);

  await userEvent.click(getPane(0).getByRole("treeitem", { name: "Source ↩" }));
  await userEvent.keyboard("!");

  await expectTree(`
Target
  Target child
  Source↩
  `);

  await userEvent.click(await screen.findByRole("link", { name: "Source" }));

  await expectTree(`
Source
  Target!↩
  `);

  cleanup();
});

test("Bidirectional graph link labels keep endpoint paths intact", async () => {
  const { path: workspacePath } = knowstrInit();
  const spainId = "22222222-2222-4222-8222-222222222222";
  write(
    workspacePath,
    "holidays.md",
    `# Holiday Destinations\n\n- Spain <!-- id:${spainId} -->\n  - Barcelona\n`
  );
  write(
    workspacePath,
    "countries.md",
    `# Southern European Countries\n\n- [Spain](#${spainId})\n`
  );

  await renderDocumentRoute(workspacePath, "countries.md");

  await expectTree(`
Southern European Countries
  Spain
  `);

  cleanup();
  await renderDocumentRoute(workspacePath, "holidays.md");
  await userEvent.click(await screen.findByLabelText("expand Spain"));

  await expectTree(`
Holiday Destinations
  Spain
    Barcelona
    [I] Southern European Countries ↩
  `);

  await userEvent.click(
    getPane(0).getByRole("treeitem", {
      name: "Southern European Countries ↩",
    })
  );
  await userEvent.keyboard("!");

  await expectTree(
    `
Holiday Destinations
  Spain
    Barcelona
    {!} Southern European Countries↩
  `,
    { showGutter: true }
  );

  cleanup();
  await renderDocumentRoute(workspacePath, "countries.md");

  await expectTree(`
Southern European Countries
  Spain!↩
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

  const sourceLink = getPane(0).getByText("Open B");
  const myLinks = getPane(1).getByRole("treeitem", { name: "My Links" });

  fireEvent.dragStart(sourceLink);
  setDropIndentLevel("Open B", "My Links", 2);
  fireEvent.dragOver(myLinks);
  fireEvent.drop(myLinks);

  await expectTree(`
A
  Open B
My Links
  Open B
  `);

  await expectMarkdown(
    workspacePath,
    "links.md",
    `
# My Links <!-- id:... -->

- [Open B](./b.md) <!-- id:... -->
`
  );

  const copiedLink = await getPane(1).findByRole("link", { name: "Open B" });
  expect(copiedLink.getAttribute("data-href")).toMatch(/b\.md$/u);

  cleanup();
  await renderDocumentRoute(workspacePath, "a.md");
  await navigateToNodeViaSearch(0, "My Links");

  await expectTree(`
My Links
  Open B
  `);

  const reloadedLink = await getPane(0).findByRole("link", {
    name: "Open B",
  });
  expect(reloadedLink.getAttribute("data-href")).toMatch(/b\.md$/u);
  await userEvent.click(reloadedLink);

  await expectTree(`
B
  B-child
  [I] A ↩
  [I] My Links ↩
  `);

  cleanup();
});

test("Dragging a document search result creates a document link", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "holidays.md", "# Holiday Destinations\n\n- Spain\n");
  write(workspacePath, "links.md", "# My Links\n");

  await renderDocumentRoute(workspacePath, "links.md");
  await userEvent.click(
    (
      await screen.findAllByLabelText("open in split pane")
    )[0]
  );

  await userEvent.click(
    await screen.findByLabelText("Search to change pane 1 content")
  );
  await userEvent.type(
    await screen.findByLabelText("search input"),
    "Holiday Destinations{Enter}"
  );

  const searchResult = await getPane(1).findByRole("treeitem", {
    name: "Holiday Destinations",
  });
  const myLinks = getPane(0).getByRole("treeitem", { name: "My Links" });

  fireEvent.dragStart(searchResult);
  setDropIndentLevel("Holiday Destinations", "My Links", 2);
  fireEvent.dragOver(myLinks);
  fireEvent.drop(myLinks);

  await expectMarkdown(
    workspacePath,
    "links.md",
    `
# My Links <!-- id:... -->

- [Holiday Destinations](holidays.md) <!-- id:... -->
`
  );

  const copiedLink = await getPane(0).findByRole("link", {
    name: "Holiday Destinations",
  });
  expect(copiedLink.getAttribute("data-href")).toMatch(/holidays\.md$/u);

  cleanup();
});

test("Document file links are dotted-underlined and incoming refs render at document level", async () => {
  const { path: workspacePath } = knowstrInit();
  write(
    workspacePath,
    "holidays.md",
    "- Holiday Destinations\n  - Spain\n- Pack List\n  - Charger\n"
  );
  write(workspacePath, "files.md", "- Links\n  - [Holidays](./holidays.md)\n");

  await renderDocumentRoute(workspacePath, "files.md");

  await expectTree(`
Links
  Holidays
  `);

  const holidaysLink = await screen.findByRole("link", { name: "Holidays" });
  expect(holidaysLink.getAttribute("data-href")).toMatch(/holidays\.md$/u);
  const holidaysEditor = await screen.findByRole("textbox", {
    name: "edit Holidays",
  });
  expect(window.getComputedStyle(holidaysLink).fontStyle).toBe("");
  expect(holidaysLink.style.textDecorationLine).toBe("underline");
  expect(holidaysLink.style.textDecorationStyle).toBe("dotted");
  expect(holidaysLink.style.textDecorationThickness).toBe("1px");
  expect(holidaysLink.style.textUnderlineOffset).toBe("3px");
  expect(holidaysLink.style.textDecorationColor).toBe("var(--base01)");
  expect(window.getComputedStyle(holidaysEditor).fontStyle).toBe("");

  await userEvent.click(holidaysLink);

  await expectTree(`
Holiday Destinations
  Spain
  [I] Links ↩
Pack List
  Charger
  `);

  await userEvent.click(await screen.findByLabelText("Navigate to Links ↩"));

  await expectTree(`
Links
  Holidays
  `);

  cleanup();
});

test("Document file link row actions open the source row", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "files.md", "# Links\n\n[Holidays](./holidays.md)\n");
  write(
    workspacePath,
    "holidays.md",
    "# Holiday Destinations\n\nSpain\n\n# Pack List\n\n- Charger\n"
  );

  await renderDocumentRoute(workspacePath, "files.md");

  const holidaysLink = await screen.findByRole("link", { name: "Holidays" });
  expect(holidaysLink).toBeTruthy();
  const splitButtons = await screen.findAllByLabelText("open in split pane");
  await userEvent.click(splitButtons[splitButtons.length - 1]);

  await expectTree(`
Links
  Holidays
Holidays
  `);

  cleanup();
  await renderDocumentRoute(workspacePath, "files.md");

  const reloadedLink = await screen.findByRole("link", { name: "Holidays" });
  expect(reloadedLink).toBeTruthy();
  await userEvent.click(
    await screen.findByLabelText("open Holidays in fullscreen")
  );

  await expectTree(`
Holidays
  `);

  cleanup();
});

test("Document heading file link incoming refs can become bidirectional", async () => {
  const { path: workspacePath } = knowstrInit();
  write(
    workspacePath,
    "holidays.md",
    "# Holiday Destinations\n\nSpain\n\n# Pack List\n\n- Charger\n"
  );
  write(workspacePath, "files.md", "# Links\n\n[Holidays](./holidays.md)\n");

  await renderDocumentRoute(workspacePath, "holidays.md");

  await expectTree(`
Holiday Destinations
  Spain
  [I] Links ↩
Pack List
  Charger
  `);

  const incomingRow = getPane(0).getByRole("treeitem", {
    name: "Links ↩",
  });
  const sourceRowId = incomingRow.getAttribute("data-node-id");
  if (!sourceRowId) throw new Error("Incoming source id missing");
  await userEvent.click(incomingRow);
  await userEvent.keyboard("!");

  await userEvent.click(await screen.findByRole("link", { name: "Links" }));

  await expectTree(`
Links
  Holidays!↩
  `);

  await expectMarkdown(
    workspacePath,
    "files.md",
    `
# Links <!-- id:... -->

[Holidays](./holidays.md) <!-- id:... -->
`
  );

  await expectMarkdown(
    workspacePath,
    "holidays.md",
    `
# Holiday Destinations <!-- id:... -->

Spain <!-- id:... -->

- (!) [Links](#${sourceRowId}) <!-- id:... -->

# Pack List <!-- id:... -->

- Charger <!-- id:... -->
`
  );

  cleanup();
  await renderDocumentRoute(workspacePath, "holidays.md");
  await screen.findByRole("link", { name: "Links" });

  cleanup();
});

test("Document list file link incoming refs can become bidirectional", async () => {
  const { path: workspacePath } = knowstrInit();
  write(
    workspacePath,
    "holidays.md",
    "- Holiday Destinations\n  - Spain\n- Pack List\n  - Charger\n"
  );
  write(workspacePath, "files.md", "- Links\n  - [Holidays](./holidays.md)\n");

  await renderDocumentRoute(workspacePath, "holidays.md");

  await expectTree(`
Holiday Destinations
  Spain
  [I] Links ↩
Pack List
  Charger
  `);

  const incomingRow = getPane(0).getByRole("treeitem", {
    name: "Links ↩",
  });
  const sourceRowId = incomingRow.getAttribute("data-node-id");
  if (!sourceRowId) throw new Error("Incoming source id missing");
  await userEvent.click(incomingRow);
  await userEvent.keyboard("!");

  await userEvent.click(await screen.findByRole("link", { name: "Links" }));

  await expectTree(`
Links
  Holidays!↩
  `);

  await expectMarkdown(
    workspacePath,
    "files.md",
    `
- Links <!-- id:... -->
  - [Holidays](./holidays.md) <!-- id:... -->
`
  );

  await expectMarkdown(
    workspacePath,
    "holidays.md",
    `
- Holiday Destinations <!-- id:... -->
  - Spain <!-- id:... -->
  - (!) [Links](#${sourceRowId}) <!-- id:... -->
- Pack List <!-- id:... -->
  - Charger <!-- id:... -->
`
  );

  cleanup();
  await renderDocumentRoute(workspacePath, "holidays.md");
  await screen.findByRole("link", { name: "Links" });

  cleanup();
});
