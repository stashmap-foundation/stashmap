import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  expectTree,
  findNewNodeEditor,
  renderTree,
  setup,
} from "../utils.test";

describe("Empty node with typed text - relevance", () => {
  test("typing text then clicking relevant materializes node with bold styling", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}{Tab}Child");

    // Click "relevant" while text is typed but not saved
    fireEvent.click(screen.getByLabelText("set Child to relevant"));

    // Node should be materialized
    await expectTree(`
My Notes
  Parent
    Child
    `);

    // Check bold styling (fontWeight: 600) - style is on parent span
    const childNode = await screen.findByLabelText("edit Child");
    const styledSpan = childNode.closest("span[style*='font-weight']") as HTMLElement;
    expect(styledSpan?.style.fontWeight).toBe("600");
  });

  test("typing text then clicking little relevant materializes with opacity styling", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}{Tab}Faded");

    // Click "little relevant"
    fireEvent.click(screen.getByLabelText("set Faded to little relevant"));

    // Node should be hidden (default filters exclude little_relevant)
    await waitFor(() => {
      expect(screen.queryByText("Faded")).toBeNull();
    });

    // Enable little_relevant filter to verify node was created
    await userEvent.click(screen.getByLabelText("filter Parent"));
    await userEvent.click(await screen.findByText("Little Relevant"));

    await expectTree(`
My Notes
  Parent
    Faded
    `);

    // Check opacity styling - style is on parent span
    const fadedNode = await screen.findByLabelText("edit Faded");
    const styledSpan = fadedNode.closest("span[style*='opacity']") as HTMLElement;
    expect(styledSpan?.style.opacity).toBe("0.5");
  });

  test("typing text then clicking not relevant materializes and hides node", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}{Tab}Hidden");

    fireEvent.click(screen.getByLabelText("mark Hidden as not relevant"));

    // Node should be hidden (default filters exclude not_relevant)
    await waitFor(() => {
      expect(screen.queryByText("Hidden")).toBeNull();
    });

    // Enable not_relevant filter to verify node was created
    await userEvent.click(screen.getByLabelText("filter Parent"));
    await userEvent.click(await screen.findByText("Not Relevant"));

    // Check strikethrough and opacity styling - style is on parent span
    const hiddenNode = await screen.findByLabelText("edit Hidden");
    const styledSpan = hiddenNode.closest("span[style*='opacity']") as HTMLElement;
    expect(styledSpan?.style.opacity).toBe("0.4");
    expect(styledSpan?.style.textDecoration).toBe("line-through");
  });
});

describe("Empty node with typed text - argument", () => {
  test("typing text then clicking confirms materializes node with green background", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}{Tab}Evidence");

    // Click the evidence selector to set "confirms"
    const evidenceButton = screen.getByLabelText(/Evidence for Evidence/);
    fireEvent.click(evidenceButton);

    await expectTree(`
My Notes
  Parent
    Evidence
    `);

    // Check green background (confirms color) - style is on parent span
    const evidenceNode = await screen.findByLabelText("edit Evidence");
    const styledSpan = evidenceNode.closest("span[style*='background']") as HTMLElement;
    expect(styledSpan?.style.backgroundColor).toContain("46, 125, 50");
  });
});

describe("Editing existing node - relevance", () => {
  test("changing relevance while editing saves text and applies bold styling", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}{Tab}Original{Escape}");

    await expectTree(`
My Notes
  Parent
    Original
    `);

    // Edit the node text
    const editor = await screen.findByLabelText("edit Original");
    await userEvent.click(editor);
    await userEvent.clear(editor);
    await userEvent.type(editor, "Edited");

    // Change relevance while editing - this should save the text AND set relevance
    fireEvent.click(screen.getByLabelText("set Edited to relevant"));

    // Text should be saved and node should show new text with bold styling
    await expectTree(`
My Notes
  Parent
    Edited
    `);

    // Check bold styling - style is on parent span
    const editedNode = await screen.findByLabelText("edit Edited");
    const styledSpan = editedNode.closest("span[style*='font-weight']") as HTMLElement;
    expect(styledSpan?.style.fontWeight).toBe("600");
  });
});

describe("Empty node - filter button", () => {
  test("filter button is disabled for empty node", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}{Tab}Child");

    // Empty node should have a disabled filter button
    // The aria-label uses the typed text "Child"
    const filterButton = screen.getByLabelText("filter Child");
    expect(filterButton.hasAttribute("disabled")).toBe(true);
  });
});

describe("Empty node - add button materializes first", () => {
  test("clicking add on empty node with text materializes it first", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}{Tab}Child");

    // Click add button - should materialize "Child" first, then create new empty node
    fireEvent.click(screen.getByLabelText("add to Child"));

    // Both Parent and Child should be materialized, plus a new empty node
    await expectTree(`
My Notes
  Parent
    Child
    [NEW NODE]
    `);

    // Verify we can find the new node editor
    await findNewNodeEditor();
  });
});

describe("Empty node - search button saves and adds", () => {
  test("clicking search on empty node, adding result materializes node and adds result", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}{Tab}Child");

    fireEvent.click(screen.getByLabelText("search and attach to Child"));

    const searchInput = await screen.findByLabelText("search input");
    await userEvent.type(searchInput, "My Notes");
    await userEvent.click(await screen.findByLabelText("select My Notes"));

    await expectTree(`
My Notes
  Parent
    Child
    My Notes
    `);
  });

  test("clicking search while editing existing node saves edit and adds result", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}{Tab}Child{Escape}");

    await expectTree(`
My Notes
  Parent
    Child
    `);

    const childEditor = await screen.findByLabelText("edit Child");
    await userEvent.click(childEditor);
    await userEvent.clear(childEditor);
    await userEvent.type(childEditor, "Edited");

    fireEvent.click(screen.getByLabelText("search and attach to Edited"));

    const searchInput = await screen.findByLabelText("search input");
    await userEvent.type(searchInput, "My Notes");
    await userEvent.click(await screen.findByLabelText("select My Notes"));

    await expectTree(`
My Notes
  Parent
    Edited
    My Notes
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
My Notes
  Parent
    Edited
    My Notes
    `);
  });
});
