import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ALICE, expectTree, renderApp, setup, type } from "../utils.test";

describe("Keyboard Navigation", () => {
  function getPaneWrapper(index = 0): HTMLElement {
    const wrappers = document.querySelectorAll(".pane-wrapper");
    return wrappers[index] as HTMLElement;
  }

  test("normal mode pane shortcuts: N new note, P new pane, q close pane", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Escape}");
    const pane0 = getPaneWrapper(0);

    fireEvent.keyDown(pane0, { key: "N" });
    await screen.findByLabelText("new node editor");
    await userEvent.type(
      await screen.findByLabelText("new node editor"),
      "Second{Escape}"
    );

    fireEvent.keyDown(pane0, { key: "P" });
    await screen.findByLabelText("Search to change pane 1 content");
    const pane1 = getPaneWrapper(1);
    fireEvent.keyDown(pane1, { key: "q" });

    await waitFor(() => {
      expect(screen.queryByLabelText("Search to change pane 1 content")).toBeNull();
    });
  });

  test("keyboard shortcuts work immediately after reload", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Escape}");
    cleanup();
    renderApp(alice());

    await userEvent.keyboard("N");
    await screen.findByLabelText("new node editor");
  });

  test("normal mode j/k + Enter moves focus and opens editor", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    const pane0 = getPaneWrapper(0);

    fireEvent.keyDown(pane0, { key: "g" });
    fireEvent.keyDown(pane0, { key: "g" });
    fireEvent.keyDown(pane0, { key: "j" });
    fireEvent.keyDown(pane0, { key: "Enter" });

    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      expect(active?.getAttribute("aria-label")).toBe("edit A");
    });
  });

  test("ArrowDown focuses hovered row when pane has no row focus", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    const pane0 = getPaneWrapper(0);
    pane0.focus();

    const rowB = document.querySelector(
      '[data-row-focusable="true"][data-node-text="B"]'
    ) as HTMLElement;
    fireEvent.mouseMove(rowB);
    fireEvent.keyDown(pane0, { key: "ArrowDown" });

    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      expect(active?.getAttribute("data-node-text")).toBe("B");
    });
  });

  test("hover steals row focus in normal mode", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");

    const rowB = document.querySelector(
      '[data-row-focusable="true"][data-node-text="B"]'
    ) as HTMLElement;
    fireEvent.mouseMove(rowB);

    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      expect(active?.getAttribute("data-node-text")).toBe("B");
    });
  });

  test("hover does not steal focus in insert mode", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");

    const editorA = await screen.findByLabelText("edit A");
    await userEvent.click(editorA);

    const rowB = document.querySelector(
      '[data-row-focusable="true"][data-node-text="B"]'
    ) as HTMLElement;
    fireEvent.mouseMove(rowB);

    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      expect(active?.getAttribute("aria-label")).toBe("edit A");
    });
  });

  test("Escape after editing returns focus to the same row", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Escape}");

    const editorA = await screen.findByLabelText("edit A");
    await userEvent.click(editorA);
    const rowA = editorA.closest('[data-row-focusable="true"]') as HTMLElement;
    const rowKey = rowA.getAttribute("data-view-key");

    await userEvent.keyboard(" updated{Escape}");

    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      const activeRow = active?.closest('[data-row-focusable="true"]');
      expect(active).toBe(activeRow);
      expect(activeRow?.getAttribute("data-view-key")).toBe(rowKey);
    });
  });

  test("Escape after creating a new node keeps focus on that new row", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Escape}");
    const pane0 = getPaneWrapper(0);

    fireEvent.keyDown(pane0, { key: "N" });
    const newEditor = await screen.findByLabelText("new node editor");
    await userEvent.type(newEditor, "Fresh node{Escape}");

    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      const activeRow = active?.closest('[data-row-focusable="true"]');
      expect(active).toBe(activeRow);
      expect(activeRow?.getAttribute("data-node-text")).toBe("Fresh node");
    });
  });

  test("Escape after Tab indent keeps focus on the moved node", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    const editorB = await screen.findByLabelText("edit B");
    await userEvent.click(editorB);
    await userEvent.keyboard("{Home}{Tab}{Escape}");

    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      const activeRow = active?.closest('[data-row-focusable="true"]');
      expect(active).toBe(activeRow);
      expect(activeRow?.getAttribute("data-node-text")).toBe("B");
      expect(activeRow?.getAttribute("data-row-depth")).toBe("3");
    });
  });

  test("Shift+Tab outdents node at cursor start", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}B{Escape}");

    const bEditor = await screen.findByLabelText("edit B");
    await userEvent.click(bEditor);
    await userEvent.keyboard("{Home}{Shift>}{Tab}{/Shift}");

    await expectTree(`
Root
  A
  B
    `);
  });

  test("x marks current node as not relevant and filter key 4 shows it again", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Escape}");
    const pane0 = getPaneWrapper(0);

    fireEvent.keyDown(pane0, { key: "j" });
    fireEvent.keyDown(pane0, { key: "x" });
    await waitFor(() => {
      expect(screen.queryByText("A")).toBeNull();
    });

    fireEvent.keyDown(pane0, { key: "4" });
    await screen.findByText("A");
  });

  test("f-prefixed symbols toggle pane filters", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Escape}");
    const pane0 = getPaneWrapper(0);
    const relevantFilter = await screen.findByLabelText("toggle Relevant filter");

    expect(relevantFilter.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(pane0, { key: "f" });
    fireEvent.keyDown(pane0, { key: "!" });
    expect(relevantFilter.getAttribute("aria-pressed")).toBe("false");

    fireEvent.keyDown(pane0, { key: "f" });
    fireEvent.keyDown(pane0, { key: "!" });
    expect(relevantFilter.getAttribute("aria-pressed")).toBe("true");
  });

  test("z opens current row in fullscreen", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Escape}");
    const pane0 = getPaneWrapper(0);

    fireEvent.keyDown(pane0, { key: "g" });
    fireEvent.keyDown(pane0, { key: "g" });
    fireEvent.keyDown(pane0, { key: "j" });
    fireEvent.keyDown(pane0, { key: "z" });

    await screen.findByLabelText("Navigate to Root");
  });

  test("Escape closes keyboard shortcuts modal opened with Cmd/Ctrl+/", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    const pane0 = getPaneWrapper(0);

    fireEvent.keyDown(pane0, { key: "/", metaKey: true });
    await screen.findByLabelText("keyboard shortcuts");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByLabelText("keyboard shortcuts")).toBeNull();
    });
  });

  test("H navigates to home (~Log) in normal mode", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("My Notes{Escape}");
    const pane0 = getPaneWrapper(0);

    fireEvent.keyDown(pane0, { key: "H" });
    await screen.findByLabelText("collapse ~Log");
  });

  test("K opens keyboard shortcuts modal", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    const pane0 = getPaneWrapper(0);

    fireEvent.keyDown(pane0, { key: "K" });
    await screen.findByLabelText("keyboard shortcuts");
  });

  test("[ and ] switch between panes", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Escape}");
    const pane0 = getPaneWrapper(0);

    fireEvent.keyDown(pane0, { key: "P" });
    await screen.findByLabelText("Search to change pane 1 content");
    const pane1 = getPaneWrapper(1);

    pane0.focus();
    fireEvent.keyDown(pane0, { key: "]" });

    await waitFor(() => {
      expect(pane1.contains(document.activeElement)).toBe(true);
    });

    fireEvent.keyDown(pane1, { key: "[" });
    await waitFor(() => {
      expect(pane0.contains(document.activeElement)).toBe(true);
    });
  });
});
