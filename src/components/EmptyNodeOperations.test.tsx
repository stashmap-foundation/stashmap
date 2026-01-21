import { fireEvent, screen, waitFor } from "@testing-library/react";
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

    // Check bold styling (fontWeight: 600)
    const childNode = await screen.findByLabelText("edit Child");
    expect(childNode.style.fontWeight).toBe("600");
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

    await expectTree(`
My Notes
  Parent
    Faded
    `);

    // Check opacity styling
    const fadedNode = await screen.findByLabelText("edit Faded");
    expect(fadedNode.style.opacity).toBe("0.5");
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

    // Check strikethrough and opacity styling
    const hiddenNode = await screen.findByLabelText("edit Hidden");
    expect(hiddenNode.style.opacity).toBe("0.4");
    expect(hiddenNode.style.textDecoration).toBe("line-through");
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

    // Check green background (confirms color)
    const evidenceNode = await screen.findByLabelText("edit Evidence");
    expect(evidenceNode.style.backgroundColor).toContain("46, 125, 50");
  });
});

describe("Editing existing node - relevance", () => {
  test("changing relevance while editing saves text and applies bold styling after reload", async () => {
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

    // Change relevance while editing
    fireEvent.click(screen.getByLabelText("set Edited to relevant"));

    // Simulate reload
    renderTree(alice);

    // Navigate to Parent to see the child
    await userEvent.click(await screen.findByLabelText("expand Parent"));

    // Text should be saved after reload
    await expectTree(`
My Notes
  Parent
    Edited
    `);

    // Check bold styling persists after reload
    const editedNode = await screen.findByLabelText("edit Edited");
    expect(editedNode.style.fontWeight).toBe("600");
  });
});
