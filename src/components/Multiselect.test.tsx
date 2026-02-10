import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ALICE, renderApp, setup, type } from "../utils.test";

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
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    const item = active.closest('.item[data-row-focusable="true"]');
    if (item) {
      return [item.getAttribute("data-node-text") || ""];
    }
  }
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

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Enter}E{Enter}F{Escape}");
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

  test("Escape clears multi-selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");
    await userEvent.keyboard("{Escape}");
    await expectNoTargets();
  });

  test("Escape clears single-row selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await clickRow("A");
    await userEvent.keyboard(" ");
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
