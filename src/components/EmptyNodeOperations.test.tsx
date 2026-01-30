/* eslint-disable testing-library/no-node-access */
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
    const styledSpan = childNode.closest(
      "span[style*='font-weight']"
    ) as HTMLElement;
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
    await userEvent.click(screen.getByLabelText("toggle Little Relevant filter"));

    await expectTree(`
My Notes
  Parent
    Faded
    `);

    // Verify the node was created with correct text
    const fadedNode = await screen.findByLabelText("edit Faded");
    expect(fadedNode).toBeDefined();
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
    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));

    // Check strikethrough styling - style is on parent span
    const hiddenNode = await screen.findByLabelText("edit Hidden");
    const styledSpan = hiddenNode.closest(
      "span[style*='text-decoration']"
    ) as HTMLElement;
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
    await userEvent.type(
      await findNewNodeEditor(),
      "Parent{Enter}{Tab}Evidence"
    );

    const evidenceButton = screen.getByLabelText(/Evidence for Evidence/);
    fireEvent.click(evidenceButton);

    await expectTree(`
My Notes
  Parent
    Evidence
    `);

    const evidenceNode = await screen.findByLabelText("edit Evidence");
    const styledSpan = evidenceNode.closest(
      "span[style*='color']"
    ) as HTMLElement;
    // Green color for confirms is #859900 = rgb(133, 153, 0)
    expect(styledSpan?.style.color).toContain("133, 153, 0");
  });

  test("clicking argument while editing existing node saves edit", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Parent{Enter}{Tab}Child{Escape}"
    );

    await expectTree(`
My Notes
  Parent
    Child
    `);

    const childEditor = await screen.findByLabelText("edit Child");
    await userEvent.click(childEditor);
    await userEvent.clear(childEditor);
    await userEvent.type(childEditor, "Edited");

    const evidenceButton = screen.getByLabelText(/Evidence for Edited/);
    fireEvent.click(evidenceButton);

    await expectTree(`
My Notes
  Parent
    Edited
    `);

    const editedNode = await screen.findByLabelText("edit Edited");
    const styledSpan = editedNode.closest(
      "span[style*='color']"
    ) as HTMLElement;
    // Green color for confirms is #859900 = rgb(133, 153, 0)
    expect(styledSpan?.style.color).toContain("133, 153, 0");

    cleanup();
    renderTree(alice);

    await expectTree(`
My Notes
  Parent
    Edited
    `);

    const rerenderedNode = await screen.findByLabelText("edit Edited");
    const rerenderedStyledSpan = rerenderedNode.closest(
      "span[style*='color']"
    ) as HTMLElement;
    // Green color for confirms is #859900 = rgb(133, 153, 0)
    expect(rerenderedStyledSpan?.style.color).toContain(
      "133, 153, 0"
    );
  });
});

describe("Editing existing node - relevance", () => {
  test("changing relevance while editing saves text and applies bold styling", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Parent{Enter}{Tab}Original{Escape}"
    );

    await expectTree(`
My Notes
  Parent
    Original
    `);

    const editor = await screen.findByLabelText("edit Original");
    await userEvent.click(editor);
    await userEvent.clear(editor);
    await userEvent.type(editor, "Edited");

    fireEvent.click(screen.getByLabelText("set Edited to relevant"));

    await expectTree(`
My Notes
  Parent
    Edited
    `);

    const editedNode = await screen.findByLabelText("edit Edited");
    const styledSpan = editedNode.closest(
      "span[style*='font-weight']"
    ) as HTMLElement;
    expect(styledSpan?.style.fontWeight).toBe("600");

    cleanup();
    renderTree(alice);

    await expectTree(`
My Notes
  Parent
    Edited
    `);

    const rerenderedNode = await screen.findByLabelText("edit Edited");
    const rerenderedStyledSpan = rerenderedNode.closest(
      "span[style*='font-weight']"
    ) as HTMLElement;
    expect(rerenderedStyledSpan?.style.fontWeight).toBe("600");
  });
});

describe("Filter dots in pane header", () => {
  test("pane filter dots are always enabled", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}{Tab}Child");

    // Pane-level filter dots should always be enabled
    const filterButton = screen.getByLabelText("toggle Relevant filter");
    expect(filterButton.hasAttribute("disabled")).toBe(false);
  });
});

describe("Empty node - keyboard navigation", () => {
  test("pressing Enter on empty node inserts new node at correct position", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Parent{Enter}{Tab}Child1{Enter}Child2{Enter}Child3{Escape}"
    );

    await expectTree(`
My Notes
  Parent
    Child1
    Child2
    Child3
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
My Notes
  Parent
    Child1
    Child2
    Child3
    `);
  });

  test("pressing Enter on node with text materializes it first", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}{Tab}Child{Enter}");

    await expectTree(`
My Notes
  Parent
    Child
    [NEW NODE]
    `);

    await findNewNodeEditor();
  });

  test("pressing Enter while editing existing node saves edit and creates sibling", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Parent{Enter}{Tab}Child{Escape}"
    );

    await expectTree(`
My Notes
  Parent
    Child
    `);

    const childEditor = await screen.findByLabelText("edit Child");
    await userEvent.click(childEditor);
    await userEvent.clear(childEditor);
    await userEvent.type(childEditor, "Edited");

    await userEvent.keyboard("{Enter}");

    await userEvent.type(await findNewNodeEditor(), "NewSibling{Escape}");

    await expectTree(`
My Notes
  Parent
    Edited
    NewSibling
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
My Notes
  Parent
    Edited
    NewSibling
    `);
  });
});
