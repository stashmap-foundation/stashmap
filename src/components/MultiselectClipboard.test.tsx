import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  expectTree,
  findNewNodeEditor,
  navigateToNodeViaSearch,
  renderApp,
  setup,
  type,
} from "../utils.test";
import {
  clickRow,
  expectTargets,
  getSelectedNodes,
  modClick,
} from "./Multiselect.testUtils";

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

  test("Cmd+V pastes flat children as children of focused row", async () => {
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

  test("Cmd+V pastes nested children preserving hierarchy", async () => {
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
