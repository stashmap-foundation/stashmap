import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  expectTree,
  findNewNodeEditor,
  follow,
  getPane,
  navigateToNodeViaSearch,
  renderApp,
  renderTree,
  setup,
  textContent,
  type,
} from "../utils.test";
import { KIND_KNOWLEDGE_LIST } from "../nostr";

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

  test("Tab indent cleans up old descendant relations (no orphaned references)", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "Notes{Enter}{Tab}Sibling{Enter}Cities{Enter}{Tab}Barcelona{Escape}"
    );
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Travel{Enter}{Tab}Barcelona{Escape}");
    await maybeExpand("expand Barcelona");

    await expectTree(`
Travel
  Barcelona
    [C] Notes / Cities / Barcelona
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Travel
  Barcelona
    [C] Notes / Cities / Barcelona
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await userEvent.click(await screen.findByLabelText("expand Barcelona"));

    await expectTree(`
Travel
  Barcelona
    [C] Notes / Cities / Barcelona
Travel
  Barcelona
    [C] Notes / Cities / Barcelona
    `);

    await navigateToNodeViaSearch(1, "Notes");
    await userEvent.click(screen.getAllByLabelText("expand Cities")[0]);

    await expectTree(`
Travel
  Barcelona
    [C] Notes / Cities / Barcelona
Notes
  Sibling
  Cities
    Barcelona
    `);

    const citiesEditors = screen.getAllByLabelText("edit Cities");
    await userEvent.click(citiesEditors[citiesEditors.length - 1]);
    await userEvent.keyboard("{Home}{Tab}");

    await expectTree(`
Travel
  Barcelona
    [C] Notes / Sibling / Cities / Barcelona
Notes
  Sibling
    Cities
      Barcelona
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Travel
  Barcelona
    [C] Notes / Sibling / Cities / Barcelona
Notes
  Sibling
    Cities
      Barcelona
    `);
  });

  test("Shift-Tab outdent cleans up old descendant relations (no orphaned references)", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "Notes{Enter}{Tab}Parent{Enter}{Tab}Child{Enter}{Tab}Barcelona{Escape}"
    );
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Travel{Enter}{Tab}Barcelona{Escape}");
    await maybeExpand("expand Barcelona");

    await expectTree(`
Travel
  Barcelona
    [C] Notes / Parent / Child / Barcelona
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Travel
  Barcelona
    [C] Notes / Parent / Child / Barcelona
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Notes");
    await userEvent.click(screen.getAllByLabelText("expand Parent")[0]);
    await userEvent.click(screen.getAllByLabelText("expand Child")[0]);

    await expectTree(`
Travel
  Barcelona
    [C] Notes / Parent / Child / Barcelona
Notes
  Parent
    Child
      Barcelona
    `);

    const childEditor = screen.getAllByLabelText("edit Child")[0];
    await userEvent.click(childEditor);
    await userEvent.keyboard("{Home}{Shift>}{Tab}{/Shift}");

    await expectTree(`
Travel
  Barcelona
    [C] Notes / Child / Barcelona
Notes
  Parent
  Child
    Barcelona
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Travel
  Barcelona
    [C] Notes / Child / Barcelona
Notes
  Parent
  Child
    Barcelona
    `);
  });

  test("Tab indent preserves relation URL for deeply nested descendants", async () => {
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
    const relationUrl = fullscreenLink.getAttribute("href");
    expect(relationUrl).toMatch(/^\/r\//);

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

    renderApp({ ...alice(), initialRoute: relationUrl as string });

    await expectTree(`
Child
  GrandChild
    `);
  });

  test("Shift-Tab outdent preserves relation URL for deeply nested descendants", async () => {
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
    const relationUrl = fullscreenLink.getAttribute("href");
    expect(relationUrl).toMatch(/^\/r\//);

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

    renderApp({ ...alice(), initialRoute: relationUrl as string });

    await expectTree(`
Child
  GrandChild
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

    // Use toggle buttons as drop targets - they only exist in tree items, not breadcrumbs
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
    // Use toggle buttons as drop targets - they only exist in tree items, not breadcrumbs
    const targetDropTargets = getDropTargets("Target");
    fireEvent.dragStart(screen.getAllByText("Source")[0]);
    fireEvent.drop(targetDropTargets[1]);

    // After DnD, Target shows Source with Child (from new copy)
    // not Another Child (the old relation is overwritten in view)
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

describe("Deep Copy - ~Versions Handling", () => {
  test("Copied ~Versions from another user are taken over", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    // Bob creates BobFolder → Original and edits Original
    renderTree(bob);
    await type("My Notes{Enter}{Tab}BobFolder{Enter}{Tab}Original{Escape}");

    // Bob edits "Original" to "Bob Edited" - this creates a ~Versions entry
    const sourceEditor = await screen.findByLabelText("edit Original");
    await userEvent.click(sourceEditor);
    await userEvent.clear(sourceEditor);
    await userEvent.type(sourceEditor, "Bob Edited");
    fireEvent.blur(sourceEditor, { relatedTarget: document.body });

    // Wait for the edit to be reflected
    await screen.findByLabelText("edit Bob Edited");

    await expectTree(`
My Notes
  BobFolder
    Bob Edited
    `);

    cleanup();

    // Alice follows Bob
    await follow(alice, bob().user.publicKey);

    // Alice renders and creates Target
    // BobFolder appears as diff item because Alice follows Bob
    renderApp(alice());
    await type("My Notes{Enter}{Tab}Target{Escape}");
    await maybeExpand("expand Target");

    await expectTree(`
My Notes
  Target
  [S] BobFolder
    `);

    // Expand BobFolder diff item to see its children
    await userEvent.click(await screen.findByLabelText("expand BobFolder"));

    await expectTree(`
My Notes
  Target
  [S] BobFolder
    [O] Bob Edited
    `);

    // Open split pane and navigate pane 1 to Target
    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    await expectTree(`
My Notes
  Target
  [S] BobFolder
    [O] Bob Edited
Target
    `);

    // Drag BobFolder from pane 0 to Target in pane 1 (cross-pane deep copy)
    // Use toggle buttons as drop targets - they only exist in tree items, not breadcrumbs
    const bobFolderElements = screen.getAllByText("BobFolder");
    const targetDropTargets = getDropTargets("Target");
    fireEvent.dragStart(bobFolderElements[0]);
    fireEvent.drop(targetDropTargets[1]);

    // After copy, Alice sees "Bob Edited" because Bob's ~Versions were copied
    // and became Alice's ~Versions for that context
    await expectTree(`
My Notes
  Target
  [S] BobFolder
    [O] Bob Edited
Target
  BobFolder
    Bob Edited
    `);
  });
});

describe("Deep Copy - Suggestion DnD", () => {
  test("A1: Same-pane DnD suggestion as sibling accepts and removes suggestion", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    // Bob creates BobItem
    renderTree(bob);
    await type("My Notes{Enter}{Tab}BobItem{Escape}");

    await expectTree(`
My Notes
  BobItem
    `);

    cleanup();

    // Alice follows Bob and creates Target
    await follow(alice, bob().user.publicKey);
    renderTree(alice);
    await type("My Notes{Enter}{Tab}Target{Escape}");

    await expectTree(`
My Notes
  Target
  [S] BobItem
    `);

    fireEvent.dragStart(screen.getByText("BobItem"));
    fireEvent.drop(screen.getByLabelText("collapse My Notes"));

    await expectTree(`
My Notes
  BobItem
  Target
    `);
  });

  test("A2: Cross-pane DnD suggestion into expanded node with no children", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    // Bob creates BobItem
    renderTree(bob);
    await type("My Notes{Enter}{Tab}BobItem{Escape}");

    await expectTree(`
My Notes
  BobItem
    `);

    cleanup();

    // Alice follows Bob and creates Target
    await follow(alice, bob().user.publicKey);
    renderApp(alice());
    await type("My Notes{Enter}{Tab}Target{Escape}");
    await maybeExpand("expand Target");

    await expectTree(`
My Notes
  Target
  [S] BobItem
    `);

    // Open split pane and navigate to Target
    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    // Drag [S] BobItem from pane 0 to Target in pane 1
    // Use toggle buttons as drop targets - they only exist in tree items, not breadcrumbs
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
Target
  BobItem
    `);
  });

  test("B1: Same-pane DnD suggestion with collapsed children deep copies all including grandchildren", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    // Bob creates Folder with children and grandchildren
    renderTree(bob);
    await type(
      "My Notes{Enter}{Tab}Folder{Enter}{Tab}Child{Enter}{Tab}GrandChild1{Enter}GrandChild2{Escape}"
    );

    await expectTree(`
My Notes
  Folder
    Child
      GrandChild1
      GrandChild2
    `);

    cleanup();

    // Alice follows Bob and creates Target
    await follow(alice, bob().user.publicKey);
    renderTree(alice);
    await type("My Notes{Enter}{Tab}Target{Escape}");

    // [S] Folder is collapsed by default
    await expectTree(`
My Notes
  Target
  [S] Folder
    `);

    fireEvent.dragStart(screen.getByText("Folder"));
    fireEvent.drop(screen.getByLabelText("collapse My Notes"));

    await expectTree(`
My Notes
  Folder
  Target
    `);

    // Expand Folder to verify Child was deep copied
    await userEvent.click(await screen.findByLabelText("expand Folder"));

    await expectTree(`
My Notes
  Folder
    Child
  Target
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
    `);
  });

  test("B2: Cross-pane DnD suggestion with collapsed children deep copies all including grandchildren", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    // Bob creates Folder with children and grandchildren
    renderTree(bob);
    await type(
      "My Notes{Enter}{Tab}Folder{Enter}{Tab}Child{Enter}{Tab}GrandChild1{Enter}GrandChild2{Escape}"
    );

    await expectTree(`
My Notes
  Folder
    Child
      GrandChild1
      GrandChild2
    `);

    cleanup();

    // Alice follows Bob and creates Target
    await follow(alice, bob().user.publicKey);
    renderApp(alice());
    await type("My Notes{Enter}{Tab}Target{Escape}");
    await maybeExpand("expand Target");

    // [S] Folder is collapsed by default
    await expectTree(`
My Notes
  Target
  [S] Folder
    `);

    // Open split pane and navigate to Target
    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    // Drag collapsed [S] Folder from pane 0 to Target in pane 1
    // Use toggle buttons as drop targets - they only exist in tree items, not breadcrumbs
    const folderElements = screen.getAllByText("Folder");
    const targetDropTargets = getDropTargets("Target");
    fireEvent.dragStart(folderElements[0]);
    fireEvent.drop(targetDropTargets[1]);

    // Folder should appear under Target (cross-pane keeps original [S] Folder)
    await expectTree(`
My Notes
  Target
  [S] Folder
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
Target
  Folder
    Child
      GrandChild1
      GrandChild2
    `);
  });

  test("C1: Same-pane DnD suggestion into node with existing children preserves both", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    // Bob creates Folder with BobChild
    renderTree(bob);
    await type("My Notes{Enter}{Tab}BobFolder{Enter}{Tab}BobChild{Escape}");

    await expectTree(`
My Notes
  BobFolder
    BobChild
    `);

    cleanup();

    // Alice creates Target with AliceChild
    renderTree(alice);
    await type("My Notes{Enter}{Tab}Target{Enter}{Tab}AliceChild{Escape}");

    await expectTree(`
My Notes
  Target
    AliceChild
    `);

    cleanup();

    // Alice follows Bob
    await follow(alice, bob().user.publicKey);
    renderTree(alice);

    await expectTree(`
My Notes
  Target
    AliceChild
  [S] BobFolder
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
    `);
  });

  test("C2: Cross-pane DnD suggestion into node with existing children preserves both", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    // Bob creates Folder with BobChild and BobGrandChild
    renderTree(bob);
    await type(
      "My Notes{Enter}{Tab}BobFolder{Enter}{Tab}BobChild{Enter}{Tab}BobGrandChild{Escape}"
    );

    await expectTree(`
My Notes
  BobFolder
    BobChild
      BobGrandChild
    `);

    cleanup();

    // Alice creates Target with AliceChild
    renderTree(alice);
    await type("My Notes{Enter}{Tab}Target{Enter}{Tab}AliceChild{Escape}");

    await expectTree(`
My Notes
  Target
    AliceChild
    `);

    cleanup();

    // Alice follows Bob
    await follow(alice, bob().user.publicKey);
    renderApp(alice());

    await expectTree(`
My Notes
  Target
    AliceChild
  [S] BobFolder
    `);

    // Open split pane and navigate to Target
    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    await expectTree(`
My Notes
  Target
    AliceChild
  [S] BobFolder
Target
  AliceChild
    `);

    // Drag [S] BobFolder from pane 0 to Target root in pane 1
    // Use toggle buttons as drop targets - they only exist in tree items, not breadcrumbs
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
  [S] BobFolder
Target
  BobFolder
  AliceChild
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
  [S] BobFolder
Target
  BobFolder
    BobChild
  AliceChild
    `);

    // Expand BobChild to verify grandchildren were deep copied
    const expandBobChildBtns = screen.getAllByLabelText("expand BobChild");
    await userEvent.click(expandBobChildBtns[0]);

    await expectTree(`
My Notes
  Target
    BobFolder
    AliceChild
  [S] BobFolder
Target
  BobFolder
    BobChild
      BobGrandChild
  AliceChild
    `);
  });
});

describe("Deep Copy - Relevance Selector Bugs", () => {
  test("D: Accepting suggestion via relevance selector does not create duplicates", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    // Bob creates BobItem
    renderTree(bob);
    await type("My Notes{Enter}{Tab}BobItem{Escape}");

    await expectTree(`
My Notes
  BobItem
    `);

    cleanup();

    // Alice follows Bob
    await follow(alice, bob().user.publicKey);
    renderTree(alice);
    await type("My Notes{Escape}");

    // Alice sees [S] BobItem as suggestion
    await expectTree(`
My Notes
  [S] BobItem
    `);

    // Alice clicks relevance selector to mark as "relevant" (accept)
    const acceptBtn = screen.getByLabelText("accept BobItem as relevant");
    fireEvent.click(acceptBtn);

    // Should have exactly ONE BobItem (no duplicates, no [S] prefix)
    await expectTree(`
My Notes
  BobItem
    `);

    // Verify there's only one BobItem element (not duplicated)
    const bobItems = screen.getAllByText("BobItem");
    expect(bobItems.length).toBe(1);
  });

  test("D2: Accept then delete suggestion should not multiply duplicates", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    // Bob creates BobItem
    renderTree(bob);
    await type("My Notes{Enter}{Tab}BobItem{Escape}");

    await expectTree(`
My Notes
  BobItem
    `);

    cleanup();

    // Alice follows Bob
    await follow(alice, bob().user.publicKey);
    renderTree(alice);
    await type("My Notes{Escape}");

    // Alice sees [S] BobItem
    await expectTree(`
My Notes
  [S] BobItem
    `);

    // Accept the suggestion
    const acceptBtn = screen.getByLabelText("accept BobItem as relevant");
    fireEvent.click(acceptBtn);

    await expectTree(`
My Notes
  BobItem
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
    const [alice, bob] = setup([ALICE, BOB]);

    // Bob creates BobFolder with child
    renderTree(bob);
    await type("My Notes{Enter}{Tab}BobFolder{Enter}{Tab}BobChild{Escape}");

    await expectTree(`
My Notes
  BobFolder
    BobChild
    `);

    cleanup();

    // Alice follows Bob
    await follow(alice, bob().user.publicKey);
    renderTree(alice);
    await type("My Notes{Escape}");

    // Alice sees [S] BobFolder
    await expectTree(`
My Notes
  [S] BobFolder
    `);

    // Alice accepts BobFolder via relevance selector
    const acceptBtn = screen.getByLabelText("accept BobFolder as relevant");
    fireEvent.click(acceptBtn);

    // Should show BobFolder (resolved text, not full cref path)
    await expectTree(`
My Notes
  BobFolder
    `);

    // Expand to verify children were copied
    await userEvent.click(await screen.findByLabelText("expand BobFolder"));

    await expectTree(`
My Notes
  BobFolder
    BobChild
    `);

    // Verify text shows "BobFolder" not something like "cref:abc123:..."
    const folderText = screen.getByText("BobFolder");
    expect(folderText.textContent).toBe("BobFolder");
  });
});

describe("Deep Copy - Simple Suggestion DnD (No Children)", () => {
  test("E1: Same-pane DnD simple suggestion becomes sibling", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(bob);
    await type("My Notes{Enter}{Tab}BobItem{Escape}");

    await expectTree(`
My Notes
  BobItem
    `);

    cleanup();

    await follow(alice, bob().user.publicKey);
    renderTree(alice);
    await type("My Notes{Enter}{Tab}Target{Escape}");

    await expectTree(`
My Notes
  Target
  [S] BobItem
    `);

    fireEvent.dragStart(screen.getByText("BobItem"));
    fireEvent.drop(screen.getByLabelText("collapse My Notes"));

    await expectTree(`
My Notes
  BobItem
  Target
    `);
  });

  test("E2: Cross-pane DnD simple suggestion into target", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(bob);
    await type("My Notes{Enter}{Tab}BobItem{Escape}");

    cleanup();

    await follow(alice, bob().user.publicKey);
    renderApp(alice());
    await type("My Notes{Enter}{Tab}Target{Escape}");

    await maybeExpand("expand Target");

    await expectTree(`
My Notes
  Target
  [S] BobItem
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    // Use toggle buttons as drop targets - they only exist in tree items, not breadcrumbs
    const targetDropTargets = getDropTargets("Target");
    fireEvent.dragStart(screen.getAllByText("BobItem")[0]);
    fireEvent.drop(targetDropTargets[1]);

    await expectTree(`
My Notes
  Target
  [S] BobItem
Target
  BobItem
    `);
  });

  test("E3: Alt + cross-pane DnD simple suggestion creates a reference copy", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(bob);
    await type("My Notes{Enter}{Tab}BobItem{Escape}");

    cleanup();

    await follow(alice, bob().user.publicKey);
    renderApp(alice());
    await type("My Notes{Enter}{Tab}Target{Escape}");

    await maybeExpand("expand Target");

    await expectTree(`
My Notes
  Target
  [S] BobItem
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
Target
  [R] My Notes / BobItem
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
    [I] Target <<< My Notes
  Target
Target
  [R] My Notes / Source
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
  [R] My Notes / Source
    `);

    const targetInPane0 = screen.getAllByRole("treeitem", {
      name: "Target",
    })[0];
    await userEvent.keyboard("{Alt>}");
    fireEvent.dragStart(getPane(1).getByText(textContent("My Notes / Source")));
    fireEvent.dragOver(targetInPane0, { altKey: true });
    fireEvent.drop(targetInPane0, { altKey: true });
    await userEvent.keyboard("{/Alt}");

    await expectTree(`
My Notes
  Source
  Target
  [R] My Notes / Source
  Target2
Target
  [R] My Notes / Source
    `);
  });
});

describe("Deep Copy - Edit Restrictions", () => {
  test("Suggestions are draggable", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(bob);
    await type(
      "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Barcelona{Escape}"
    );

    cleanup();

    renderTree(alice);
    await type("My Notes{Escape}");

    await expectTree(`
My Notes
  [S] Holiday Destinations
    `);

    const suggestionText = await screen.findByText("Holiday Destinations");
    // eslint-disable-next-line testing-library/no-node-access
    const suggestionItem = suggestionText.closest(".item");
    expect(suggestionItem).not.toBeNull();
    expect(suggestionItem?.getAttribute("draggable")).toBe("true");
  });

  test("Version items can be dragged", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(bob);
    await type(
      "My Notes{Enter}{Tab}BobItem1{Enter}BobItem2{Enter}BobItem3{Enter}BobItem4{Escape}"
    );

    cleanup();

    renderTree(alice);
    await type("My Notes{Escape}");

    await expectTree(`
My Notes
  [S] BobItem1
  [S] BobItem2
  [S] BobItem3
  [VO] +4
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
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(bob);
    await type("My Notes{Enter}{Tab}BobFolder{Enter}{Tab}BobChild{Escape}");

    await expectTree(`
My Notes
  BobFolder
    BobChild
    `);

    cleanup();

    await follow(alice, bob().user.publicKey);
    renderTree(alice);
    await type("My Notes{Escape}");

    await expectTree(`
My Notes
  [S] BobFolder
    `);

    await userEvent.click(await screen.findByLabelText("expand BobFolder"));

    await expectTree(`
My Notes
  [S] BobFolder
    [O] BobChild
    `);

    // Children of suggestions should not have edit buttons
    expect(screen.queryByLabelText("edit BobChild")).toBeNull();
  });

  test("I: Single node suggestions (without children) cannot be edited", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(bob);
    await type("My Notes{Enter}{Tab}BobLeafNode{Escape}");

    await expectTree(`
My Notes
  BobLeafNode
    `);

    cleanup();

    await follow(alice, bob().user.publicKey);
    renderTree(alice);
    await type("My Notes{Escape}");

    await expectTree(`
My Notes
  [S] BobLeafNode
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
  test("Cross-pane deep copy sets basedOn on all copied relations", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(bob);
    await type(
      "My Notes{Enter}{Tab}BobFolder{Enter}{Tab}BobChild{Enter}{Tab}BobGrandChild{Escape}"
    );

    await expectTree(`
My Notes
  BobFolder
    BobChild
      BobGrandChild
    `);

    const bobRelationEvents = bob()
      .relayPool.getEvents()
      .filter(
        (e) => e.kind === KIND_KNOWLEDGE_LIST && e.pubkey === BOB.publicKey
      );
    const bobRelationDTags = bobRelationEvents.map(
      (e) => e.tags.find((t) => t[0] === "d")![1]
    );

    cleanup();

    await follow(alice, bob().user.publicKey);
    const utils = renderApp(alice());
    await type("My Notes{Enter}{Tab}Target{Escape}");
    await maybeExpand("expand Target");

    await expectTree(`
My Notes
  Target
  [S] BobFolder
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
Target
  BobFolder
    `);

    const aliceCopyEvents = utils.relayPool
      .getEvents()
      .filter(
        (e) =>
          e.kind === KIND_KNOWLEDGE_LIST &&
          e.pubkey === ALICE.publicKey &&
          e.tags.some((t) => t[0] === "b")
      );

    expect(aliceCopyEvents.length).toBeGreaterThan(0);

    aliceCopyEvents.forEach((e) => {
      const basedOnValue = e.tags.find((t) => t[0] === "b")![1];
      const sourceDTag = basedOnValue.split("_").slice(1).join("_");
      expect(bobRelationDTags).toContain(sourceDTag);
    });
  });

  test("Accepting suggestion via relevance selector sets basedOn", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(bob);
    await type("My Notes{Enter}{Tab}BobFolder{Enter}{Tab}BobChild{Escape}");

    await expectTree(`
My Notes
  BobFolder
    BobChild
    `);

    cleanup();

    await follow(alice, bob().user.publicKey);
    const utils = renderTree(alice);
    await type("My Notes{Escape}");

    await expectTree(`
My Notes
  [S] BobFolder
    `);

    const eventsBeforeAccept = utils.relayPool.getEvents().length;

    const acceptBtn = screen.getByLabelText("accept BobFolder as relevant");
    fireEvent.click(acceptBtn);

    await expectTree(`
My Notes
  BobFolder
    `);

    const newEvents = utils.relayPool
      .getEvents()
      .slice(eventsBeforeAccept)
      .filter(
        (e) =>
          e.kind === KIND_KNOWLEDGE_LIST && e.tags.some((t) => t[0] === "b")
      );

    expect(newEvents.length).toBeGreaterThan(0);
  });
});

describe("Deep Copy - Version DnD", () => {
  test("Cross-pane DnD version creates cref displayed as VO and deduplicates virtual", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(bob);
    await type("My Notes{Enter}{Tab}B1{Enter}B2{Enter}B3{Enter}B4{Escape}");
    cleanup();

    renderApp(alice());
    await type("My Notes{Enter}{Tab}A1{Escape}");

    await expectTree(`
My Notes
  A1
  [S] B1
  [S] B2
  [S] B3
  [VO] +4 -1
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "My Notes");

    // eslint-disable-next-line testing-library/no-node-access
    const versionElement = document.querySelector(
      '[data-virtual-type="version"]'
    )!;
    const dropTarget = getPane(1).getByLabelText("collapse My Notes");
    fireEvent.dragStart(versionElement);
    fireEvent.drop(dropTarget);

    await expectTree(`
My Notes
  [VO] +4 -2
  A1
  [S] B1
  [S] B2
  [S] B3
My Notes
  [VO] +4 -2
  A1
  [S] B1
  [S] B2
  [S] B3
    `);
  });

  test("Same-pane DnD version creates cref displayed as VO and deduplicates virtual", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(bob);
    await type("My Notes{Enter}{Tab}B1{Enter}B2{Enter}B3{Enter}B4{Escape}");
    cleanup();

    renderTree(alice);
    await type("My Notes{Enter}{Tab}A1{Escape}");

    await expectTree(`
My Notes
  A1
  [S] B1
  [S] B2
  [S] B3
  [VO] +4 -1
    `);

    // eslint-disable-next-line testing-library/no-node-access
    const versionElement = document.querySelector(
      '[data-virtual-type="version"]'
    )!;
    fireEvent.dragStart(versionElement);
    fireEvent.drop(screen.getByLabelText("collapse My Notes"));

    await expectTree(`
My Notes
  [VO] +4 -2
  A1
  [S] B1
  [S] B2
  [S] B3
    `);
  });
});
