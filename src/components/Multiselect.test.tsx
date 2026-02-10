import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ALICE, renderApp, setup, type } from "../utils.test";

function getSelectedNodes(): string[] {
  return Array.from(
    document.querySelectorAll('.item[data-selected="true"]')
  ).map((el) => el.getAttribute("data-node-text") || "");
}

async function expectSelected(...expected: string[]): Promise<void> {
  await waitFor(() => {
    expect(getSelectedNodes()).toEqual(expected);
  });
}

async function expectNoneSelected(): Promise<void> {
  await waitFor(() => {
    expect(getSelectedNodes()).toEqual([]);
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
    await expectSelected("A", "B");
  });

  test("Shift+j extends selection further down", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectSelected("A", "B", "C");
  });

  test("Shift+k selects current row and moves focus up", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("C");
    await userEvent.keyboard("{Shift>}k{/Shift}");
    await expectSelected("B", "C");
  });

  test("Shift+k extends selection further up", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("C");
    await userEvent.keyboard("{Shift>}k{/Shift}");
    await userEvent.keyboard("{Shift>}k{/Shift}");
    await expectSelected("A", "B", "C");
  });

  test("Shift+j then Shift+k shrinks selection (rubber-band)", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectSelected("A", "B", "C");
    await userEvent.keyboard("{Shift>}k{/Shift}");
    await expectSelected("A", "B");
  });

  test("Shift+k then Shift+j shrinks selection (rubber-band upward)", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("C");
    await userEvent.keyboard("{Shift>}k{/Shift}");
    await userEvent.keyboard("{Shift>}k{/Shift}");
    await expectSelected("A", "B", "C");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectSelected("B", "C");
  });

  test("plain j preserves selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectSelected("A", "B");
    await userEvent.keyboard("j");
    await expectSelected("A", "B");
  });

  test("plain k preserves selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("B");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectSelected("B", "C");
    await userEvent.keyboard("k");
    await expectSelected("B", "C");
  });

  test("Space toggles focused row into selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await expectSelected("A");
    await userEvent.keyboard("j");
    await userEvent.keyboard(" ");
    await expectSelected("A", "B");
  });

  test("Space toggles focused row out of selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectSelected("A", "B", "C");
    await userEvent.keyboard(" ");
    await expectSelected("A", "B");
  });

  test("Space enables non-contiguous keyboard selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");
    await clickRow("A");
    await userEvent.keyboard("jj");
    await userEvent.keyboard(" ");
    await expectSelected("A", "C");
  });

  test("Escape clears multi-selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectSelected("A", "B");
    await userEvent.keyboard("{Escape}");
    await expectNoneSelected();
  });

  test("Escape clears single-row selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await clickRow("A");
    await expectSelected("A");
    await userEvent.keyboard("{Escape}");
    await expectNoneSelected();
  });

  test("Shift+ArrowDown works same as Shift+j", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await expectSelected("A", "B");
  });

  test("Shift+ArrowUp works same as Shift+k", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await clickRow("B");
    await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}");
    await expectSelected("A", "B");
  });

  test("selection works across different indent levels", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectSelected("A", "A1");
  });

  test("Shift+j descends into expanded children", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}A2{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectSelected("A", "A1");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectSelected("A", "A1", "A2");
  });
});

describe("Selection via mouse", () => {
  test("click sets anchor (single selection)", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("C");
    await expectSelected("C");
  });

  test("click clears previous selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectSelected("A", "B");

    await clickRow("C");
    await expectSelected("C");
  });

  test("Cmd+click toggles row into selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await expectSelected("A");

    modClick(await screen.findByLabelText("B"), { metaKey: true });
    await expectSelected("A", "B");

    modClick(await screen.findByLabelText("C"), { metaKey: true });
    await expectSelected("A", "B", "C");
  });

  test("Cmd+click toggles row out of selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    modClick(await screen.findByLabelText("B"), { metaKey: true });
    modClick(await screen.findByLabelText("C"), { metaKey: true });
    await expectSelected("A", "B", "C");

    modClick(await screen.findByLabelText("B"), { metaKey: true });
    await expectSelected("A", "C");
  });

  test("Shift+click selects range from anchor to clicked row", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");
    await clickRow("A");
    modClick(await screen.findByLabelText("D"), { shiftKey: true });
    await expectSelected("A", "B", "C", "D");
  });

  test("Shift+click selects range upward", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");
    await clickRow("D");
    modClick(await screen.findByLabelText("A"), { shiftKey: true });
    await expectSelected("A", "B", "C", "D");
  });

  test("Shift+click selects range across different depths", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}A2{Escape}");
    await clickRow("A");
    modClick(await screen.findByLabelText("A2"), { shiftKey: true });
    await expectSelected("A", "A1", "A2");
  });

  test("Cmd+click after Shift selection adds to existing selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");
    await clickRow("A");
    modClick(await screen.findByLabelText("B"), { shiftKey: true });
    await expectSelected("A", "B");

    modClick(await screen.findByLabelText("D"), { metaKey: true });
    await expectSelected("A", "B", "D");
  });
});
