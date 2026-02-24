import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  expectTree,
  renderApp,
  setup,
  type,
  getPane,
  navigateToNodeViaSearch,
} from "../utils.test";

async function clickRow(name: string): Promise<void> {
  const row = await screen.findByLabelText(name);
  await userEvent.click(row);
}

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

async function setupOccurrence(): Promise<void> {
  await type("Money{Enter}{Tab}Bitcoin{Escape}");
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

  await expectTree(`
Crypto
  Bitcoin
    Details
    [C] Money / Bitcoin
    `);
}

async function setupTwoOccurrences(): Promise<void> {
  await type("Money{Enter}{Tab}Bitcoin{Escape}");
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("Tech{Enter}{Tab}Bitcoin{Escape}");
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

  await expectTree(`
Crypto
  Bitcoin
    Details
    [C] Tech / Bitcoin
    [C] Money / Bitcoin
    `);
}

describe("Occurrence keyboard relevance", () => {
  test("! accepts occurrence as relevant", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    await clickRow("Money / Bitcoin");
    await userEvent.keyboard("!");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);
  });

  test("~ accepts occurrence as little_relevant (filtered by default)", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    await clickRow("Money / Bitcoin");
    await userEvent.keyboard("~");

    await expectTree(`
Crypto
  Bitcoin
    Details
    `);
  });

  test("? accepts occurrence as maybe_relevant", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    await clickRow("Money / Bitcoin");
    await userEvent.keyboard("?");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);
  });

  test("x accepts occurrence as not_relevant (filtered by default)", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    await clickRow("Money / Bitcoin");
    await userEvent.keyboard("x");

    await expectTree(`
Crypto
  Bitcoin
    Details
    `);
  });

  test("not_relevant occurrence stays when filter toggled to show", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    await clickRow("Money / Bitcoin");
    await userEvent.keyboard("x");

    await expectTree(`
Crypto
  Bitcoin
    Details
    `);

    await userEvent.click(
      await screen.findByLabelText("toggle Not Relevant filter")
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< Bitcoin
    `);
  });

  test("not_relevant item in source relation does not trigger bidirectional indicator", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    await clickRow("Money / Bitcoin");
    await userEvent.keyboard("!");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);

    await navigateToNodeViaSearch(0, "Money");
    await clickRow("Bitcoin");
    await userEvent.keyboard("x");

    await expectTree(`
Money
    `);

    await navigateToNodeViaSearch(0, "Crypto");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money >>> Bitcoin
    `);
  });
});

describe("Occurrence keyboard argument", () => {
  test("+ accepts occurrence and sets argument confirms", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    await clickRow("Money / Bitcoin");
    await userEvent.keyboard("+");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);
    await screen.findByLabelText(/Evidence for.*Money.*Confirms/);
  });

  test("- accepts occurrence and sets argument contra", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    await clickRow("Money / Bitcoin");
    await userEvent.keyboard("-");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);
    await screen.findByLabelText(/Evidence for.*Money.*Contradicts/);
  });

  test("o clears argument on accepted occurrence", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    await clickRow("Money / Bitcoin");
    await userEvent.keyboard("+");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);
    await screen.findByLabelText(/Evidence for.*Money.*Confirms/);

    await userEvent.keyboard("o");
    await screen.findByLabelText(/Evidence for.*Money.*No evidence type/);
  });
});

describe("Occurrence multiselect keyboard", () => {
  test("mixed selection: regular + occurrence, ! sets relevance on both", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    await clickRow("Details");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("!");

    await expectRelevance("Details", "Relevant");
    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);
  });

  test("multiple occurrences selected, ! accepts all", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupTwoOccurrences();

    await clickRow("Tech / Bitcoin");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("!");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Tech <<< >>> Bitcoin
    [R] Money <<< >>> Bitcoin
    `);
  });

  test("multiple regular items + multiple occurrences, ! sets relevance on all", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Money{Enter}{Tab}Bitcoin{Escape}");
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Tech{Enter}{Tab}Bitcoin{Escape}");
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}A{Enter}B{Escape}");

    await expectTree(`
Crypto
  Bitcoin
    A
    B
    [C] Tech / Bitcoin
    [C] Money / Bitcoin
    `);

    // Select all 4: A, B, Tech occurrence, Money occurrence
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("!");

    await expectRelevance("A", "Relevant");
    await expectRelevance("B", "Relevant");
    await expectTree(`
Crypto
  Bitcoin
    A
    B
    [R] Tech <<< >>> Bitcoin
    [R] Money <<< >>> Bitcoin
    `);
  });

  test("mixed selection with + accepts occurrence and sets argument on both", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    await clickRow("Details");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("+");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);
    await screen.findByLabelText(/Evidence for.*Details.*Confirms/);
    await screen.findByLabelText(/Evidence for.*Money.*Confirms/);
  });
});

describe("Occurrence button clicks", () => {
  test("clicking ! button accepts occurrence", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    await userEvent.click(
      await screen.findByLabelText(/accept Money \/ Bitcoin as relevant/)
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);
  });

  test("clicking x button declines occurrence (filtered)", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    await userEvent.click(
      await screen.findByLabelText(/decline Money \/ Bitcoin/)
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    `);
  });

  test("clicking ! button with multiselect accepts all selected occurrences", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupTwoOccurrences();

    await clickRow("Tech / Bitcoin");
    await userEvent.keyboard("{Shift>}j{/Shift}");

    await userEvent.click(
      await screen.findByLabelText(/accept Money \/ Bitcoin as relevant/)
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Tech <<< >>> Bitcoin
    [R] Money <<< >>> Bitcoin
    `);
  });

  test("clicking ! button with mixed selection sets relevance on regular and accepts occurrence", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    await clickRow("Details");
    await userEvent.keyboard("{Shift>}j{/Shift}");

    await userEvent.click(
      await screen.findByLabelText(/accept Money \/ Bitcoin as relevant/)
    );

    await expectRelevance("Details", "Relevant");
    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);
  });
});

describe("Occurrence evidence selector", () => {
  test("evidence selector is visible on occurrence", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    await screen.findByLabelText(/Evidence for Money \/ Bitcoin/);
  });

  test("clicking evidence selector accepts occurrence and sets argument", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    await userEvent.click(
      await screen.findByLabelText(/Evidence for Money \/ Bitcoin/)
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);
    await screen.findByLabelText(/Evidence for.*Money.*Confirms/);
  });
});

test("Enter on root node with occurrences but no children creates new child", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type("Money{Enter}{Tab}Barcelona{Escape}");
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("Spain{Enter}{Tab}Barcelona{Escape}");

  await userEvent.click(
    await screen.findByLabelText("open Barcelona in fullscreen")
  );
  await expectTree(`
Barcelona
  [C] Money / Barcelona
  `);

  const editor = await screen.findByLabelText("edit Barcelona");
  await userEvent.click(editor);
  await userEvent.keyboard("{Enter}");

  await expectTree(`
Barcelona
  [NEW NODE]
  [C] Money / Barcelona
  `);
});

describe("Occurrence drag and drop", () => {
  test("dragging occurrence onto a sibling accepts it", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    const occurrence = await screen.findByLabelText("Money / Bitcoin");
    const details = await screen.findByLabelText("Details");

    fireEvent.dragStart(occurrence);
    fireEvent.drop(details);

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);
  });

  test("dragging multiple selected occurrences onto a sibling accepts all", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupTwoOccurrences();

    await clickRow("Tech / Bitcoin");
    await userEvent.keyboard("{Shift>}j{/Shift}");

    const occurrence = await screen.findByLabelText("Tech / Bitcoin");
    const details = await screen.findByLabelText("Details");

    fireEvent.dragStart(occurrence);
    fireEvent.drop(details);

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Tech <<< >>> Bitcoin
    [R] Money <<< >>> Bitcoin
    `);
  });

  test("mixed selection drag: regular item + occurrence to top of list", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Money{Enter}{Tab}Bitcoin{Escape}");
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type(
      "Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}A{Enter}B{Enter}C{Escape}"
    );

    await expectTree(`
Crypto
  Bitcoin
    A
    B
    C
    [C] Money / Bitcoin
    `);

    // Select C + occurrence
    await clickRow("C");
    await userEvent.keyboard("{Shift>}j{/Shift}");

    const c = await screen.findByLabelText("C");
    const a = await screen.findByLabelText("A");

    fireEvent.dragStart(c);
    fireEvent.drop(a);

    await expectTree(`
Crypto
  Bitcoin
    A
    C
    [R] Money <<< >>> Bitcoin
    B
    `);
  });

  test("dragging occurrence into another pane accepts it", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    await userEvent.click(screen.getByLabelText("Open new pane"));
    await navigateToNodeViaSearch(1, "Money");

    const occurrence = await screen.findByLabelText("Money / Bitcoin");
    const moneyCollapse = getPane(1).getByLabelText("collapse Money");

    fireEvent.dragStart(occurrence);
    fireEvent.drop(moneyCollapse);

    await expectTree(`
Crypto
  Bitcoin
    Details
    [C] Money / Bitcoin
Money
  [V]
  Bitcoin
    `);
  });
});

describe("Occurrence filter toggle", () => {
  test("pressing 0 on focused occurrence hides it and pressing 0 again brings it back", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    await clickRow("Money / Bitcoin");
    await userEvent.keyboard("0");

    await expectTree(`
Crypto
  Bitcoin
    Details
    `);

    await userEvent.keyboard("0");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [C] Money / Bitcoin
    `);
  });

  test("toggling off occurrences filter hides occurrences", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Barcelona{Enter}{Tab}Best Tapas{Escape}");
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type(
      "Cities{Enter}{Tab}Barcelona{Enter}{Tab}Sagrada Familia{Escape}"
    );

    await expectTree(`
Cities
  Barcelona
    Sagrada Familia
    [C] Barcelona
    `);

    await userEvent.click(
      await screen.findByLabelText("toggle Occurrences filter")
    );

    await expectTree(`
Cities
  Barcelona
    Sagrada Familia
    `);
  });

  test("toggling occurrences filter back on shows them again", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupOccurrence();

    const btn = await screen.findByLabelText("toggle Occurrences filter");
    await userEvent.click(btn);

    await expectTree(`
Crypto
  Bitcoin
    Details
    `);

    await userEvent.click(btn);

    await expectTree(`
Crypto
  Bitcoin
    Details
    [C] Money / Bitcoin
    `);
  });
});
