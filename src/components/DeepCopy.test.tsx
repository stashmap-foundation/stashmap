import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  CAROL,
  expectTree,
  findNewNodeEditor,
  follow,
  navigateToNodeViaSearch,
  renderApp,
  renderTree,
  setup,
} from "../utils.test";

describe("Deep Copy - Tab Indent", () => {
  test("Tab indent preserves children of moved node", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create: My Notes → Sibling, Parent (Tab moves to PREVIOUS sibling)
    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Sibling{Enter}Parent{Escape}"
    );

    // Now add GrandChild under Parent
    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("edit Parent"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "GrandChild{Escape}");

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

    // Create: My Notes → Sibling, Sibling 2
    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Sibling{Enter}Sibling 2{Escape}"
    );

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

    // Create: My Notes → Sibling, Parent → Child → GrandChild
    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Sibling{Enter}Parent{Enter}{Tab}Child{Enter}{Tab}GrandChild{Escape}"
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
});

describe("Deep Copy - Cross-Pane DnD", () => {
  test("Cross-pane drag deep copies node with children", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    // Create: My Notes → Source → Child A, Child B
    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Source{Enter}{Tab}Child A{Enter}Child B{Escape}"
    );

    await expectTree(`
My Notes
  Source
    Child A
    Child B
    `);

    // Open split pane
    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);

    // Navigate pane 1 to Source
    await navigateToNodeViaSearch(1, "Source");
    await screen.findByLabelText("collapse Source");

    // Drag Child A from pane 0 to My Notes (use collapse button to target tree node, not breadcrumb)
    fireEvent.dragStart(screen.getAllByText("Child A")[0]);
    fireEvent.drop(screen.getAllByLabelText("collapse My Notes")[0]);

    // Child A should appear under My Notes (deep copied)
    // Pane 1 shows Source as root
    await expectTree(`
My Notes
  Child A
  Source
    Child A
    Child B
Source
    `);
  });

  test("Cross-pane drag deep copies entire subtree including grandchildren", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    // Create: My Notes → Parent → Child → GrandChild, then add Target
    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Parent{Enter}{Tab}Child{Enter}{Tab}GrandChild{Escape}"
    );

    // Add Target as sibling to Parent (collapse Parent first so Enter creates sibling)
    await userEvent.click(await screen.findByLabelText("collapse Parent"));
    const parentEditor = await screen.findByLabelText("edit Parent");
    await userEvent.click(parentEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Target{Escape}");
    // Re-expand Parent
    await userEvent.click(await screen.findByLabelText("expand Parent"));

    // Expand Target
    await userEvent.click(await screen.findByLabelText("expand Target"));

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
    await screen.findByLabelText("collapse Target");

    // Use toggle buttons as drop targets - they only exist in tree items, not breadcrumbs
    const targetToggleBtns = screen.getAllByLabelText(
      /(?:expand|collapse) Target/
    );

    // Drag Parent from pane 0 to Target in pane 1 (cross-pane = deep copy)
    fireEvent.dragStart(screen.getAllByText("Parent")[0]);
    fireEvent.drop(targetToggleBtns[1]);

    // Parent with Child and GrandChild should be deep copied under Target
    // Pane 1 shows Target as root
    await expectTree(`
My Notes
  Parent
    Child
      GrandChild
  Target
    Parent
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

    // Create: My Notes → Source → Child, Target → Source → Another Child
    // First create Source with Child
    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Source{Enter}{Tab}Child{Escape}"
    );

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
    const targetToggleBtns = screen.getAllByLabelText(
      /(?:expand|collapse) Target/
    );
    fireEvent.dragStart(screen.getAllByText("Source")[0]);
    fireEvent.drop(targetToggleBtns[1]);

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
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "BobFolder{Enter}{Tab}Original{Escape}"
    );

    // Bob edits "Original" to "Bob Edited" - this creates a ~Versions entry
    const sourceEditor = await screen.findByLabelText("edit Original");
    await userEvent.click(sourceEditor);
    await userEvent.clear(sourceEditor);
    await userEvent.type(sourceEditor, "Bob Edited");
    fireEvent.blur(sourceEditor);

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
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Target{Escape}");
    await userEvent.click(await screen.findByLabelText("expand Target"));

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
    Bob Edited
    `);

    // Open split pane and navigate pane 1 to Target
    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    await expectTree(`
My Notes
  Target
  [S] BobFolder
    Bob Edited
Target
    `);

    // Drag BobFolder from pane 0 to Target in pane 1 (cross-pane deep copy)
    // Use toggle buttons as drop targets - they only exist in tree items, not breadcrumbs
    const bobFolderElements = screen.getAllByText("BobFolder");
    const targetToggleBtns = screen.getAllByLabelText(
      /(?:expand|collapse) Target/
    );
    fireEvent.dragStart(bobFolderElements[0]);
    fireEvent.drop(targetToggleBtns[1]);

    // After copy, Alice sees "Bob Edited" because Bob's ~Versions were copied
    // and became Alice's ~Versions for that context
    await expectTree(`
My Notes
  Target
    BobFolder
  [S] BobFolder
    Bob Edited
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
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "BobItem{Escape}");

    await expectTree(`
My Notes
  BobItem
    `);

    cleanup();

    // Alice follows Bob and creates Target
    await follow(alice, bob().user.publicKey);
    renderTree(alice);

    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Target{Escape}");

    await expectTree(`
My Notes
  Target
  [S] BobItem
    `);

    // Drag [S] BobItem and drop on Target (same pane = sibling reorder)
    // This should accept the suggestion and place it before Target
    fireEvent.dragStart(screen.getByText("BobItem"));
    fireEvent.drop(screen.getByText("Target"));

    // BobItem should be accepted (no [S] prefix) and placed before Target
    // The original suggestion should be GONE (not duplicated)
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
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "BobItem{Escape}");

    await expectTree(`
My Notes
  BobItem
    `);

    cleanup();

    // Alice follows Bob and creates Target
    await follow(alice, bob().user.publicKey);
    renderApp(alice());

    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Target{Escape}");
    await userEvent.click(await screen.findByLabelText("expand Target"));

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
    const targetToggleBtns = screen.getAllByLabelText(
      /(?:expand|collapse) Target/
    );
    fireEvent.dragStart(bobItemElements[0]);
    fireEvent.drop(targetToggleBtns[1]);

    // BobItem should appear under Target (as child) without [S] prefix
    // Original [S] BobItem remains in pane 0 (cross-pane copies, doesn't move)
    await expectTree(`
My Notes
  Target
    BobItem
  [S] BobItem
Target
  BobItem
    `);
  });

  test("B1: Same-pane DnD suggestion with collapsed children deep copies all including grandchildren", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    // Bob creates Folder with children and grandchildren
    renderTree(bob);
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Folder{Enter}{Tab}Child{Enter}{Tab}GrandChild1{Enter}GrandChild2{Escape}"
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

    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Target{Escape}");

    // [S] Folder is collapsed by default
    await expectTree(`
My Notes
  Target
  [S] Folder
    `);

    // Drag collapsed [S] Folder and drop on Target (same pane = sibling)
    fireEvent.dragStart(screen.getByText("Folder"));
    fireEvent.drop(screen.getByText("Target"));

    // Folder should be accepted (no [S]) and placed before Target
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
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Folder{Enter}{Tab}Child{Enter}{Tab}GrandChild1{Enter}GrandChild2{Escape}"
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

    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Target{Escape}");
    await userEvent.click(await screen.findByLabelText("expand Target"));

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
    const targetToggleBtns = screen.getAllByLabelText(
      /(?:expand|collapse) Target/
    );
    fireEvent.dragStart(folderElements[0]);
    fireEvent.drop(targetToggleBtns[1]);

    // Folder should appear under Target (cross-pane keeps original [S] Folder)
    await expectTree(`
My Notes
  Target
    Folder
  [S] Folder
Target
  Folder
    `);

    // Expand Folder in pane 1 to verify Child was deep copied
    // There are 3 Folder expand buttons: pane 0's Target->Folder, pane 0's [S] Folder, pane 1's Folder
    const expandFolderBtns = screen.getAllByLabelText("expand Folder");
    await userEvent.click(expandFolderBtns[2]);

    await expectTree(`
My Notes
  Target
    Folder
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
    Folder
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
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "BobFolder{Enter}{Tab}BobChild{Escape}"
    );

    await expectTree(`
My Notes
  BobFolder
    BobChild
    `);

    cleanup();

    // Alice creates Target with AliceChild
    renderTree(alice);
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Target{Enter}{Tab}AliceChild{Escape}"
    );

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

    // Drag [S] BobFolder and drop on AliceChild (inserts before AliceChild as sibling under Target)
    fireEvent.dragStart(screen.getByText("BobFolder"));
    fireEvent.drop(screen.getByText("AliceChild"));

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
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "BobFolder{Enter}{Tab}BobChild{Enter}{Tab}BobGrandChild{Escape}"
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
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Target{Enter}{Tab}AliceChild{Escape}"
    );

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
    `);

    // Drag [S] BobFolder from pane 0 to Target root in pane 1
    // Use toggle buttons as drop targets - they only exist in tree items, not breadcrumbs
    const bobFolderElements = screen.getAllByText("BobFolder");
    const targetToggleBtns = screen.getAllByLabelText(
      /(?:expand|collapse) Target/
    );
    fireEvent.dragStart(bobFolderElements[0]);
    fireEvent.drop(targetToggleBtns[1]);

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
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "BobItem{Escape}");

    await expectTree(`
My Notes
  BobItem
    `);

    cleanup();

    // Alice follows Bob
    await follow(alice, bob().user.publicKey);
    renderTree(alice);

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
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "BobItem{Escape}");

    await expectTree(`
My Notes
  BobItem
    `);

    cleanup();

    // Alice follows Bob
    await follow(alice, bob().user.publicKey);
    renderTree(alice);

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

    // Now mark it as not relevant (delete it)
    const markNotRelevant = screen.getByLabelText(
      "mark BobItem as not relevant"
    );
    fireEvent.click(markNotRelevant);

    // Enable not_relevant filter to see it again
    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));

    // Should see exactly ONE BobItem (not multiplied)
    const bobItems = screen.getAllByText("BobItem");
    expect(bobItems.length).toBe(1);

    // Remove from list completely
    const removeBtn = screen.getByLabelText("remove BobItem from list");
    fireEvent.click(removeBtn);

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
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "BobFolder{Enter}{Tab}BobChild{Escape}"
    );

    await expectTree(`
My Notes
  BobFolder
    BobChild
    `);

    cleanup();

    // Alice follows Bob
    await follow(alice, bob().user.publicKey);
    renderTree(alice);

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
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "BobItem{Escape}");

    await expectTree(`
My Notes
  BobItem
    `);

    cleanup();

    await follow(alice, bob().user.publicKey);
    renderTree(alice);

    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Target{Escape}");

    await expectTree(`
My Notes
  Target
  [S] BobItem
    `);

    fireEvent.dragStart(screen.getByText("BobItem"));
    fireEvent.drop(screen.getByText("Target"));

    await expectTree(`
My Notes
  BobItem
  Target
    `);
  });

  test("E2: Cross-pane DnD simple suggestion into target", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(bob);
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "BobItem{Escape}");

    cleanup();

    await follow(alice, bob().user.publicKey);
    renderApp(alice());

    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Target{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Target"));

    await expectTree(`
My Notes
  Target
  [S] BobItem
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    // Use toggle buttons as drop targets - they only exist in tree items, not breadcrumbs
    const targetToggleBtns = screen.getAllByLabelText(
      /(?:expand|collapse) Target/
    );
    fireEvent.dragStart(screen.getAllByText("BobItem")[0]);
    fireEvent.drop(targetToggleBtns[1]);

    await expectTree(`
My Notes
  Target
    BobItem
  [S] BobItem
Target
  BobItem
    `);
  });
});

describe("Deep Copy - Edit Restrictions", () => {
  test("I: Abstract references cannot be dragged", async () => {
    const [alice, bob, carol] = setup([ALICE, BOB, CAROL]);

    renderTree(bob);
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Holiday Destinations{Enter}{Tab}Barcelona{Escape}"
    );

    await expectTree(`
My Notes
  Holiday Destinations
    Barcelona
    `);

    cleanup();

    renderTree(carol);
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Holiday Destinations{Enter}{Tab}Malaga{Escape}"
    );

    await expectTree(`
My Notes
  Holiday Destinations
    Malaga
    `);

    cleanup();

    await follow(alice, bob().user.publicKey);
    await follow(alice, carol().user.publicKey);
    renderTree(alice);

    await expectTree(`
My Notes
  [S] My Notes → Holiday Destinations
    `);

    // Verify abstract references are not draggable by checking the draggable attribute
    const holidayText = screen.getByText("My Notes → Holiday Destinations");
    // eslint-disable-next-line testing-library/no-node-access
    const holidayItem = holidayText.closest(".item");
    expect(holidayItem).not.toBeNull();
    expect(holidayItem?.getAttribute("draggable")).not.toBe("true");
  });

  test("H: Children of suggestions cannot be edited", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(bob);
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "BobFolder{Enter}{Tab}BobChild{Escape}"
    );

    await expectTree(`
My Notes
  BobFolder
    BobChild
    `);

    cleanup();

    await follow(alice, bob().user.publicKey);
    renderTree(alice);

    await expectTree(`
My Notes
  [S] BobFolder
    `);

    await userEvent.click(await screen.findByLabelText("expand BobFolder"));

    await expectTree(`
My Notes
  [S] BobFolder
    BobChild
    `);

    // Children of suggestions should not have edit buttons
    expect(screen.queryByLabelText("edit BobChild")).toBeNull();
  });
});
