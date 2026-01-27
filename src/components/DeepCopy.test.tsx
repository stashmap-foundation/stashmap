import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  expectTree,
  findNewNodeEditor,
  follow,
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
    await userEvent.click(await screen.findByLabelText("add to Parent"));
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
    await userEvent.click(
      await screen.findByLabelText("Search to change pane 1 content")
    );
    await userEvent.type(
      await screen.findByLabelText("search input"),
      "Source"
    );
    await userEvent.click(await screen.findByLabelText("select Source"));
    await screen.findByLabelText("collapse Source");

    // Drag Child A from pane 0 to My Notes
    fireEvent.dragStart(screen.getAllByText("Child A")[0]);
    fireEvent.drop(screen.getAllByText("My Notes")[0]);

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
    await userEvent.click(
      await screen.findByLabelText("Search to change pane 1 content")
    );
    await userEvent.type(
      await screen.findByLabelText("search input"),
      "Target"
    );
    await userEvent.click(await screen.findByLabelText("select Target"));
    await screen.findByLabelText("collapse Target");

    // Drag Parent from pane 0 to Target in pane 1 (cross-pane = deep copy)
    fireEvent.dragStart(screen.getAllByText("Parent")[0]);
    fireEvent.drop(screen.getAllByText("Target")[1]);

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

  test("Cross-pane drag overwrites existing children with new copy", async () => {
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
    await userEvent.click(
      await screen.findByLabelText("Search to change pane 1 content")
    );
    await userEvent.type(
      await screen.findByLabelText("search input"),
      "Target"
    );
    await userEvent.click(await screen.findByLabelText("select Target"));
    await screen.findByLabelText("collapse Target");

    // Drag Source from pane 0 to Target in pane 1
    fireEvent.dragStart(screen.getAllByText("Source")[0]);
    fireEvent.drop(screen.getAllByText("Target")[1]);

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
    await userEvent.click(await screen.findByLabelText("add to My Notes"));
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
    await userEvent.click(await screen.findByLabelText("add to My Notes"));
    await userEvent.type(await findNewNodeEditor(), "Target{Escape}");
    await userEvent.click(await screen.findByLabelText("expand Target"));

    await expectTree(`
My Notes
  Target
  [S] BobFolder
    `);

    // Expand BobFolder diff item to see its children
    await userEvent.click(await screen.findByLabelText("expand BobFolder"));

    // Note: Alice sees "Original" because onlyMine=true ignores Bob's ~Versions
    await expectTree(`
My Notes
  Target
  BobFolder
    Original
    `);

    // Open split pane and navigate pane 1 to Target
    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await userEvent.click(
      await screen.findByLabelText("Search to change pane 1 content")
    );
    await userEvent.type(
      await screen.findByLabelText("search input"),
      "Target"
    );
    await userEvent.click(await screen.findByLabelText("select Target"));

    await expectTree(`
My Notes
  Target
  BobFolder
    Original
Target
    `);

    // Drag BobFolder from pane 0 to Target in pane 1 (cross-pane deep copy)
    fireEvent.dragStart(screen.getAllByText("BobFolder")[0]);
    fireEvent.drop(screen.getAllByText("Target")[1]);

    // After copy, Alice sees "Bob Edited" because Bob's ~Versions were copied
    // and became Alice's ~Versions for that context
    await expectTree(`
My Notes
  Target
  BobFolder
    Original
Target
  BobFolder
    Bob Edited
    `);
  });
});
