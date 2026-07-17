import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import {
  ALICE,
  BOB,
  expectTree,
  findNewNodeEditor,
  forkOwnRoot,
  forkReadonlyRoot,
  getPane,
  navigateToNodeViaSearch,
  renderApp,
  renderTree,
  setup,
  type,
  type UpdateState,
  requireUser,
} from "../utils.test";
import {
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT,
} from "../nostr";
import { findTag } from "../nostrEvents";
import { parseMarkdown, type MarkdownTreeNode } from "../core/markdownTree";

const maybeExpand = async (label: string): Promise<void> => {
  const btn = screen.queryByLabelText(label);
  if (btn) {
    await userEvent.click(btn);
  }
};

const getDropTargets = (nodeName: string): HTMLElement[] => {
  const toggleTargets = screen.queryAllByLabelText(
    new RegExp(`(?:expand|collapse) ${nodeName}`)
  );
  if (toggleTargets.length > 0) {
    return toggleTargets as HTMLElement[];
  }
  return screen.getAllByRole("treeitem", { name: nodeName }) as HTMLElement[];
};

const createForkedMyNotesVersion = async (
  alice: UpdateState,
  aliceInput: string,
  forkRootInput: string
): Promise<void> => {
  renderTree(alice);
  await type(aliceInput);
  cleanup();

  await forkOwnRoot(alice, "My Notes", "My Fork");
  renderTree(alice);
  await navigateToNodeViaSearch(0, "My Fork");
  await userEvent.click(await screen.findByLabelText("edit My Fork"));
  await userEvent.keyboard("{Enter}");
  await type(forkRootInput);
  cleanup();
};

describe("Deep Copy - Tab Indent", () => {
  test("Tab indent skips hidden not_relevant sibling", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}NodeA{Enter}Hidden{Enter}Sibling{Escape}");

    await expectTree(`
My Notes
  NodeA
  Hidden
  Sibling
    `);

    // Mark Hidden as not relevant - it disappears from view
    fireEvent.click(screen.getByLabelText("mark Hidden as not relevant"));
    await screen.findByText("Sibling");
    expect(screen.queryByText("Hidden")).toBeNull();

    await expectTree(`
My Notes
  NodeA
  Sibling
    `);

    // Tab on Sibling should indent under NodeA (the visible previous sibling),
    // NOT under the hidden "Hidden" node
    const siblingEditor = await screen.findByLabelText("edit Sibling");
    await userEvent.click(siblingEditor);
    await userEvent.keyboard("{Home}{Tab}");

    await expectTree(`
My Notes
  NodeA
    Sibling
    `);
  });

  test("Tab indent preserves children of moved node", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "My Notes{Enter}{Tab}Sibling{Enter}Parent{Enter}{Tab}GrandChild{Escape}"
    );

    await expectTree(`
My Notes
  Sibling
  Parent
    GrandChild
    `);

    // Tab on Parent to move under Sibling (previous sibling)
    const parentEditor = await screen.findByLabelText("edit Parent");
    await userEvent.click(parentEditor);
    await userEvent.keyboard("{Home}{Tab}");

    await expectTree(`
My Notes
  Sibling
    Parent
      GrandChild
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
My Notes
  Sibling
    Parent
      GrandChild
    `);
  });

  test("Tab indent preserves text edits", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}Sibling{Enter}Sibling 2{Escape}");

    await expectTree(`
My Notes
  Sibling
  Sibling 2
    `);

    // Edit "Sibling 2" to "Child" and Tab to indent
    const sibling2Editor = await screen.findByLabelText("edit Sibling 2");
    await userEvent.click(sibling2Editor);
    await userEvent.clear(sibling2Editor);
    await userEvent.type(sibling2Editor, "Child");
    await userEvent.keyboard("{Home}{Tab}");

    await expectTree(`
My Notes
  Sibling
    Child
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
My Notes
  Sibling
    Child
    `);
  });

  test("Tab indent copies collapsed children after reload", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "My Notes{Enter}{Tab}Sibling{Enter}Parent{Enter}{Tab}Child{Enter}{Tab}GrandChild{Escape}"
    );

    await expectTree(`
My Notes
  Sibling
  Parent
    Child
      GrandChild
    `);

    // Collapse Parent and reload
    await userEvent.click(await screen.findByLabelText("collapse Parent"));
    cleanup();
    renderTree(alice);

    await expectTree(`
My Notes
  Sibling
  Parent
    `);

    // Tab on Parent to move under Sibling
    const parentEditor = await screen.findByLabelText("edit Parent");
    await userEvent.click(parentEditor);
    await userEvent.keyboard("{Home}{Tab}");

    // Expand Parent - Child should already be expanded (view state preserved)
    await userEvent.click(await screen.findByLabelText("expand Parent"));

    await expectTree(`
My Notes
  Sibling
    Parent
      Child
        GrandChild
    `);
  });

  test("Tab indent preserves node URL for deeply nested descendants", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "My Notes{Enter}{Tab}Sibling{Enter}Parent{Enter}{Tab}Child{Enter}{Tab}GrandChild{Escape}"
    );

    await expectTree(`
My Notes
  Sibling
  Parent
    Child
      GrandChild
    `);

    const fullscreenLink = await screen.findByLabelText(
      "open Child in fullscreen"
    );
    const nodeUrl = fullscreenLink.getAttribute("href");
    expect(nodeUrl).toMatch(/^\/local\/n\//);

    const parentEditor = await screen.findByLabelText("edit Parent");
    await userEvent.click(parentEditor);
    await userEvent.keyboard("{Home}{Tab}");

    await expectTree(`
My Notes
  Sibling
    Parent
      Child
        GrandChild
    `);

    cleanup();

    renderApp({ ...alice(), initialRoute: nodeUrl as string });

    await expectTree(`
Child
  GrandChild
    `);
  });

  test("Shift-Tab outdent preserves node URL for deeply nested descendants", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "My Notes{Enter}{Tab}Outer{Enter}{Tab}Inner{Enter}{Tab}Child{Enter}{Tab}GrandChild{Escape}"
    );

    await expectTree(`
My Notes
  Outer
    Inner
      Child
        GrandChild
    `);

    const fullscreenLink = await screen.findByLabelText(
      "open Child in fullscreen"
    );
    const nodeUrl = fullscreenLink.getAttribute("href");
    expect(nodeUrl).toMatch(/^\/local\/n\//);

    const innerEditor = await screen.findByLabelText("edit Inner");
    await userEvent.click(innerEditor);
    await userEvent.keyboard("{Home}{Shift>}{Tab}{/Shift}");

    await expectTree(`
My Notes
  Outer
  Inner
    Child
      GrandChild
    `);

    cleanup();

    renderApp({ ...alice(), initialRoute: nodeUrl as string });

    await expectTree(`
Child
  GrandChild
    `);
  });

  test("Tab indent cleans up old descendant search paths", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type(
      "Notes{Enter}{Tab}Sibling{Enter}Cities{Enter}{Tab}Barcelona{Escape}"
    );

    await userEvent.click(
      await screen.findByLabelText("Search to change pane 0 content")
    );
    await userEvent.type(
      await screen.findByLabelText("search input"),
      "Barcelona{Enter}"
    );

    await expectTree(`
Search: Barcelona
  [R] Notes / Cities / Barcelona
    `);

    cleanup();
    renderApp(alice());

    await navigateToNodeViaSearch(0, "Notes");
    await maybeExpand("expand Cities");

    const citiesEditors = screen.getAllByLabelText("edit Cities");
    await userEvent.click(citiesEditors[citiesEditors.length - 1]);
    await userEvent.keyboard("{Home}{Tab}");

    await expectTree(`
Notes
  Sibling
    Cities
      Barcelona
    `);

    await userEvent.click(
      await screen.findByLabelText("Search to change pane 0 content")
    );
    await userEvent.type(
      await screen.findByLabelText("search input"),
      "Barcelona{Enter}"
    );

    await expectTree(`
Search: Barcelona
  [R] Notes / Sibling / Cities / Barcelona
    `);
  });

  test("Shift-Tab outdent cleans up old descendant search paths", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type(
      "Notes{Enter}{Tab}Parent{Enter}{Tab}Child{Enter}{Tab}Barcelona{Escape}"
    );

    await userEvent.click(
      await screen.findByLabelText("Search to change pane 0 content")
    );
    await userEvent.type(
      await screen.findByLabelText("search input"),
      "Barcelona{Enter}"
    );

    await expectTree(`
Search: Barcelona
  [R] Notes / Parent / Child / Barcelona
    `);

    cleanup();
    renderApp(alice());

    await navigateToNodeViaSearch(0, "Notes");
    await maybeExpand("expand Parent");
    await maybeExpand("expand Child");

    const childEditor = screen.getAllByLabelText("edit Child")[0];
    await userEvent.click(childEditor);
    await userEvent.keyboard("{Home}{Shift>}{Tab}{/Shift}");

    await expectTree(`
Notes
  Parent
  Child
    Barcelona
    `);

    await userEvent.click(
      await screen.findByLabelText("Search to change pane 0 content")
    );
    await userEvent.type(
      await screen.findByLabelText("search input"),
      "Barcelona{Enter}"
    );

    await expectTree(`
Search: Barcelona
  [R] Notes / Child / Barcelona
    `);
  });
});

describe("Deep Copy - Cross-Pane DnD", () => {
  test("Cross-pane drag deep copies node with children", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type(
      "My Notes{Enter}{Tab}Source{Enter}{Tab}Child A{Enter}Child B{Escape}"
    );

    await expectTree(`
My Notes
  Source
    Child A
    Child B
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Source");

    // Drag Child A from pane 1 to My Notes in pane 0 (cross-pane = copy)
    const childAs = screen.getAllByText("Child A");
    fireEvent.dragStart(childAs[childAs.length - 1]);
    fireEvent.drop(screen.getAllByLabelText("collapse My Notes")[0]);

    await expectTree(`
My Notes
  Child A
  Source
    Child A
    Child B
Source
  Child A
  Child B
    `);
  });

  test("Cross-pane drag deep copies entire subtree including grandchildren", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type(
      "My Notes{Enter}{Tab}Parent{Enter}{Tab}Child{Enter}{Tab}GrandChild{Escape}"
    );

    // Add Target as sibling to Parent (collapse Parent first so Enter creates sibling)
    await userEvent.click(await screen.findByLabelText("collapse Parent"));
    const parentEditor = await screen.findByLabelText("edit Parent");
    await userEvent.click(parentEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Target{Escape}");
    // Re-expand Parent
    await userEvent.click(await screen.findByLabelText("expand Parent"));

    await maybeExpand("expand Target");

    await expectTree(`
My Notes
  Parent
    Child
      GrandChild
  Target
    `);

    // Open split pane and navigate to Target
    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    // Use toggle buttons as drop targets - they only exist in tree children, not breadcrumbs
    // Target in pane 0 has expand, Target in pane 1 has collapse (root expanded by default but no children yet)
    const targetDropTargets = getDropTargets("Target");

    // Drag Parent from pane 0 to Target in pane 1 (cross-pane = deep copy)
    fireEvent.dragStart(screen.getAllByText("Parent")[0]);
    fireEvent.drop(targetDropTargets[1]);

    // Parent with Child and GrandChild should be deep copied under Target
    // Pane 1 shows Target as root
    await expectTree(`
My Notes
  Parent
    Child
      GrandChild
  Target
Target
  Parent
    Child
      GrandChild
    `);
  });

  // The problem here is that Target is opened with My Notes in the context again. So both targets are [My Notes -> Context], therefore updating one, updates the other
  // Need to be able to open target in its own context, which is not possible right now
  test.skip("Cross-pane drag overwrites existing children with new copy", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("My Notes{Enter}{Tab}Source{Enter}{Tab}Child{Escape}");

    // Collapse Source, create Target as sibling
    await userEvent.click(await screen.findByLabelText("collapse Source"));
    const sourceEditor = await screen.findByLabelText("edit Source");
    await userEvent.click(sourceEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Target{Enter}{Tab}Source{Enter}{Tab}Another Child{Escape}"
    );

    // Re-expand Source under My Notes
    await userEvent.click(await screen.findByLabelText("expand Source"));

    await expectTree(`
My Notes
  Source
    Child
  Target
    Source
      Another Child
    `);

    // Open split pane and navigate to Target
    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");
    await screen.findByLabelText("collapse Target");

    // Drag Source from pane 0 to Target in pane 1
    // Use toggle buttons as drop targets - they only exist in tree children, not breadcrumbs
    const targetDropTargets = getDropTargets("Target");
    fireEvent.dragStart(screen.getAllByText("Source")[0]);
    fireEvent.drop(targetDropTargets[1]);

    // After DnD, Target shows Source with Child (from new copy)
    // not Another Child (the old node is overwritten in view)
    await expectTree(`
My Notes
  Source
    Child
  Target
    Source
      Another Child
Target
  Source
    Child
    `);
  });
});

describe("Deep Copy - Suggestion DnD", () => {
  test("A1: Same-pane DnD suggestion as sibling accepts and removes suggestion", async () => {
    const [alice] = setup([ALICE]);
    await createForkedMyNotesVersion(
      alice,
      "My Notes{Enter}{Tab}Target{Escape}",
      "BobItem{Escape}"
    );

    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");

    await expectTree(`
My Fork
  BobItem
  Target
    `);

    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");

    await expectTree(`
My Notes
  Target
  [S] BobItem
  [S] My Notes My Fork
    `);

    fireEvent.dragStart(screen.getByText("BobItem"));
    fireEvent.drop(screen.getByLabelText("collapse My Notes"));

    await expectTree(`
My Notes
  BobItem
  Target
  [S] My Notes My Fork
    `);
  });

  test("A2: Cross-pane DnD suggestion into expanded node with no children", async () => {
    const [alice] = setup([ALICE]);
    await createForkedMyNotesVersion(
      alice,
      "My Notes{Enter}{Tab}Target{Escape}",
      "BobItem{Escape}"
    );

    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");

    await expectTree(`
My Fork
  BobItem
  Target
    `);

    cleanup();

    window.history.pushState({}, "", "/");
    renderApp(alice());
    await navigateToNodeViaSearch(0, "My Notes");
    await maybeExpand("expand Target");

    await expectTree(`
My Notes
  Target
  [S] BobItem
  [S] My Notes My Fork
    `);

    // Open split pane and navigate to Target
    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    // Drag [S] BobItem from pane 0 to Target in pane 1
    // Use toggle buttons as drop targets - they only exist in tree children, not breadcrumbs
    const bobItemElements = screen.getAllByText("BobItem");
    const targetDropTargets = getDropTargets("Target");
    fireEvent.dragStart(bobItemElements[0]);
    fireEvent.drop(targetDropTargets[1]);

    // BobItem should appear under Target (as child) without [S] prefix
    // Original [S] BobItem remains in pane 0 (cross-pane copies, doesn't move)
    await expectTree(`
My Notes
  Target
  [S] BobItem
  [S] My Notes My Fork
Target
  BobItem
    `);
  });

  test("B1: Same-pane DnD suggestion with collapsed children deep copies all including grandchildren", async () => {
    const [alice] = setup([ALICE]);
    await createForkedMyNotesVersion(
      alice,
      "My Notes{Enter}{Tab}Target{Escape}",
      "Folder{Enter}{Tab}Child{Enter}{Tab}GrandChild1{Enter}GrandChild2{Escape}"
    );

    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");

    await expectTree(`
My Fork
  Folder
    Child
      GrandChild1
      GrandChild2
  Target
    `);

    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");

    // [S] Folder is collapsed by default
    await expectTree(`
My Notes
  Target
  [S] Folder
  [S] My Notes My Fork
    `);

    fireEvent.dragStart(screen.getByText("Folder"));
    fireEvent.drop(screen.getByLabelText("collapse My Notes"));

    await expectTree(`
My Notes
  Folder
  Target
  [S] My Notes My Fork
    `);

    // Expand Folder to verify Child was deep copied
    await userEvent.click(await screen.findByLabelText("expand Folder"));

    await expectTree(`
My Notes
  Folder
    Child
  Target
  [S] My Notes My Fork
    `);

    // Expand Child to verify GrandChildren were deep copied
    await userEvent.click(await screen.findByLabelText("expand Child"));

    await expectTree(`
My Notes
  Folder
    Child
      GrandChild1
      GrandChild2
  Target
  [S] My Notes My Fork
    `);
  });

  test("B2: Cross-pane DnD suggestion with collapsed children deep copies all including grandchildren", async () => {
    const [alice] = setup([ALICE]);
    await createForkedMyNotesVersion(
      alice,
      "My Notes{Enter}{Tab}Target{Escape}",
      "Folder{Enter}{Tab}Child{Enter}{Tab}GrandChild1{Enter}GrandChild2{Escape}"
    );

    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");

    await expectTree(`
My Fork
  Folder
    Child
      GrandChild1
      GrandChild2
  Target
    `);

    cleanup();

    window.history.pushState({}, "", "/");
    renderApp(alice());
    await navigateToNodeViaSearch(0, "My Notes");
    await maybeExpand("expand Target");

    // [S] Folder is collapsed by default
    await expectTree(`
My Notes
  Target
  [S] Folder
  [S] My Notes My Fork
    `);

    // Open split pane and navigate to Target
    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    // Drag collapsed [S] Folder from pane 0 to Target in pane 1
    // Use toggle buttons as drop targets - they only exist in tree children, not breadcrumbs
    const folderElements = screen.getAllByText("Folder");
    const targetDropTargets = getDropTargets("Target");
    fireEvent.dragStart(folderElements[0]);
    fireEvent.drop(targetDropTargets[1]);

    // Folder should appear under Target (cross-pane keeps original [S] Folder)
    await expectTree(`
My Notes
  Target
  [S] Folder
  [S] My Notes My Fork
Target
  Folder
    `);

    // Expand Folder in pane 1 to verify Child was deep copied
    // There are 2 Folder expand buttons: pane 0's [S] Folder and pane 1's Folder
    const expandFolderBtns = screen.getAllByLabelText("expand Folder");
    await userEvent.click(expandFolderBtns[expandFolderBtns.length - 1]);

    await expectTree(`
My Notes
  Target
  [S] Folder
  [S] My Notes My Fork
Target
  Folder
    Child
    `);

    // Expand Child in pane 1 to verify GrandChildren were deep copied
    const expandChildBtns = screen.getAllByLabelText("expand Child");
    await userEvent.click(expandChildBtns[0]);

    await expectTree(`
My Notes
  Target
  [S] Folder
  [S] My Notes My Fork
Target
  Folder
    Child
      GrandChild1
      GrandChild2
    `);
  });

  test("C1: Same-pane DnD suggestion into node with existing children preserves both", async () => {
    const [alice] = setup([ALICE]);
    await createForkedMyNotesVersion(
      alice,
      "My Notes{Enter}{Tab}Target{Enter}{Tab}AliceChild{Escape}",
      "BobFolder{Enter}{Tab}BobChild{Escape}"
    );

    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");

    await expectTree(`
My Fork
  BobFolder
    BobChild
  Target
    `);

    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");

    await expectTree(`
My Notes
  Target
    AliceChild
  [S] BobFolder
  [S] My Notes My Fork
    `);

    // Drag [S] BobFolder and drop on Target (inserts after Target, i.e. as first child of Target)
    fireEvent.dragStart(screen.getByText("BobFolder"));
    fireEvent.drop(screen.getByLabelText("collapse Target"));

    // BobFolder should be added under Target, AliceChild preserved
    // [S] BobFolder remains because it's at a different parent (My Notes vs Target)
    await expectTree(`
My Notes
  Target
    BobFolder
    AliceChild
  [S] BobFolder
  [S] My Notes My Fork
    `);

    // Expand BobFolder to verify BobChild was deep copied (first is the copied one under Target)
    const expandBobFolderBtns = screen.getAllByLabelText("expand BobFolder");
    await userEvent.click(expandBobFolderBtns[0]);

    await expectTree(`
My Notes
  Target
    BobFolder
      BobChild
    AliceChild
  [S] BobFolder
  [S] My Notes My Fork
    `);
  });

  test("C2: Cross-pane DnD suggestion into node with existing children preserves both", async () => {
    const [alice] = setup([ALICE]);
    await createForkedMyNotesVersion(
      alice,
      "My Notes{Enter}{Tab}Target{Enter}{Tab}AliceChild{Escape}",
      "BobFolder{Enter}{Tab}BobChild{Enter}{Tab}BobGrandChild{Escape}"
    );

    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");

    await expectTree(`
My Fork
  BobFolder
    BobChild
      BobGrandChild
  Target
    `);

    const forkTargetEditor = await screen.findByLabelText("edit Target");
    await userEvent.click(forkTargetEditor);
    await userEvent.clear(forkTargetEditor);
    await userEvent.type(forkTargetEditor, "Forked Copy{Escape}");

    cleanup();

    window.history.pushState({}, "", "/");
    renderApp(alice());
    await navigateToNodeViaSearch(0, "My Notes");

    await expectTree(`
My Notes
  Target
    AliceChild
    [S] Target Forked Copy
  [S] BobFolder
  [S] My Notes My Fork
    `);

    // Open split pane and navigate to Target
    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    await expectTree(`
My Notes
  Target
    AliceChild
    [S] Target Forked Copy
  [S] BobFolder
  [S] My Notes My Fork
Target
  AliceChild
  [S] Target Forked Copy
    `);

    // Drag [S] BobFolder from pane 0 to Target root in pane 1
    // Use toggle buttons as drop targets - they only exist in tree children, not breadcrumbs
    const bobFolderElements = screen.getAllByText("BobFolder");
    const targetDropTargets = getDropTargets("Target");
    fireEvent.dragStart(bobFolderElements[0]);
    fireEvent.drop(targetDropTargets[1]);

    // BobFolder should be added under Target as child (dropping expands Target)
    // [S] BobFolder remains in pane 0 (cross-pane copies, doesn't remove)
    await expectTree(`
My Notes
  Target
    BobFolder
    AliceChild
    [S] Target Forked Copy
  [S] BobFolder
  [S] My Notes My Fork
Target
  BobFolder
  AliceChild
  [S] Target Forked Copy
    `);

    // Expand BobFolder in pane 1 to verify deep copy
    // There are 3 BobFolders: pane 0's Target->BobFolder, pane 0's [S] BobFolder, pane 1's BobFolder
    const expandBobFolderBtns = screen.getAllByLabelText("expand BobFolder");
    await userEvent.click(expandBobFolderBtns[2]);

    await expectTree(`
My Notes
  Target
    BobFolder
    AliceChild
    [S] Target Forked Copy
  [S] BobFolder
  [S] My Notes My Fork
Target
  BobFolder
    BobChild
  AliceChild
  [S] Target Forked Copy
    `);

    // Expand BobChild to verify grandchildren were deep copied
    const expandBobChildBtns = screen.getAllByLabelText("expand BobChild");
    await userEvent.click(expandBobChildBtns[0]);

    await expectTree(`
My Notes
  Target
    BobFolder
    AliceChild
    [S] Target Forked Copy
  [S] BobFolder
  [S] My Notes My Fork
Target
  BobFolder
    BobChild
      BobGrandChild
  AliceChild
  [S] Target Forked Copy
    `);
  });
});

describe("Deep Copy - Relevance Selector Bugs", () => {
  test("D: Accepting suggestion via relevance selector does not create duplicates", async () => {
    const [alice] = setup([ALICE]);
    await createForkedMyNotesVersion(
      alice,
      "My Notes{Escape}",
      "BobItem{Escape}"
    );

    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");

    await expectTree(`
My Fork
  BobItem
    `);

    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");

    // Alice sees [S] BobItem as suggestion
    await expectTree(`
My Notes
  [S] BobItem
  [S] My Notes My Fork
    `);

    // Alice clicks relevance selector to mark as "relevant" (accept)
    const acceptBtn = screen.getByLabelText("accept BobItem as relevant");
    fireEvent.click(acceptBtn);

    // Should have exactly ONE BobItem (no duplicates, no [S] prefix)
    await expectTree(`
My Notes
  BobItem
  [S] My Notes My Fork
    `);

    // Verify there's only one BobItem element (not duplicated)
    const bobItems = screen.getAllByText("BobItem");
    expect(bobItems.length).toBe(1);
  });

  test("D2: Accept then delete suggestion should not multiply duplicates", async () => {
    const [alice] = setup([ALICE]);
    await createForkedMyNotesVersion(
      alice,
      "My Notes{Escape}",
      "BobItem{Escape}"
    );

    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");

    await expectTree(`
My Fork
  BobItem
    `);

    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");

    // Alice sees [S] BobItem
    await expectTree(`
My Notes
  [S] BobItem
  [S] My Notes My Fork
    `);

    // Accept the suggestion
    const acceptBtn = screen.getByLabelText("accept BobItem as relevant");
    fireEvent.click(acceptBtn);

    await expectTree(`
My Notes
  BobItem
  [S] My Notes My Fork
    `);

    // Delete BobItem via Delete key
    await userEvent.click(screen.getByLabelText("edit BobItem"));
    await userEvent.keyboard("{Escape}{Delete}");

    // The suggestion should reappear (since we removed Alice's copy)
    // but there should only be ONE [S] BobItem, not multiple
    await screen.findByText("BobItem");

    const allBobItems = screen.getAllByText("BobItem");
    expect(allBobItems.length).toBe(1);
  });

  test("D3: Suggestion with children - accept via relevance should not show full cref path", async () => {
    const [alice] = setup([ALICE]);
    await createForkedMyNotesVersion(
      alice,
      "My Notes{Escape}",
      "BobFolder{Enter}{Tab}BobChild{Escape}"
    );

    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");

    await expectTree(`
My Fork
  BobFolder
    BobChild
    `);

    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");

    // Alice sees [S] BobFolder
    await expectTree(`
My Notes
  [S] BobFolder
  [S] My Notes My Fork
    `);

    // Alice accepts BobFolder via relevance selector
    const acceptBtn = screen.getByLabelText("accept BobFolder as relevant");
    fireEvent.click(acceptBtn);

    // Should show BobFolder (resolved text, not full cref path)
    await expectTree(`
My Notes
  BobFolder
  [S] My Notes My Fork
    `);

    // Expand to verify children were copied
    await userEvent.click(await screen.findByLabelText("expand BobFolder"));

    await expectTree(`
My Notes
  BobFolder
    BobChild
  [S] My Notes My Fork
    `);

    // Verify text shows "BobFolder" not something like "cref:abc123..."
    const folderText = screen.getByText("BobFolder");
    expect(folderText.textContent).toBe("BobFolder");
  });
});

describe("Deep Copy - Simple Suggestion DnD (No Children)", () => {
  test("E1: Same-pane DnD simple suggestion becomes sibling", async () => {
    const [alice] = setup([ALICE]);
    await createForkedMyNotesVersion(
      alice,
      "My Notes{Enter}{Tab}Target{Escape}",
      "BobItem{Escape}"
    );

    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");

    await expectTree(`
My Fork
  BobItem
  Target
    `);

    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");

    await expectTree(`
My Notes
  Target
  [S] BobItem
  [S] My Notes My Fork
    `);

    fireEvent.dragStart(screen.getByText("BobItem"));
    fireEvent.drop(screen.getByLabelText("collapse My Notes"));

    await expectTree(`
My Notes
  BobItem
  Target
  [S] My Notes My Fork
    `);
  });

  test("E2: Cross-pane DnD simple suggestion into target", async () => {
    const [alice] = setup([ALICE]);
    await createForkedMyNotesVersion(
      alice,
      "My Notes{Enter}{Tab}Target{Escape}",
      "BobItem{Escape}"
    );

    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");

    await expectTree(`
My Fork
  BobItem
  Target
    `);

    cleanup();

    window.history.pushState({}, "", "/");
    renderApp(alice());
    await navigateToNodeViaSearch(0, "My Notes");

    await maybeExpand("expand Target");

    await expectTree(`
My Notes
  Target
  [S] BobItem
  [S] My Notes My Fork
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    // Use toggle buttons as drop targets - they only exist in tree children, not breadcrumbs
    const targetDropTargets = getDropTargets("Target");
    fireEvent.dragStart(screen.getAllByText("BobItem")[0]);
    fireEvent.drop(targetDropTargets[1]);

    await expectTree(`
My Notes
  Target
  [S] BobItem
  [S] My Notes My Fork
Target
  BobItem
    `);
  });

  test("E3: Alt + cross-pane DnD simple suggestion creates a reference copy", async () => {
    const [alice] = setup([ALICE]);
    await createForkedMyNotesVersion(
      alice,
      "My Notes{Enter}{Tab}Target{Escape}",
      "BobItem{Escape}"
    );

    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");

    await expectTree(`
My Fork
  BobItem
  Target
    `);

    cleanup();

    window.history.pushState({}, "", "/");
    renderApp(alice());
    await navigateToNodeViaSearch(0, "My Notes");

    await maybeExpand("expand Target");

    await expectTree(`
My Notes
  Target
  [S] BobItem
  [S] My Notes My Fork
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    const targetDropTargets = getDropTargets("Target");
    await userEvent.keyboard("{Alt>}");
    fireEvent.dragStart(screen.getAllByText("BobItem")[0]);
    fireEvent.dragOver(targetDropTargets[1], { altKey: true });
    fireEvent.drop(targetDropTargets[1], { altKey: true });
    await userEvent.keyboard("{/Alt}");

    await expectTree(`
My Notes
  Target
  [S] BobItem
  [S] My Notes My Fork
Target
  BobItem
    `);
  });
});

describe("Deep Copy - Alt Modifier", () => {
  test("Alt-dragging a normal node creates a reference instead of deep copy", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("My Notes{Enter}{Tab}Source{Enter}{Tab}Child{Escape}");

    await userEvent.click(await screen.findByLabelText("collapse Source"));
    await userEvent.click(await screen.findByLabelText("edit Source"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Target{Escape}");
    await userEvent.click(await screen.findByLabelText("expand Source"));

    await expectTree(`
My Notes
  Source
    Child
  Target
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    const targetDropTargets = getDropTargets("Target");
    await userEvent.keyboard("{Alt>}");
    fireEvent.dragStart(screen.getByText("Source"));
    fireEvent.dragOver(targetDropTargets[1], { altKey: true });
    fireEvent.drop(targetDropTargets[1], { altKey: true });
    await userEvent.keyboard("{/Alt}");

    await expectTree(`
My Notes
  Source
    Child
    [I] My Notes / Target ↩
  Target
Target
  Source
    `);
  });

  test("Alt-dragging a reference keeps it as a reference", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("My Notes{Enter}{Tab}Source{Enter}Target{Enter}Target2{Escape}");

    await expectTree(`
My Notes
  Source
  Target
  Target2
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    const targetDropTargets = getDropTargets("Target");
    await userEvent.keyboard("{Alt>}");
    fireEvent.dragStart(screen.getByText("Source"));
    fireEvent.dragOver(targetDropTargets[1], { altKey: true });
    fireEvent.drop(targetDropTargets[1], { altKey: true });
    await userEvent.keyboard("{/Alt}");

    await expectTree(`
My Notes
  Source
  Target
  Target2
Target
  Source
    `);

    const targetInPane0 = screen.getAllByRole("treeitem", {
      name: "Target",
    })[0];
    await userEvent.keyboard("{Alt>}");
    fireEvent.dragStart(getPane(1).getByRole("treeitem", { name: "Source" }));
    fireEvent.dragOver(targetInPane0, { altKey: true });
    fireEvent.drop(targetInPane0, { altKey: true });
    await userEvent.keyboard("{/Alt}");

    await expectTree(`
My Notes
  Source
  Target
  Source
  Target2
Target
  Source
    `);
  });
});

describe("Deep Copy - Edit Restrictions", () => {
  test("Suggestions are draggable", async () => {
    const [alice] = setup([ALICE]);
    await createForkedMyNotesVersion(
      alice,
      "My Notes{Escape}",
      "Holiday Destinations{Enter}{Tab}Barcelona{Escape}"
    );

    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");

    await expectTree(`
My Fork
  Holiday Destinations
    Barcelona
    `);

    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");

    await expectTree(`
My Notes
  [S] Holiday Destinations
  [S] My Notes My Fork
    `);

    const suggestionText = await screen.findByText("Holiday Destinations");
    // eslint-disable-next-line testing-library/no-node-access
    const suggestionItem = suggestionText.closest(".item");
    expect(suggestionItem).not.toBeNull();
    expect(suggestionItem?.getAttribute("draggable")).toBe("true");
  });

  test("Version children can be dragged", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Topic{Enter}{Tab}A1{Escape}");
    cleanup();

    await forkOwnRoot(alice, "My Notes", "My Fork");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");
    await userEvent.click(
      await screen.findByLabelText("open Topic in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Topic"));
    await userEvent.keyboard("{Enter}");
    await type("B1{Enter}B2{Enter}B3{Enter}B4{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");

    await expectTree(`
My Notes
  Topic
    A1
    [S] B1
    [S] B2
    [S] B3
    [V] +4
  [S] My Notes My Fork
    `);

    // eslint-disable-next-line testing-library/no-node-access
    const versionCard = document.querySelector('[data-virtual-type="version"]');
    expect(versionCard).not.toBeNull();
    // eslint-disable-next-line testing-library/no-node-access
    const versionItem = versionCard?.closest(".item");
    expect(versionItem).not.toBeNull();
    expect(versionItem?.getAttribute("draggable")).toBe("true");
  });

  test("H: Children of suggestions cannot be edited", async () => {
    const [alice] = setup([ALICE]);
    await createForkedMyNotesVersion(
      alice,
      "My Notes{Escape}",
      "BobFolder{Enter}{Tab}BobChild{Escape}"
    );

    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");

    await expectTree(`
My Fork
  BobFolder
    BobChild
    `);

    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");

    await expectTree(`
My Notes
  [S] BobFolder
  [S] My Notes My Fork
    `);

    await userEvent.click(await screen.findByLabelText("expand BobFolder"));

    await expectTree(`
My Notes
  [S] BobFolder
    [S] BobChild
  [S] My Notes My Fork
    `);

    // Children of suggestions should not have edit buttons
    expect(screen.queryByLabelText("edit BobChild")).toBeNull();
  });

  test("I: Single node suggestions (without children) cannot be edited", async () => {
    const [alice] = setup([ALICE]);
    await createForkedMyNotesVersion(
      alice,
      "My Notes{Escape}",
      "BobLeafNode{Escape}"
    );

    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");

    await expectTree(`
My Fork
  BobLeafNode
    `);

    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");

    await expectTree(`
My Notes
  [S] BobLeafNode
  [S] My Notes My Fork
    `);

    expect(screen.queryByLabelText("edit BobLeafNode")).toBeNull();
    expect(screen.queryByLabelText("expand BobLeafNode")).toBeNull();
    expect(screen.queryByLabelText("collapse BobLeafNode")).toBeNull();

    const leafSuggestionRow = screen.getByLabelText("BobLeafNode");
    // Leaf suggestions reserve toggle width with a spacer so text aligns with expandable suggestions.
    expect(within(leafSuggestionRow).getByTestId("node-marker")).toBeDefined();
  });
});

describe("Deep Copy - basedOn Tracking", () => {
  type MarkdownTreeValue = {
    uuid?: string;
    basedOn?: string;
    children: MarkdownTreeValue[];
  };

  const collectTreeValues = (
    trees: MarkdownTreeValue[]
  ): { uuids: string[]; basedOn: string[] } => {
    const walk = (
      nodes: MarkdownTreeValue[]
    ): { uuids: string[]; basedOn: string[] } =>
      nodes.reduce(
        (acc, { uuid, basedOn, children }) => {
          const childValues = walk(children);
          return {
            uuids: [
              ...acc.uuids,
              ...(uuid ? [uuid] : []),
              ...childValues.uuids,
            ],
            basedOn: [
              ...acc.basedOn,
              ...(basedOn ? [basedOn] : []),
              ...childValues.basedOn,
            ],
          };
        },
        { uuids: [] as string[], basedOn: [] as string[] }
      );

    return walk(trees);
  };

  test("Cross-pane deep copy sets basedOn on all copied nodes", async () => {
    const [alice] = setup([ALICE]);
    await createForkedMyNotesVersion(
      alice,
      "My Notes{Enter}{Tab}Target{Escape}",
      "BobFolder{Enter}{Tab}BobChild{Enter}{Tab}BobGrandChild{Escape}"
    );

    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");

    await expectTree(`
My Fork
  BobFolder
    BobChild
      BobGrandChild
  Target
    `);

    cleanup();

    const forkNodeEvents = alice()
      .relayPool.getDecryptedEvents()
      .filter(
        (e) =>
          e.kind === KIND_KNOWLEDGE_DOCUMENT && e.pubkey === ALICE.publicKey
      );
    const forkNodeIds = forkNodeEvents.flatMap((event) => {
      const { tree } = parseMarkdown(event.content);
      return collectTreeValues(tree as MarkdownTreeValue[]).uuids;
    });

    window.history.pushState({}, "", "/");
    const utils = renderApp(alice());
    await navigateToNodeViaSearch(0, "My Notes");
    await maybeExpand("expand Target");

    await expectTree(`
My Notes
  Target
  [S] BobFolder
  [S] My Notes My Fork
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    const targetDropTargets = getDropTargets("Target");
    const bobFolderElements = screen.getAllByText("BobFolder");
    fireEvent.dragStart(bobFolderElements[0]);
    fireEvent.drop(targetDropTargets[1]);

    await expectTree(`
My Notes
  Target
  [S] BobFolder
  [S] My Notes My Fork
Target
  BobFolder
    `);

    const aliceCopyEvents = utils.relayPool
      .getDecryptedEvents()
      .filter(
        (e) =>
          e.kind === KIND_KNOWLEDGE_DOCUMENT &&
          e.pubkey === ALICE.publicKey &&
          e.content.includes('basedOn="')
      );

    expect(aliceCopyEvents.length).toBeGreaterThan(0);

    aliceCopyEvents.forEach((e) => {
      const { tree } = parseMarkdown(e.content);
      const basedOnValues = collectTreeValues(
        tree as MarkdownTreeValue[]
      ).basedOn;
      basedOnValues.forEach((basedOnValue) => {
        expect(forkNodeIds).toContain(basedOnValue);
      });
    });
  });

  test("Accepting suggestion via relevance selector sets basedOn", async () => {
    const [alice] = setup([ALICE]);
    await createForkedMyNotesVersion(
      alice,
      "My Notes{Escape}",
      "BobFolder{Enter}{Tab}BobChild{Escape}"
    );

    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");

    await expectTree(`
My Fork
  BobFolder
    BobChild
    `);

    cleanup();

    window.history.pushState({}, "", "/");
    const utils = renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");

    await expectTree(`
My Notes
  [S] BobFolder
  [S] My Notes My Fork
    `);

    const eventsBeforeAccept = utils.relayPool.getDecryptedEvents().length;

    const acceptBtn = screen.getByLabelText("accept BobFolder as relevant");
    fireEvent.click(acceptBtn);

    await expectTree(`
My Notes
  BobFolder
  [S] My Notes My Fork
    `);

    const newEvents = utils.relayPool
      .getDecryptedEvents()
      .slice(eventsBeforeAccept)
      .filter(
        (e) =>
          e.kind === KIND_KNOWLEDGE_DOCUMENT && e.content.includes('basedOn="')
      );

    expect(newEvents.length).toBeGreaterThan(0);
  });

  test("Forking readonly root publishes a snapshot event and stores its pointer", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Topic{Enter}{Tab}Child{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), requireUser(alice()).publicKey, "My Notes");

    const bobEvents = bob().relayPool.getDecryptedEvents();
    const snapshotEvents = bobEvents.filter(
      (event) =>
        event.kind === KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT &&
        event.pubkey === BOB.publicKey
    );
    expect(snapshotEvents).toHaveLength(1);

    const bobDocumentEvents = bobEvents.filter(
      (event) =>
        event.kind === KIND_KNOWLEDGE_DOCUMENT && event.pubkey === BOB.publicKey
    );
    expect(
      bobDocumentEvents.some((event) => event.content.includes('snapshot="'))
    ).toBe(true);
  });

  test("Fork stamps the snapshot on every copied node, not only the root", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Topic{Enter}{Tab}Child{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), requireUser(alice()).publicKey, "My Notes");

    const bobEvents = bob().relayPool.getDecryptedEvents();
    const snapshotEvent = bobEvents.find(
      (event) =>
        event.kind === KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT &&
        event.pubkey === BOB.publicKey
    );
    if (!snapshotEvent) {
      throw new Error("missing snapshot event");
    }
    const snapshotId = findTag(snapshotEvent, "d");

    const docEvent = bobEvents.find(
      (event) =>
        event.kind === KIND_KNOWLEDGE_DOCUMENT &&
        event.pubkey === BOB.publicKey &&
        event.content.includes('basedOn="')
    );
    if (!docEvent) {
      throw new Error("missing forked document event");
    }

    const collectLineage = (
      nodes: MarkdownTreeNode[]
    ): { basedOn?: string; snapshotId?: string }[] =>
      nodes.flatMap(({ basedOn, snapshotId: nodeSnapshotId, children }) => [
        { basedOn, snapshotId: nodeSnapshotId },
        ...collectLineage(children),
      ]);
    const lineage = collectLineage(parseMarkdown(docEvent.content).tree).filter(
      (entry) => entry.basedOn
    );

    expect(lineage.length).toBeGreaterThan(1);
    lineage.forEach((entry) => {
      expect(entry.snapshotId).toBe(snapshotId);
    });
  });

  test("Fork snapshot IDs are content-addressed snap_sha256 hashes", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Topic{Enter}{Tab}Child{Escape}");
    cleanup();

    await forkReadonlyRoot(bob(), requireUser(alice()).publicKey, "My Notes");

    const bobEvents = bob().relayPool.getDecryptedEvents();
    const snapshotEvent = bobEvents.find(
      (event) =>
        event.kind === KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT &&
        event.pubkey === BOB.publicKey
    );
    expect(snapshotEvent).toBeDefined();
    if (!snapshotEvent) {
      throw new Error("missing snapshot event");
    }

    const snapshotId = findTag(snapshotEvent, "d");
    expect(snapshotId).toMatch(/^snap_sha256_[0-9a-f]{64}$/);
    expect(snapshotId).toBe(
      `snap_sha256_${bytesToHex(
        sha256(new TextEncoder().encode(snapshotEvent.content))
      )}`
    );

    const bobDocumentEvent = bobEvents.find(
      (event) =>
        event.kind === KIND_KNOWLEDGE_DOCUMENT && event.pubkey === BOB.publicKey
    );
    expect(bobDocumentEvent?.content).toContain(`snapshot="${snapshotId}"`);
  });
});

describe("Deep Copy - Version DnD", () => {
  test("Cross-pane DnD version creates cref displayed as VO and deduplicates virtual", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Topic{Enter}{Tab}A1{Escape}");
    cleanup();

    await forkOwnRoot(alice, "My Notes", "My Fork");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");
    const forkTopicEditor = await screen.findByLabelText("edit Topic");
    await userEvent.click(forkTopicEditor);
    await userEvent.clear(forkTopicEditor);
    await userEvent.type(forkTopicEditor, "Forked Copy{Escape}");
    await userEvent.click(
      await screen.findByLabelText("open Forked Copy in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Forked Copy"));
    await userEvent.keyboard("{Enter}");
    await type("B1{Enter}B2{Enter}B3{Enter}B4{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderApp(alice());
    await navigateToNodeViaSearch(0, "My Notes");

    await expectTree(`
My Notes
  Topic
    A1
    [S] B1
    [S] B2
    [S] B3
    [V] +4
    [S] Topic Forked Copy
  [S] My Notes My Fork
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Topic");

    // eslint-disable-next-line testing-library/no-node-access
    const versionElement = document.querySelector(
      '[data-virtual-type="version"]'
    )!;
    const dropTarget = getPane(1).getByLabelText("collapse Topic");
    fireEvent.dragStart(versionElement);
    fireEvent.drop(dropTarget);

    await expectTree(`
My Notes
  Topic
    Forked Copy
    A1
    [S] B1
    [S] B2
    [S] B3
    [S] Topic Forked Copy
  [S] My Notes My Fork
Topic
  Forked Copy
  A1
  [S] B1
  [S] B2
  [S] B3
  [S] Topic Forked Copy
    `);
  });

  test("Same-pane DnD version creates cref displayed as VO and deduplicates virtual", async () => {
    const [alice] = setup([ALICE]);

    renderTree(alice);
    await type("My Notes{Enter}{Tab}Topic{Enter}{Tab}A1{Escape}");
    cleanup();

    await forkOwnRoot(alice, "My Notes", "My Fork");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Fork");
    const forkTopicEditor = await screen.findByLabelText("edit Topic");
    await userEvent.click(forkTopicEditor);
    await userEvent.clear(forkTopicEditor);
    await userEvent.type(forkTopicEditor, "Forked Copy{Escape}");
    await userEvent.click(
      await screen.findByLabelText("open Forked Copy in fullscreen")
    );
    await userEvent.click(await screen.findByLabelText("edit Forked Copy"));
    await userEvent.keyboard("{Enter}");
    await type("B1{Enter}B2{Enter}B3{Enter}B4{Escape}");
    cleanup();

    window.history.pushState({}, "", "/");
    renderTree(alice);
    await navigateToNodeViaSearch(0, "My Notes");

    await expectTree(`
My Notes
  Topic
    A1
    [S] B1
    [S] B2
    [S] B3
    [V] +4
    [S] Topic Forked Copy
  [S] My Notes My Fork
    `);

    // eslint-disable-next-line testing-library/no-node-access
    const versionElement = document.querySelector(
      '[data-virtual-type="version"]'
    )!;
    fireEvent.dragStart(versionElement);
    fireEvent.drop(screen.getByLabelText("collapse Topic"));

    await expectTree(`
My Notes
  Topic
    Forked Copy
    A1
    [S] B1
    [S] B2
    [S] B3
    [S] Topic Forked Copy
  [S] My Notes My Fork
    `);
  });
});
