import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  expectTree,
  findNewNodeEditor,
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
});

describe("Deep Copy - Search Attach", () => {
  test("Search attach copies children to new context", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create: My Notes → Source → Child A, Child B, Target
    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Source{Enter}{Tab}Child A{Enter}Child B{Escape}"
    );

    const sourceEditor = await screen.findByLabelText("edit Source");
    await userEvent.click(sourceEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Target{Escape}");

    await expectTree(`
My Notes
  Source
    Child A
    Child B
  Target
    `);

    // Expand Target and search-attach Source
    await userEvent.click(await screen.findByLabelText("expand Target"));
    fireEvent.click(await screen.findByLabelText("search and attach to Target"));
    await userEvent.type(await screen.findByLabelText("search input"), "Source");
    await userEvent.click(await screen.findByLabelText("select Source"));

    await expectTree(`
My Notes
  Source
    Child A
    Child B
  Target
    Source
      Child A
      Child B
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
My Notes
  Source
    Child A
    Child B
  Target
    Source
      Child A
      Child B
    `);
  });

  test("Search attach on existing relation keeps current view", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create: My Notes → Source → Original, Target
    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Source{Enter}{Tab}Original{Escape}"
    );

    const sourceEditor = await screen.findByLabelText("edit Source");
    await userEvent.click(sourceEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Target{Escape}");

    await expectTree(`
My Notes
  Source
    Original
  Target
    `);

    // First: search-attach Source to Target
    await userEvent.click(await screen.findByLabelText("expand Target"));
    fireEvent.click(await screen.findByLabelText("search and attach to Target"));
    await userEvent.type(await screen.findByLabelText("search input"), "Source");
    await userEvent.click(await screen.findByLabelText("select Source"));

    // Add "Modified" under Source in Target context
    const expandSourceButtons = await screen.findAllByLabelText("expand Source");
    await userEvent.click(expandSourceButtons[1]);
    const addToSourceButtons = await screen.findAllByLabelText("add to Source");
    await userEvent.click(addToSourceButtons[1]);
    await userEvent.type(await findNewNodeEditor(), "Modified{Escape}");

    await expectTree(`
My Notes
  Source
    Original
  Target
    Source
      Original
      Modified
    `);

    // Second: search-attach Source to Target again
    fireEvent.click(await screen.findByLabelText("search and attach to Target"));
    await userEvent.type(await screen.findByLabelText("search input"), "Source");
    await userEvent.click(await screen.findByLabelText("select Source"));

    // Should still show Modified (existing relation view preserved)
    await expectTree(`
My Notes
  Source
    Original
  Target
    Source
      Original
      Modified
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
    await userEvent.type(await screen.findByLabelText("search input"), "Source");
    await userEvent.click(await screen.findByLabelText("select Source"));
    await screen.findByLabelText("collapse Source");

    // Drag Child A from pane 0 to My Notes
    fireEvent.dragStart(screen.getAllByText("Child A")[0]);
    fireEvent.drop(screen.getAllByText("My Notes")[0]);

    // Child A should appear under My Notes (deep copied)
    await expectTree(`
My Notes
  Child A
  Source
    Child A
    Child B
    `);
  });

  test("Cross-pane drag deep copies entire subtree including grandchildren", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    // Create: My Notes → Parent → Child → GrandChild
    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Parent{Enter}{Tab}Child{Enter}{Tab}GrandChild{Escape}"
    );

    await expectTree(`
My Notes
  Parent
    Child
      GrandChild
    `);

    // Open split pane and navigate to Parent
    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await userEvent.click(
      await screen.findByLabelText("Search to change pane 1 content")
    );
    await userEvent.type(await screen.findByLabelText("search input"), "Parent");
    await userEvent.click(await screen.findByLabelText("select Parent"));
    await screen.findByLabelText("collapse Parent");

    // Drag Parent from pane 0 to My Notes
    fireEvent.dragStart(screen.getAllByText("Parent")[0]);
    fireEvent.drop(screen.getAllByText("My Notes")[0]);

    // Parent with Child and GrandChild should be deep copied under My Notes
    await expectTree(`
My Notes
  Parent
    Child
      GrandChild
  Parent
    Child
      GrandChild
    `);
  });

  test("Cross-pane drag overwrites existing relation with new copy", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    // Create: My Notes → Source → Original Child, Target
    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Source{Enter}{Tab}Original Child{Escape}"
    );

    const sourceEditor = await screen.findByLabelText("edit Source");
    await userEvent.click(sourceEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Target{Escape}");

    // Add Source under Target with Different Child
    await userEvent.click(await screen.findByLabelText("expand Target"));
    fireEvent.click(await screen.findByLabelText("search and attach to Target"));
    await userEvent.type(await screen.findByLabelText("search input"), "Source");
    await userEvent.click(await screen.findByLabelText("select Source"));

    const expandSourceButtons = await screen.findAllByLabelText("expand Source");
    await userEvent.click(expandSourceButtons[1]);
    const addToSourceButtons = await screen.findAllByLabelText("add to Source");
    await userEvent.click(addToSourceButtons[1]);
    await userEvent.type(await findNewNodeEditor(), "Different Child{Escape}");

    await expectTree(`
My Notes
  Source
    Original Child
  Target
    Source
      Original Child
      Different Child
    `);

    // Open split pane and navigate to Target
    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await userEvent.click(
      await screen.findByLabelText("Search to change pane 1 content")
    );
    await userEvent.type(await screen.findByLabelText("search input"), "Target");
    await userEvent.click(await screen.findByLabelText("select Target"));
    await screen.findByLabelText("collapse Target");

    // Drag Source from pane 0 to Target in pane 1
    fireEvent.dragStart(screen.getAllByText("Source")[0]);
    fireEvent.drop(screen.getAllByText("Target")[1]);

    // After DnD, Target should show Source with Original Child (NEW copied relation)
    // not Different Child (the existing relation is overwritten in view)
    await expectTree(`
My Notes
  Source
    Original Child
  Target
    Source
      Original Child
    `);
  });
});
