import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  expectTree,
  findNewNodeEditor,
  navigateToNodeViaSearch,
  renderApp,
  setDropIndentLevel,
  setup,
  type,
} from "../utils.test";

function getSelectedNodes(): string[] {
  return Array.from(
    document.querySelectorAll('.item[data-selected="true"]')
  ).map((el) => el.getAttribute("data-node-text") || "");
}

function getActionTargets(): string[] {
  const selected = getSelectedNodes();
  if (selected.length > 0) {
    return selected;
  }
  /* eslint-disable testing-library/no-node-access */
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    const item = active.closest('.item[data-row-focusable="true"]');
    if (item) {
      return [item.getAttribute("data-node-text") || ""];
    }
  }
  /* eslint-enable testing-library/no-node-access */
  return [];
}

async function expectTargets(...expected: string[]): Promise<void> {
  await waitFor(() => {
    expect(getActionTargets()).toEqual(expected);
  });
}

async function expectNoTargets(): Promise<void> {
  await waitFor(() => {
    expect(getActionTargets()).toEqual([]);
  });
}

async function clickRow(name: string): Promise<void> {
  const row = await screen.findByLabelText(name);
  await userEvent.click(row);
}

function modClick(
  el: HTMLElement,
  modifiers: { metaKey?: boolean; shiftKey?: boolean }
): void {
  fireEvent.click(el, modifiers);
}

describe("Selection via keyboard", () => {
  test("Shift+j selects current row and moves focus down", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");
  });

  test("Shift+j extends selection further down", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B", "C");
  });

  test("Shift+k selects current row and moves focus up", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("C");
    await userEvent.keyboard("{Shift>}k{/Shift}");
    await expectTargets("B", "C");
  });

  test("Shift+k extends selection further up", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("C");
    await userEvent.keyboard("{Shift>}k{/Shift}");
    await userEvent.keyboard("{Shift>}k{/Shift}");
    await expectTargets("A", "B", "C");
  });

  test("Shift+j then Shift+k shrinks selection (rubber-band)", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B", "C");
    await userEvent.keyboard("{Shift>}k{/Shift}");
    await expectTargets("A", "B");
  });

  test("Shift+k then Shift+j shrinks selection (rubber-band upward)", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("C");
    await userEvent.keyboard("{Shift>}k{/Shift}");
    await userEvent.keyboard("{Shift>}k{/Shift}");
    await expectTargets("A", "B", "C");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("B", "C");
  });

  test("plain j preserves selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");
    await userEvent.keyboard("j");
    await expectTargets("A", "B");
  });

  test("plain k preserves selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("B");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("B", "C");
    await userEvent.keyboard("k");
    await expectTargets("B", "C");
  });

  test("Space toggles focused row into selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard(" ");
    await expectTargets("A");
  });

  test("Space toggles focused row out of selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B", "C");
    await userEvent.keyboard(" ");
    await expectTargets("A", "B");
  });

  test("Space enables non-contiguous keyboard selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");
    await clickRow("A");
    await userEvent.keyboard(" ");
    await userEvent.keyboard("jj");
    await userEvent.keyboard(" ");
    await expectTargets("A", "C");
  });

  test("Space deselects individual rows from Shift selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type(
      "Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Enter}E{Enter}F{Escape}"
    );
    await clickRow("A");
    await userEvent.keyboard("{Shift>}jjjjj{/Shift}");
    await expectTargets("A", "B", "C", "D", "E", "F");
    await userEvent.keyboard("k");
    await userEvent.keyboard(" ");
    await expectTargets("A", "B", "C", "D", "F");
    await userEvent.keyboard("kk");
    await userEvent.keyboard(" ");
    await expectTargets("A", "B", "D", "F");
  });

  test("Space then Shift+j does not lose Space-selected rows", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type(
      "Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Enter}E{Enter}F{Enter}G{Escape}"
    );
    await clickRow("B");
    await userEvent.keyboard(" ");
    await userEvent.keyboard("jj");
    await userEvent.keyboard(" ");
    await expectTargets("B", "D");
    await userEvent.keyboard("{Shift>}jjj{/Shift}");
    await expectTargets("B", "D", "E", "F", "G");
  });

  test("Escape clears multi-selection but keeps focus", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");
    await userEvent.keyboard("{Escape}");
    await expectTargets("B");
    await waitFor(() => {
      expect(getSelectedNodes()).toEqual([]);
    });
  });

  test("Escape clears single-row selection but keeps focus", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await clickRow("A");
    await userEvent.keyboard(" ");
    await expectTargets("A");
    await userEvent.keyboard("{Escape}");
    await expectTargets("A");
    await waitFor(() => {
      expect(getSelectedNodes()).toEqual([]);
    });
  });

  test("second Escape blurs focused row", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await clickRow("A");
    await userEvent.keyboard(" ");
    await expectTargets("A");
    await userEvent.keyboard("{Escape}");
    await expectTargets("A");
    await userEvent.keyboard("{Escape}");
    await expectNoTargets();
  });

  test("Shift+ArrowDown works same as Shift+j", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await expectTargets("A", "B");
  });

  test("Shift+ArrowUp works same as Shift+k", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await clickRow("B");
    await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}");
    await expectTargets("A", "B");
  });

  test("Cmd+A selects all visible rows", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Meta>}a{/Meta}");
    await expectTargets("Root", "A", "B", "C");
  });

  test("Cmd+A selects across indent levels", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type(
      "Root{Enter}{Tab}Parent{Enter}{Tab}Child{Enter}{Enter}Sibling{Escape}"
    );
    await clickRow("Root");
    await userEvent.keyboard("{Meta>}a{/Meta}");
    await expectTargets("Root", "Parent", "Child", "Sibling");
  });

  test("selection works across different indent levels", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "A1");
  });

  test("Shift+j descends into expanded children", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}A2{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "A1");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "A1", "A2");
  });
});

describe("Selection via mouse", () => {
  test("click focuses row as action target", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("C");
    await expectTargets("C");
  });

  test("click clears previous selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");

    await clickRow("C");
    await expectTargets("C");
  });

  test("Cmd+click toggles row into selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    modClick(await screen.findByLabelText("A"), { metaKey: true });
    await expectTargets("A");

    modClick(await screen.findByLabelText("B"), { metaKey: true });
    await expectTargets("A", "B");

    modClick(await screen.findByLabelText("C"), { metaKey: true });
    await expectTargets("A", "B", "C");
  });

  test("Cmd+click toggles row out of selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    modClick(await screen.findByLabelText("A"), { metaKey: true });
    modClick(await screen.findByLabelText("B"), { metaKey: true });
    modClick(await screen.findByLabelText("C"), { metaKey: true });
    await expectTargets("A", "B", "C");

    modClick(await screen.findByLabelText("B"), { metaKey: true });
    await expectTargets("A", "C");
  });

  test("Shift+click selects range from anchor to clicked row", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");
    await clickRow("A");
    modClick(await screen.findByLabelText("D"), { shiftKey: true });
    await expectTargets("A", "B", "C", "D");
  });

  test("Shift+click selects range upward", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");
    await clickRow("D");
    modClick(await screen.findByLabelText("A"), { shiftKey: true });
    await expectTargets("A", "B", "C", "D");
  });

  test("Shift+click selects range across different depths", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}A2{Escape}");
    await clickRow("A");
    modClick(await screen.findByLabelText("A2"), { shiftKey: true });
    await expectTargets("A", "A1", "A2");
  });

  test("Cmd+click after Shift selection adds to existing selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");
    await clickRow("A");
    modClick(await screen.findByLabelText("B"), { shiftKey: true });
    await expectTargets("A", "B");

    modClick(await screen.findByLabelText("D"), { metaKey: true });
    await expectTargets("A", "B", "D");
  });
});

async function expectRelevance(
  nodeText: string,
  expected: string
): Promise<void> {
  await waitFor(() => {
    /* eslint-disable testing-library/no-node-access */
    const item = document.querySelector(`.item[data-node-text="${nodeText}"]`);
    const selector = item?.querySelector(".relevance-selector");
    /* eslint-enable testing-library/no-node-access */
    expect(selector?.getAttribute("title")).toBe(expected);
  });
}

describe("Cmd+click includes focused row", () => {
  test("click row then Cmd+click another includes both", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    modClick(await screen.findByLabelText("B"), { metaKey: true });
    await expectTargets("A", "B");
  });

  test("click row then Cmd+click two others includes all three", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    modClick(await screen.findByLabelText("B"), { metaKey: true });
    modClick(await screen.findByLabelText("C"), { metaKey: true });
    await expectTargets("A", "B", "C");
  });
});

describe("Batch relevance via keyboard", () => {
  test("x on selection hides all selected rows", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");
    await userEvent.keyboard("x");
    await expectTree(`
Root
  C
    `);
  });

  test("! on selection sets relevant on all selected", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("!");
    await expectRelevance("A", "Relevant");
    await expectRelevance("B", "Relevant");
    await expectRelevance("C", "Contains");
  });

  test("? on selection sets maybe relevant on all selected", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("?");
    await expectRelevance("A", "Maybe Relevant");
    await expectRelevance("B", "Maybe Relevant");
  });

  test("~ on selection hides all selected (filtered by default)", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("~");
    await expectTree(`
Root
  C
    `);
  });

  test("selection clears after relevance operation", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");
    await userEvent.keyboard("!");
    await waitFor(() => {
      expect(getSelectedNodes()).toEqual([]);
    });
  });

  test("single focused row still works without selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await clickRow("A");
    await userEvent.keyboard("x");
    await expectTree(`
Root
  B
    `);
  });

  test("toggle: ! twice returns to contains", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await clickRow("A");
    await userEvent.keyboard("!");
    await expectRelevance("A", "Relevant");
    await clickRow("A");
    await userEvent.keyboard("!");
    await expectRelevance("A", "Contains");
  });

  test("x on cross-depth selection hides all", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "A1");
    await userEvent.keyboard("x");
    await expectTree(`
Root
    `);
  });
});

describe("Batch relevance via button click", () => {
  test("clicking ! button on selected row applies to all selected", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");
    fireEvent.click(screen.getByLabelText("set A to relevant"));
    await expectRelevance("A", "Relevant");
    await expectRelevance("B", "Relevant");
    await expectRelevance("C", "Contains");
  });

  test("clicking x button on selected row applies to all selected", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    fireEvent.click(screen.getByLabelText("mark A as not relevant"));
    await expectTree(`
Root
  C
    `);
  });

  test("toggle: clicking same level twice returns to contains", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await clickRow("A");
    fireEvent.click(screen.getByLabelText("set A to relevant"));
    await expectRelevance("A", "Relevant");
    fireEvent.click(screen.getByLabelText("set A to relevant"));
    await expectRelevance("A", "Contains");
  });
});

describe("Batch evidence via keyboard", () => {
  test("+ on selection sets confirms on all selected", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("+");
    await screen.findByLabelText(/Evidence for A: Confirms/);
    await screen.findByLabelText(/Evidence for B: Confirms/);
    await screen.findByLabelText(/Evidence for C: No evidence type/);
  });

  test("- on selection sets contradicts on all selected", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("-");
    await screen.findByLabelText(/Evidence for A: Contradicts/);
    await screen.findByLabelText(/Evidence for B: Contradicts/);
  });

  test("o on selection clears evidence on all selected", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("+");
    await screen.findByLabelText(/Evidence for A: Confirms/);
    await screen.findByLabelText(/Evidence for B: Confirms/);
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("o");
    await screen.findByLabelText(/Evidence for A: No evidence type/);
    await screen.findByLabelText(/Evidence for B: No evidence type/);
  });

  test("toggle: + twice clears evidence", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await clickRow("A");
    await userEvent.keyboard("+");
    await screen.findByLabelText(/Evidence for A: Confirms/);
    await clickRow("A");
    await userEvent.keyboard("+");
    await screen.findByLabelText(/Evidence for A: No evidence type/);
  });

  test("selection clears after evidence operation", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");
    await userEvent.keyboard("+");
    await waitFor(() => {
      expect(getSelectedNodes()).toEqual([]);
    });
  });

  test("single focused row still works without selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await clickRow("A");
    await userEvent.keyboard("+");
    await screen.findByLabelText(/Evidence for A: Confirms/);
    await screen.findByLabelText(/Evidence for B: No evidence type/);
  });
});

describe("Batch evidence via button click", () => {
  test("clicking evidence button on selected row cycles for all selected", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");
    fireEvent.click(screen.getByLabelText(/Evidence for A: No evidence type/));
    await screen.findByLabelText(/Evidence for A: Confirms/);
    await screen.findByLabelText(/Evidence for B: Confirms/);
    await screen.findByLabelText(/Evidence for C: No evidence type/);
  });
});

describe("Drag and drop with selection", () => {
  test("dragging a selected row moves all selected rows", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}Target{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");

    fireEvent.dragStart(screen.getByText("A"));
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  C
  Target
  A
  B
    `);
  });

  test("dragging an unselected row only moves that row", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}Target{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");

    fireEvent.dragStart(screen.getByText("C"));
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  A
  B
  Target
  C
    `);
  });

  test("reorder selected rows within same parent", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");

    fireEvent.dragStart(screen.getByText("A"));
    setDropIndentLevel("A", "D", 2);
    fireEvent.drop(screen.getByRole("treeitem", { name: "D" }));

    await expectTree(`
Root
  C
  D
  A
  B
    `);
  });

  test("selection clears after DnD", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}Target{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");

    fireEvent.dragStart(screen.getByText("A"));
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectNoTargets();
  });

  test("Alt+drag selected rows creates references for all", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}Target{Escape}");

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");

    const targetItems = screen.getAllByRole("treeitem", { name: "Target" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    await userEvent.keyboard("{Alt>}");
    fireEvent.dragStart(screen.getAllByText("A")[0]);
    fireEvent.dragOver(targetInPane1, { altKey: true });
    fireEvent.drop(targetInPane1, { altKey: true });
    await userEvent.keyboard("{/Alt}");

    await expectTree(`
Root
  A
  B
  Target
Target
  Root → A (0)
  Root → B (0)
    `);
  });

  test("drag selected rows to different pane copies them", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}Target{Escape}");

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    const pane0Items = screen.getAllByLabelText("A");
    await userEvent.click(pane0Items[0]);
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");

    const targetItems = screen.getAllByRole("treeitem", { name: "Target" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    fireEvent.dragStart(screen.getAllByText("A")[0]);
    fireEvent.drop(targetInPane1);

    await expectTree(`
Root
  A
  B
  C
  Target
Target
  A
  B
    `);
  });

  test("non-contiguous selection (Cmd+click) reorders preserving original order", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");
    await clickRow("A");
    modClick(await screen.findByLabelText("C"), { metaKey: true });
    await expectTargets("A", "C");

    fireEvent.dragStart(screen.getByText("A"));
    setDropIndentLevel("A", "D", 2);
    fireEvent.drop(screen.getByRole("treeitem", { name: "D" }));

    await expectTree(`
Root
  B
  D
  A
  C
    `);
  });

  test("non-contiguous selection reverse click order still preserves DOM order", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");
    await clickRow("C");
    modClick(await screen.findByLabelText("A"), { metaKey: true });
    await expectTargets("A", "C");

    fireEvent.dragStart(screen.getByText("C"));
    setDropIndentLevel("C", "D", 2);
    fireEvent.drop(screen.getByRole("treeitem", { name: "D" }));

    await expectTree(`
Root
  B
  D
  A
  C
    `);
  });

  test("three non-contiguous items reorder correctly", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Enter}E{Enter}F{Escape}"
    );
    await clickRow("A");
    modClick(await screen.findByLabelText("C"), { metaKey: true });
    modClick(await screen.findByLabelText("E"), { metaKey: true });
    await expectTargets("A", "C", "E");

    fireEvent.dragStart(screen.getByText("A"));
    setDropIndentLevel("A", "F", 2);
    fireEvent.drop(screen.getByRole("treeitem", { name: "F" }));

    await expectTree(`
Root
  B
  D
  F
  A
  C
  E
    `);
  });

  test("cross-depth selection: dragging parent only moves parent-level siblings", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}{Enter}B{Escape}");

    await expectTree(`
Root
  A
    A1
  B
    `);

    await clickRow("A");
    await userEvent.keyboard("{Shift>}jj{/Shift}");
    await expectTargets("A", "A1", "B");

    fireEvent.dragStart(screen.getByText("A"));
    fireEvent.drop(screen.getByLabelText("collapse Root"));

    await expectTree(`
Root
  A
    A1
  B
    `);
  });

  test("cross-depth selection: all selected items move even from different parents", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}A2{Enter}{Enter}B{Enter}{Tab}B1{Enter}B2{Escape}"
    );

    await expectTree(`
Root
  A
    A1
    A2
  B
    B1
    B2
    `);

    await clickRow("A1");
    await userEvent.keyboard("{Shift>}jjjj{/Shift}");
    await expectTargets("A1", "A2", "B", "B1", "B2");

    fireEvent.dragStart(screen.getByText("A1"));
    setDropIndentLevel("A1", "B2", 2);
    fireEvent.drop(screen.getByRole("treeitem", { name: "B2" }));

    await expectTree(`
Root
  A
  A1
  A2
  B
    B1
    B2
    `);
  });

  test("drop selected parent onto its own descendant is prevented", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}{Tab}Deep{Enter}{Enter}{Enter}B{Escape}"
    );

    await expectTree(`
Root
  A
    A1
      Deep
  B
    `);

    await clickRow("A");
    await userEvent.keyboard("{Shift>}jjj{/Shift}");
    await expectTargets("A", "A1", "Deep", "B");

    fireEvent.dragStart(screen.getByText("A"));
    fireEvent.drop(screen.getByRole("treeitem", { name: "Deep" }));

    await expectTree(`
Root
  A
    A1
      Deep
  B
    `);
  });

  test("dragged item descendants are grayed during drag", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}{Enter}B{Escape}");

    await clickRow("A");
    modClick(await screen.findByLabelText("B"), { metaKey: true });
    await expectTargets("A", "B");

    fireEvent.dragStart(screen.getByText("A"));

    /* eslint-disable testing-library/no-node-access */
    const a1Item = screen
      .getByText("A1")
      .closest('.item[data-row-focusable="true"]');
    expect(a1Item?.classList.contains("is-dragging-child")).toBe(true);

    const bItem = screen
      .getByText("B")
      .closest('.item[data-row-focusable="true"]');
    expect(bItem?.classList.contains("is-dragging-child")).toBe(false);
    /* eslint-enable testing-library/no-node-access */
  });

  test("multi-select move to different parent preserves order", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}{Enter}Target{Escape}");

    await expectTree(`
Root
  A
  B
  C
  Target
    `);

    await clickRow("A");
    await userEvent.keyboard("{Shift>}jj{/Shift}");
    await expectTargets("A", "B", "C");

    fireEvent.dragStart(screen.getByText("A"));
    setDropIndentLevel("A", "Target", 3);
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  Target
    A
    B
    C
    `);
  });
});

describe("Cross-depth DnD edge cases", () => {
  test("cross-pane drag with cross-depth selection copies all selected items", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}Parent{Enter}{Tab}Deep{Enter}{Enter}Shallow{Enter}Last{Escape}"
    );

    await expectTree(`
Root
  Parent
    Deep
  Shallow
  Last
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Last");

    await clickRow("Deep");
    await userEvent.keyboard("{Shift>}jj{/Shift}");
    await expectTargets("Deep", "Shallow", "Last");

    const targetItems = screen.getAllByRole("treeitem", { name: "Last" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    fireEvent.dragStart(screen.getAllByText("Deep")[0]);
    fireEvent.drop(targetInPane1);

    await expectTree(`
Root
  Parent
    Deep
  Shallow
  Last
Last
  Deep
  Shallow
  Last
    `);
  });

  test("same-pane move with cross-depth selection moves all selected items", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}Parent{Enter}{Tab}Deep{Enter}{Enter}Shallow{Enter}Target{Escape}"
    );

    await expectTree(`
Root
  Parent
    Deep
  Shallow
  Target
    `);

    await clickRow("Deep");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("Deep", "Shallow");

    fireEvent.dragStart(screen.getByText("Deep"));
    setDropIndentLevel("Deep", "Target", 3);
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  Parent
  Target
    Deep
    Shallow
    `);
  });

  test("cross-depth Cmd+click selection: cross-pane drag copies all", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}Parent{Enter}{Tab}Deep{Enter}{Enter}Shallow{Escape}"
    );

    await expectTree(`
Root
  Parent
    Deep
  Shallow
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Shallow");

    const deepElements = screen.getAllByLabelText("Deep");
    const shallowElements = screen.getAllByLabelText("Shallow");
    modClick(deepElements[0], { metaKey: true });
    modClick(shallowElements[0], { metaKey: true });
    await expectTargets("Deep", "Shallow");

    const targetItems = screen.getAllByRole("treeitem", { name: "Shallow" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    fireEvent.dragStart(screen.getAllByText("Deep")[0]);
    fireEvent.drop(targetInPane1);

    await expectTree(`
Root
  Parent
    Deep
  Shallow
Shallow
  Deep
  Shallow
    `);
  });

  test("cross-depth selection: Alt+drag creates references for all levels", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}Parent{Enter}{Tab}Deep{Enter}{Enter}Shallow{Enter}Target{Escape}"
    );

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    await clickRow("Deep");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("Deep", "Shallow");

    const targetItems = screen.getAllByRole("treeitem", { name: "Target" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    await userEvent.keyboard("{Alt>}");
    fireEvent.dragStart(screen.getAllByText("Deep")[0]);
    fireEvent.dragOver(targetInPane1, { altKey: true });
    fireEvent.drop(targetInPane1, { altKey: true });
    await userEvent.keyboard("{/Alt}");

    await expectTree(`
Root
  Parent
    Deep
  Shallow
  Target
Target
  Root → Parent → Deep (0)
  Root → Shallow (0)
    `);
  });

  test("three levels deep: drag deepest with shallow siblings to other pane", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}A{Enter}{Tab}B{Enter}{Tab}C{Enter}{Enter}{Enter}D{Escape}"
    );

    await expectTree(`
Root
  A
    B
      C
  D
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "D");

    await clickRow("C");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("C", "D");

    const targetItems = screen.getAllByRole("treeitem", { name: "D" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    fireEvent.dragStart(screen.getAllByText("C")[0]);
    fireEvent.drop(targetInPane1);

    await expectTree(`
Root
  A
    B
      C
  D
D
  C
  D
    `);
  });

  test("same-pane move: sparse Cmd+click at different depths", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}{Enter}B{Enter}{Tab}B1{Enter}{Enter}Target{Escape}"
    );

    await expectTree(`
Root
  A
    A1
  B
    B1
  Target
    `);

    modClick(await screen.findByLabelText("A1"), { metaKey: true });
    modClick(await screen.findByLabelText("B1"), { metaKey: true });
    await expectTargets("A1", "B1");

    fireEvent.dragStart(screen.getByText("A1"));
    setDropIndentLevel("A1", "Target", 3);
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  A
  B
  Target
    A1
    B1
    `);
  });

  test("cross-depth drag: descendant check prevents drop into own child", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}Parent{Enter}{Tab}Child{Enter}{Enter}Sibling{Escape}"
    );

    await expectTree(`
Root
  Parent
    Child
  Sibling
    `);

    await clickRow("Parent");
    await userEvent.keyboard("{Shift>}jj{/Shift}");
    await expectTargets("Parent", "Child", "Sibling");

    fireEvent.dragStart(screen.getByText("Parent"));
    fireEvent.drop(screen.getByRole("treeitem", { name: "Child" }));

    await expectTree(`
Root
  Parent
    Child
  Sibling
    `);
  });

  test("cross-depth selection same-pane move to expanded parent", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}Source{Enter}{Tab}SDeep{Enter}{Enter}Target{Enter}{Tab}Existing{Escape}"
    );

    await expectTree(`
Root
  Source
    SDeep
  Target
    Existing
    `);

    await clickRow("SDeep");
    modClick(await screen.findByLabelText("Source"), { metaKey: true });
    await expectTargets("Source", "SDeep");

    fireEvent.dragStart(screen.getByText("SDeep"));
    setDropIndentLevel("SDeep", "Existing", 3);
    fireEvent.drop(screen.getByRole("treeitem", { name: "Existing" }));

    await expectTree(`
Root
  Target
    Existing
    Source
      SDeep
    `);
  });

  test("cross-pane drag: items from 3 different parents", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}{Enter}B{Enter}{Tab}B1{Enter}{Enter}C{Enter}{Tab}C1{Escape}"
    );

    await expectTree(`
Root
  A
    A1
  B
    B1
  C
    C1
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "C1");

    const a1Elements = screen.getAllByLabelText("A1");
    const b1Elements = screen.getAllByLabelText("B1");
    const c1Elements = screen.getAllByLabelText("C1");
    modClick(a1Elements[0], { metaKey: true });
    modClick(b1Elements[0], { metaKey: true });
    modClick(c1Elements[0], { metaKey: true });
    await expectTargets("A1", "B1", "C1");

    const targetItems = screen.getAllByRole("treeitem", { name: "C1" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    fireEvent.dragStart(screen.getAllByText("A1")[0]);
    fireEvent.drop(targetInPane1);

    await expectTree(`
Root
  A
    A1
  B
    B1
  C
    C1
C1
  A1
  B1
  C1
    `);
  });

  test("cross-depth reorder: siblings at same level reorder normally", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");

    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");

    fireEvent.dragStart(screen.getByText("A"));
    setDropIndentLevel("A", "D", 2);
    fireEvent.drop(screen.getByRole("treeitem", { name: "D" }));

    await expectTree(`
Root
  C
  D
  A
  B
    `);
  });

  test("cross-depth selection: Shift+j through hierarchy then same-pane move", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}P{Enter}{Tab}P1{Enter}P2{Enter}{Enter}Q{Enter}Target{Escape}"
    );

    await expectTree(`
Root
  P
    P1
    P2
  Q
  Target
    `);

    await clickRow("P1");
    await userEvent.keyboard("{Shift>}jj{/Shift}");
    await expectTargets("P1", "P2", "Q");

    fireEvent.dragStart(screen.getByText("P1"));
    setDropIndentLevel("P1", "Target", 3);
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  P
  Target
    P1
    P2
    Q
    `);
  });

  test("cross-depth selection: move deep items to root container", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}A2{Enter}{Enter}B{Escape}"
    );

    await expectTree(`
Root
  A
    A1
    A2
  B
    `);

    await clickRow("A1");
    await userEvent.keyboard("{Shift>}jj{/Shift}");
    await expectTargets("A1", "A2", "B");

    fireEvent.dragStart(screen.getByText("A1"));
    fireEvent.drop(screen.getByLabelText("collapse Root"));

    await expectTree(`
Root
  A1
  A2
  A
  B
    `);
  });

  test("cross-pane: parent+child selection copies only parent (child follows)", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}Parent{Enter}{Tab}Deep{Enter}{Enter}Target{Escape}"
    );

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    modClick(await screen.findByLabelText("Parent"), { metaKey: true });
    modClick(await screen.findByLabelText("Deep"), { metaKey: true });
    await expectTargets("Parent", "Deep");

    const targetItems = screen.getAllByRole("treeitem", { name: "Target" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    fireEvent.dragStart(screen.getAllByText("Parent")[0]);
    fireEvent.drop(targetInPane1);

    await expectTree(`
Root
  Parent
    Deep
  Target
Target
  Parent
    Deep
    `);
  });

  test("cross-pane: non-contiguous selection at varied depths copies in DOM order", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}{Enter}B{Enter}{Tab}B1{Escape}"
    );

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "B1");

    const aElements = screen.getAllByLabelText("A");
    const b1Elements = screen.getAllByLabelText("B1");
    modClick(aElements[0], { metaKey: true });
    modClick(b1Elements[0], { metaKey: true });
    await expectTargets("A", "B1");

    const targetItems = screen.getAllByRole("treeitem", { name: "B1" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    fireEvent.dragStart(screen.getAllByText("A")[0]);
    fireEvent.drop(targetInPane1);

    await expectTree(`
Root
  A
    A1
  B
    B1
B1
  A
    A1
  B1
    `);
  });

  test("cross-depth move: items from sibling branches move to target", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}X{Enter}{Tab}X1{Enter}{Enter}Y{Enter}{Tab}Y1{Enter}{Enter}Z{Escape}"
    );

    await expectTree(`
Root
  X
    X1
  Y
    Y1
  Z
    `);

    modClick(await screen.findByLabelText("X1"), { metaKey: true });
    modClick(await screen.findByLabelText("Y1"), { metaKey: true });
    await expectTargets("X1", "Y1");

    fireEvent.dragStart(screen.getByText("X1"));
    setDropIndentLevel("X1", "Z", 3);
    fireEvent.drop(screen.getByRole("treeitem", { name: "Z" }));

    await expectTree(`
Root
  X
  Y
  Z
    X1
    Y1
    `);
  });

  test("cross-depth drag moves items from different parents to target", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}{Enter}B{Enter}Target{Escape}"
    );

    await expectTree(`
Root
  A
    A1
  B
  Target
    `);

    await clickRow("A1");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A1", "B");

    fireEvent.dragStart(screen.getByText("A1"));
    setDropIndentLevel("A1", "Target", 3);
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  A
  Target
    A1
    B
    `);
  });
});

describe("Batch indent (Tab) with selection", () => {
  test("Tab indents all selected siblings into previous sibling", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");
    await clickRow("B");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("B", "C");
    await userEvent.keyboard("{Tab}");
    await expectTree(`
Root
  A
    B
    C
  D
    `);
  });

  test("Tab preserves order of selected items", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");
    await clickRow("C");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("C", "D");
    await userEvent.keyboard("{Tab}");
    await expectTree(`
Root
  A
  B
    C
    D
    `);
  });

  test("Tab does nothing when first selected is first child", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");
    await userEvent.keyboard("{Tab}");
    await expectTree(`
Root
  A
  B
  C
    `);
  });

  test("Tab does nothing when selection spans different parents", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}A1{Enter}B{Escape}");
    await clickRow("A1");
    await userEvent.keyboard("{Tab}");
    await expectTree(`
Root
  A
    A1
  B
    `);
    await clickRow("A1");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A1", "B");
    await userEvent.keyboard("{Tab}");
    await expectTree(`
Root
  A
    A1
  B
    `);
  });

  test("Tab preserves selection after indent", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("B");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("B", "C");
    await userEvent.keyboard("{Tab}");
    await expectTargets("B", "C");
  });

  test("Shift+Tab right after Tab outdents on first press", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("B");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("B", "C");

    await userEvent.keyboard("{Tab}");
    await expectTree(`
Root
  A
    B
    C
    `);
    await expectTargets("B", "C");

    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expectTree(`
Root
  A
  B
  C
    `);
    await expectTargets("B", "C");
  });

  test("Tab indents single selected row", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await clickRow("B");
    await expectTargets("B");
    await userEvent.keyboard("{Tab}");
    await expectTree(`
Root
  A
    B
    `);
  });

  test("Tab expands collapsed previous sibling", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}A1{Enter}B{Escape}");
    await clickRow("A1");
    await userEvent.keyboard("{Tab}");
    await expectTree(`
Root
  A
    A1
  B
    `);
    await userEvent.click(await screen.findByLabelText("collapse A"));
    await expectTree(`
Root
  A
  B
    `);
    await clickRow("B");
    await userEvent.keyboard("{Tab}");
    await expectTree(`
Root
  A
    A1
    B
    `);
  });
});

describe("Batch outdent (Shift+Tab) with selection", () => {
  test("Shift+Tab outdents all selected siblings to grandparent", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}B{Enter}C{Enter}D{Escape}");
    await clickRow("B");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("B", "C");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expectTree(`
Root
  A
    D
  B
  C
    `);
  });

  test("Shift+Tab preserves order of selected items", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}B{Enter}C{Enter}D{Escape}");
    await clickRow("C");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("C", "D");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expectTree(`
Root
  A
    B
  C
  D
    `);
  });

  test("Shift+Tab does nothing when parent is root-level", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expectTree(`
Root
  A
  B
  C
    `);
  });

  test("Shift+Tab preserves selection after outdent", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}B{Enter}C{Escape}");
    await clickRow("B");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("B", "C");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expectTargets("B", "C");
  });

  test("Shift+Tab outdents single selected row", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}B{Escape}");
    await clickRow("B");
    await expectTargets("B");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expectTree(`
Root
  A
  B
    `);
  });

  test("Shift+Tab inserts after parent in grandparent", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}X{Enter}Y{Escape}");
    await userEvent.keyboard("{Escape}");
    await clickRow("X");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("X", "Y");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expectTree(`
Root
  A
  X
  Y
    `);
  });

  test("Shift+Tab does nothing when selection spans different parents", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}{Escape}");
    await userEvent.keyboard("{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "A1");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expectTree(`
Root
  A
    A1
    `);
  });
});

describe("View state preservation - multiselect DnD", () => {
  test("move expanded items - both stay expanded", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Escape}");
    await userEvent.click(await screen.findByLabelText("collapse A"));
    await userEvent.click(await screen.findByLabelText("edit A"));
    await userEvent.keyboard("{Enter}");
    await type("B{Enter}{Tab}B1{Escape}");
    await userEvent.click(await screen.findByLabelText("expand A"));
    await userEvent.click(await screen.findByLabelText("collapse B"));
    await userEvent.click(await screen.findByLabelText("edit B"));
    await userEvent.keyboard("{Enter}");
    await type("Target{Escape}");
    await userEvent.click(await screen.findByLabelText("expand B"));

    await expectTree(`
Root
  A
    A1
  B
    B1
  Target
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse B");

    await clickRow("A");
    modClick(await screen.findByLabelText("B"), { metaKey: true });
    await expectTargets("A", "B");

    fireEvent.dragStart(screen.getByText("A"));
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  Target
  A
    A1
  B
    B1
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse B");
  });

  test("non-selected sibling expanded state preserved after multi-move", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}{Tab}B1{Escape}");
    await userEvent.click(await screen.findByLabelText("collapse B"));
    await userEvent.click(await screen.findByLabelText("edit B"));
    await userEvent.keyboard("{Enter}");
    await type("C{Enter}Target{Escape}");
    await userEvent.click(await screen.findByLabelText("expand B"));

    await expectTree(`
Root
  A
  B
    B1
  C
  Target
    `);
    await screen.findByLabelText("collapse B");

    await clickRow("A");
    modClick(await screen.findByLabelText("C"), { metaKey: true });
    await expectTargets("A", "C");

    fireEvent.dragStart(screen.getByText("A"));
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  B
    B1
  Target
  A
  C
    `);
    await screen.findByLabelText("collapse B");
  });

  test("move expanded item with deep descendants preserves all levels", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}{Tab}A1a{Escape}");
    await userEvent.click(await screen.findByLabelText("collapse A"));
    await userEvent.click(await screen.findByLabelText("edit A"));
    await userEvent.keyboard("{Enter}");
    await type("B{Enter}Target{Escape}");
    await userEvent.click(await screen.findByLabelText("expand A"));

    await expectTree(`
Root
  A
    A1
      A1a
  B
  Target
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse A1");

    await clickRow("A");
    modClick(await screen.findByLabelText("B"), { metaKey: true });
    await expectTargets("A", "B");

    fireEvent.dragStart(screen.getByText("A"));
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  Target
  A
    A1
      A1a
  B
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse A1");
  });

  test("cross-pane copy of multi-selection preserves expanded state", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Escape}");
    await userEvent.click(await screen.findByLabelText("collapse A"));
    await userEvent.click(await screen.findByLabelText("edit A"));
    await userEvent.keyboard("{Enter}");
    await type("B{Enter}{Tab}B1{Escape}");
    await userEvent.click(await screen.findByLabelText("expand A"));
    await userEvent.click(await screen.findByLabelText("collapse B"));
    await userEvent.click(await screen.findByLabelText("edit B"));
    await userEvent.keyboard("{Enter}");
    await type("Target{Escape}");
    await userEvent.click(await screen.findByLabelText("expand B"));

    await expectTree(`
Root
  A
    A1
  B
    B1
  Target
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse B");

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    const pane0Items = screen.getAllByLabelText("A");
    await userEvent.click(pane0Items[0]);
    modClick(screen.getAllByLabelText("B")[0], { metaKey: true });

    const targetItems = screen.getAllByRole("treeitem", { name: "Target" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    fireEvent.dragStart(screen.getAllByText("A")[0]);
    fireEvent.drop(targetInPane1);

    const collapseA = screen.getAllByLabelText("collapse A");
    expect(collapseA.length).toBeGreaterThanOrEqual(2);
    const collapseB = screen.getAllByLabelText("collapse B");
    expect(collapseB.length).toBeGreaterThanOrEqual(2);
  });
});

describe("View state preservation - multiselect Tab indent", () => {
  test("Tab indent expanded items - both stay expanded", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}Prev{Enter}A{Enter}{Tab}A1{Escape}");
    await userEvent.click(await screen.findByLabelText("collapse A"));
    await userEvent.click(await screen.findByLabelText("edit A"));
    await userEvent.keyboard("{Enter}");
    await type("B{Enter}{Tab}B1{Escape}");
    await userEvent.click(await screen.findByLabelText("expand A"));

    await expectTree(`
Root
  Prev
  A
    A1
  B
    B1
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse B");

    await clickRow("A");
    modClick(await screen.findByLabelText("B"), { metaKey: true });
    await expectTargets("A", "B");
    await userEvent.keyboard("{Tab}");

    await expectTree(`
Root
  Prev
    A
      A1
    B
      B1
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse B");
  });

  test("Tab indent preserves non-selected sibling expanded state", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}Prev{Enter}{Tab}P1{Escape}");
    await userEvent.click(await screen.findByLabelText("collapse Prev"));
    await userEvent.click(await screen.findByLabelText("edit Prev"));
    await userEvent.keyboard("{Enter}");
    await type("A{Enter}B{Escape}");
    await userEvent.click(await screen.findByLabelText("expand Prev"));

    await expectTree(`
Root
  Prev
    P1
  A
  B
    `);
    await screen.findByLabelText("collapse Prev");

    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");
    await userEvent.keyboard("{Tab}");

    await expectTree(`
Root
  Prev
    P1
    A
    B
    `);
    await screen.findByLabelText("collapse Prev");
  });

  test("Tab indent item with deep descendants preserves all levels", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}Prev{Enter}A{Enter}{Tab}A1{Enter}{Tab}A1a{Escape}"
    );

    await expectTree(`
Root
  Prev
  A
    A1
      A1a
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse A1");

    await clickRow("A");
    await userEvent.keyboard("{Tab}");

    await expectTree(`
Root
  Prev
    A
      A1
        A1a
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse A1");
  });
});

describe("View state preservation - multiselect Shift+Tab outdent", () => {
  test("Shift+Tab outdent expanded items - both stay expanded", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}Parent{Enter}{Tab}A{Enter}{Tab}A1{Escape}");
    await userEvent.click(await screen.findByLabelText("collapse A"));
    await userEvent.click(await screen.findByLabelText("edit A"));
    await userEvent.keyboard("{Enter}");
    await type("B{Enter}{Tab}B1{Escape}");
    await userEvent.click(await screen.findByLabelText("expand A"));

    await expectTree(`
Root
  Parent
    A
      A1
    B
      B1
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse B");

    await clickRow("A");
    modClick(await screen.findByLabelText("B"), { metaKey: true });
    await expectTargets("A", "B");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");

    await expectTree(`
Root
  Parent
  A
    A1
  B
    B1
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse B");
  });

  test("Shift+Tab outdent preserves remaining sibling expanded state", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}Parent{Enter}{Tab}Stay{Enter}{Tab}S1{Escape}");
    await userEvent.click(await screen.findByLabelText("collapse Stay"));
    await userEvent.click(await screen.findByLabelText("edit Stay"));
    await userEvent.keyboard("{Enter}");
    await type("A{Enter}B{Escape}");
    await userEvent.click(await screen.findByLabelText("expand Stay"));

    await expectTree(`
Root
  Parent
    Stay
      S1
    A
    B
    `);
    await screen.findByLabelText("collapse Stay");

    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");

    await expectTree(`
Root
  Parent
    Stay
      S1
  A
  B
    `);
    await screen.findByLabelText("collapse Stay");
  });
});

describe("Escape clears selection completely", () => {
  test("Space after Escape does not include previously selected row", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}Child 1{Enter}Child 2{Enter}Child 3{Escape}");
    await clickRow("Child 3");
    await userEvent.keyboard(" ");
    await expectTargets("Child 3");
    await userEvent.keyboard("{Escape}");
    await expectTargets("Child 3");

    await userEvent.keyboard("gg");
    await userEvent.keyboard(" ");
    await expectTargets("Root");
  });

  test("Shift+j after Escape does not include previously selected row", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}Child 1{Enter}Child 2{Enter}Child 3{Escape}");
    await clickRow("Child 3");
    await userEvent.keyboard(" ");
    await expectTargets("Child 3");
    await userEvent.keyboard("{Escape}");
    await expectTargets("Child 3");

    await userEvent.keyboard("gg");
    await userEvent.keyboard("j");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("Child 1", "Child 2");
  });

  test("Shift+click after Escape does not include previously selected row", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}Child 1{Enter}Child 2{Enter}Child 3{Escape}");
    await clickRow("Child 3");
    await userEvent.keyboard(" ");
    await expectTargets("Child 3");
    await userEvent.keyboard("{Escape}");

    modClick(await screen.findByLabelText("Root"), { shiftKey: true });
    await waitFor(() => {
      expect(getSelectedNodes()).toEqual([]);
    });
  });
});

describe("Copy to clipboard", () => {
  const mockWriteText = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    // eslint-disable-next-line functional/immutable-data
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: mockWriteText },
      writable: true,
      configurable: true,
    });
    mockWriteText.mockClear();
  });

  test("Cmd+C on focused row copies its text", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}Hello{Escape}");
    await clickRow("Hello");
    await userEvent.keyboard("{Meta>}c{/Meta}");
    expect(mockWriteText).toHaveBeenCalledWith("Hello");
  });

  test("Cmd+C on focused row with expanded children copies subtree", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type(
      "Root{Enter}{Tab}Parent{Enter}{Tab}Child A{Enter}Child B{Escape}"
    );
    await clickRow("Parent");
    await userEvent.keyboard("{Meta>}c{/Meta}");
    expect(mockWriteText).toHaveBeenCalledWith("Parent\n\tChild A\n\tChild B");
  });

  test("Cmd+C on focused row with collapsed children copies only the row", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}Parent{Enter}{Tab}Child{Escape}");
    await userEvent.click(await screen.findByLabelText("collapse Parent"));
    await clickRow("Parent");
    await userEvent.keyboard("{Meta>}c{/Meta}");
    expect(mockWriteText).toHaveBeenCalledWith("Parent");
  });

  test("Cmd+C with selection copies only selected rows", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");
    await userEvent.keyboard("{Meta>}c{/Meta}");
    expect(mockWriteText).toHaveBeenCalledWith("A\nB");
  });

  test("Cmd+C with selection preserves relative indentation", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}A2{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "A1", "A2");
    await userEvent.keyboard("{Meta>}c{/Meta}");
    expect(mockWriteText).toHaveBeenCalledWith("A\n\tA1\n\tA2");
  });

  test("Cmd+C with deep subtree preserves all indent levels", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type(
      "Root{Enter}{Tab}A{Enter}{Tab}B{Enter}{Tab}C{Enter}{Tab}D{Escape}"
    );
    await clickRow("A");
    await userEvent.keyboard("{Meta>}c{/Meta}");
    expect(mockWriteText).toHaveBeenCalledWith("A\n\tB\n\t\tC\n\t\t\tD");
  });

  test("Cmd+C copies selected rows in DOM order regardless of selection order", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("B");
    modClick(await screen.findByLabelText("C"), { metaKey: true });
    modClick(await screen.findByLabelText("A"), { metaKey: true });
    await expectTargets("A", "B", "C");
    await userEvent.keyboard("{Meta>}c{/Meta}");
    expect(mockWriteText).toHaveBeenCalledWith("A\nB\nC");
  });

  test("Cmd+C does nothing when editing a node", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}Hello{Escape}");
    await userEvent.click(await screen.findByLabelText("edit Hello"));
    await userEvent.keyboard("{Meta>}c{/Meta}");
    expect(mockWriteText).not.toHaveBeenCalled();
  });

  test("Cmd+C with cross-depth selection normalizes to shallowest", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}{Tab}A1a{Escape}");
    await userEvent.click(await screen.findByLabelText("collapse A1"));
    await userEvent.click(await screen.findByLabelText("collapse A"));
    await userEvent.click(await screen.findByLabelText("edit A"));
    await userEvent.keyboard("{Enter}");
    await type("B{Escape}");
    await userEvent.click(await screen.findByLabelText("expand A"));
    await userEvent.click(await screen.findByLabelText("expand A1"));

    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "A1", "A1a", "B");
    await userEvent.keyboard("{Meta>}c{/Meta}");
    expect(mockWriteText).toHaveBeenCalledWith("A\n\tA1\n\t\tA1a\nB");
  });
});

function firePaste(element: HTMLElement, text: string): void {
  const clipboardData = {
    getData: () => text,
  };
  // eslint-disable-next-line testing-library/prefer-user-event
  fireEvent.paste(element, { clipboardData });
}

describe("Paste in normal mode (Cmd+V)", () => {
  const mockReadText = jest.fn();

  beforeEach(() => {
    // eslint-disable-next-line functional/immutable-data
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: mockReadText },
      writable: true,
      configurable: true,
    });
  });

  test("Cmd+V pastes flat items as children of focused row", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}Existing{Escape}");
    await clickRow("Root");
    mockReadText.mockResolvedValueOnce("Pasted A\nPasted B");
    await userEvent.keyboard("{Meta>}v{/Meta}");
    await screen.findByLabelText("Pasted A");
    await expectTree(`
Root
  Pasted A
  Pasted B
  Existing
    `);
  });

  test("Cmd+V pastes nested items preserving hierarchy", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Escape}");
    await clickRow("Root");
    mockReadText.mockResolvedValueOnce("Parent\n\tChild 1\n\tChild 2");
    await userEvent.keyboard("{Meta>}v{/Meta}");
    await screen.findByLabelText("Parent");
    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await expectTree(`
Root
  Parent
    Child 1
    Child 2
    `);
  });

  test("Cmd+V strips markdown bullet markers", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Escape}");
    await clickRow("Root");
    mockReadText.mockResolvedValueOnce("- Item A\n- Item B\n- Item C");
    await userEvent.keyboard("{Meta>}v{/Meta}");
    await screen.findByLabelText("Item A");
    await expectTree(`
Root
  Item A
  Item B
  Item C
    `);
  });

  test("Cmd+V strips numbered list markers", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Escape}");
    await clickRow("Root");
    mockReadText.mockResolvedValueOnce("1. First\n2. Second\n3. Third");
    await userEvent.keyboard("{Meta>}v{/Meta}");
    await screen.findByLabelText("First");
    await expectTree(`
Root
  First
  Second
  Third
    `);
  });

  test("Cmd+V pastes siblings as children of root", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Escape}");
    await clickRow("Root");
    mockReadText.mockResolvedValueOnce("A\nB\nC");
    await userEvent.keyboard("{Meta>}v{/Meta}");
    await screen.findByLabelText("A");
    await expectTree(`
Root
  A
  B
  C
    `);
  });

  test("Cmd+V does nothing with empty clipboard", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}Existing{Escape}");
    await clickRow("Root");
    mockReadText.mockResolvedValueOnce("");
    await userEvent.keyboard("{Meta>}v{/Meta}");
    await expectTree(`
Root
  Existing
    `);
  });
});

describe("Paste in edit mode (multi-line)", () => {
  beforeEach(() => {
    // eslint-disable-next-line functional/immutable-data
    document.execCommand = jest.fn(() => true);
  });
  test("pasting multi-line text creates siblings after current node", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}First{Escape}");
    const editor = await screen.findByLabelText("edit First");
    await userEvent.click(editor);
    const editBox = await screen.findByRole("textbox", {
      name: "edit First",
    });
    firePaste(editBox, "First\nSecond\nThird");
    await screen.findByLabelText("Second");
    await expectTree(`
Root
  First
  Second
  Third
    `);
  });

  test("pasting multi-line text with indentation creates hierarchy", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}Existing{Escape}");
    const editor = await screen.findByLabelText("edit Existing");
    await userEvent.click(editor);
    const editBox = await screen.findByRole("textbox", {
      name: "edit Existing",
    });
    firePaste(editBox, "Existing\n\tChild A\n\tChild B");
    await screen.findByLabelText("Child A");
    await expectTree(`
Root
  Existing
  Child A
  Child B
    `);
  });

  test("pasting multi-line in new node editor creates nodes", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}Alpha");
    const editor = await findNewNodeEditor();
    firePaste(editor, "Alpha\nBeta\nGamma");
    await screen.findByLabelText("Beta");
    await screen.findByLabelText("Gamma");
    await screen.findByLabelText("Alpha");
  });
});

describe("Copy and paste across panes", () => {
  test("Cmd+C a nested subtree in pane 0 then Cmd+V into pane 1", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type(
      "Source{Enter}{Tab}Alpha{Enter}{Tab}Beta{Enter}Gamma{Enter}{Tab}Delta{Escape}"
    );

    // eslint-disable-next-line functional/immutable-data
    const clipboard = { text: "" };
    // eslint-disable-next-line functional/immutable-data
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: jest.fn((text: string) => {
          // eslint-disable-next-line functional/immutable-data
          clipboard.text = text;
          return Promise.resolve();
        }),
        readText: jest.fn(() => Promise.resolve(clipboard.text)),
      },
      writable: true,
      configurable: true,
    });

    await clickRow("Alpha");
    await userEvent.keyboard("{Meta>}c{/Meta}");
    expect(clipboard.text).toBe("Alpha\n\tBeta\n\tGamma\n\t\tDelta");

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Source");

    const sourceLabels = screen.getAllByLabelText("Source");
    const sourceInPane1 = sourceLabels[sourceLabels.length - 1];
    await userEvent.click(sourceInPane1);

    await userEvent.keyboard("{Meta>}v{/Meta}");
    await waitFor(() => {
      expect(navigator.clipboard.readText).toHaveBeenCalled();
    });

    await waitFor(() => {
      const alphaNodes = screen.getAllByLabelText("Alpha");
      expect(alphaNodes.length).toBeGreaterThanOrEqual(3);
    });

    const expandAlphas = screen.getAllByLabelText("expand Alpha");
    await userEvent.click(expandAlphas[expandAlphas.length - 1]);
    const expandGammas = screen.getAllByLabelText("expand Gamma");
    await userEvent.click(expandGammas[expandGammas.length - 1]);

    const betas = screen.getAllByLabelText("Beta");
    expect(betas.length).toBeGreaterThanOrEqual(2);
    const gammas = screen.getAllByLabelText("Gamma");
    expect(gammas.length).toBeGreaterThanOrEqual(2);

    const expandGammas2 = screen.queryAllByLabelText("expand Gamma");
    if (expandGammas2.length > 0) {
      await userEvent.click(expandGammas2[expandGammas2.length - 1]);
    }

    const deltas = screen.getAllByLabelText("Delta");
    expect(deltas.length).toBeGreaterThanOrEqual(2);
  });
});
