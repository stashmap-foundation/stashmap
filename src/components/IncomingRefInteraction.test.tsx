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

async function setupIncomingRef(): Promise<void> {
  await type("Money{Enter}{Tab}Bitcoin{Escape}");
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

  await expectTree(`
Crypto
  Bitcoin
    Details
    [I] Bitcoin  <<< Money
    `);
}

async function setupTwoIncomingRefs(): Promise<void> {
  await type("Money{Enter}{Tab}Bitcoin{Escape}");
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("Tech{Enter}{Tab}Bitcoin{Escape}");
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

  await expectTree(`
Crypto
  Bitcoin
    Details
    [I] Bitcoin  <<< Tech
    [I] Bitcoin  <<< Money
    `);
}

describe("Incoming ref keyboard relevance", () => {
  test("! accepts incoming ref as relevant", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupIncomingRef();

    await clickRow("Bitcoin <<< Money");
    await userEvent.keyboard("!");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);
  });

  test("~ accepts incoming ref as little_relevant (filtered by default)", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupIncomingRef();

    await clickRow("Bitcoin <<< Money");
    await userEvent.keyboard("~");

    await expectTree(`
Crypto
  Bitcoin
    Details
    `);
  });

  test("? accepts incoming ref as maybe_relevant", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupIncomingRef();

    await clickRow("Bitcoin <<< Money");
    await userEvent.keyboard("?");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);
  });

  test("x accepts incoming ref as not_relevant (filtered by default)", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupIncomingRef();

    await clickRow("Bitcoin <<< Money");
    await userEvent.keyboard("x");

    await expectTree(`
Crypto
  Bitcoin
    Details
    `);
  });

  test("not_relevant incoming ref stays incoming when filter toggled to show", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupIncomingRef();

    await clickRow("Bitcoin <<< Money");
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
    await setupIncomingRef();

    await clickRow("Bitcoin <<< Money");
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

describe("Incoming ref keyboard argument", () => {
  test("+ accepts incoming ref and sets argument confirms", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupIncomingRef();

    await clickRow("Bitcoin <<< Money");
    await userEvent.keyboard("+");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);
    await screen.findByLabelText(/Evidence for.*Money.*Confirms/);
  });

  test("- accepts incoming ref and sets argument contra", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupIncomingRef();

    await clickRow("Bitcoin <<< Money");
    await userEvent.keyboard("-");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);
    await screen.findByLabelText(/Evidence for.*Money.*Contradicts/);
  });

  test("o clears argument on accepted incoming ref", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupIncomingRef();

    await clickRow("Bitcoin <<< Money");
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

describe("Incoming ref multiselect keyboard", () => {
  test("mixed selection: regular + incoming, ! sets relevance on both", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupIncomingRef();

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

  test("multiple incoming refs selected, ! accepts all", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupTwoIncomingRefs();

    await clickRow("Bitcoin <<< Tech");
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

  test("multiple regular items + multiple incoming refs, ! sets relevance on all", async () => {
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
    [I] Bitcoin  <<< Tech
    [I] Bitcoin  <<< Money
    `);

    // Select all 4: A, B, Tech incoming, Money incoming
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

  test("mixed selection with + accepts incoming and sets argument on both", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupIncomingRef();

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

describe("Incoming ref button clicks", () => {
  test("clicking ! button accepts incoming ref", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupIncomingRef();

    await userEvent.click(
      await screen.findByLabelText(/accept .* <<< Money as relevant/)
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);
  });

  test("clicking x button declines incoming ref (filtered)", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupIncomingRef();

    await userEvent.click(await screen.findByLabelText(/decline .* <<< Money/));

    await expectTree(`
Crypto
  Bitcoin
    Details
    `);
  });

  test("clicking ! button with multiselect accepts all selected incoming refs", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupTwoIncomingRefs();

    await clickRow("Bitcoin <<< Tech");
    await userEvent.keyboard("{Shift>}j{/Shift}");

    await userEvent.click(
      await screen.findByLabelText(/accept .* <<< Money as relevant/)
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Tech <<< >>> Bitcoin
    [R] Money <<< >>> Bitcoin
    `);
  });

  test("clicking ! button with mixed selection sets relevance on regular and accepts incoming", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupIncomingRef();

    await clickRow("Details");
    await userEvent.keyboard("{Shift>}j{/Shift}");

    await userEvent.click(
      await screen.findByLabelText(/accept .* <<< Money as relevant/)
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

describe("Incoming ref evidence selector", () => {
  test("evidence selector is visible on incoming ref", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupIncomingRef();

    await screen.findByLabelText(/Evidence for Bitcoin <<< Money/);
  });

  test("clicking evidence selector accepts incoming ref and sets argument", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupIncomingRef();

    await userEvent.click(
      await screen.findByLabelText(/Evidence for Bitcoin <<< Money/)
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

test("Enter on root node with incoming refs but no children creates new child", async () => {
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
  [I] Barcelona  <<< Money
  `);

  const editor = await screen.findByLabelText("edit Barcelona");
  await userEvent.click(editor);
  await userEvent.keyboard("{Enter}");

  await expectTree(`
Barcelona
  [NEW NODE]
  [I] Barcelona  <<< Money
  `);
});

describe("Incoming ref drag and drop", () => {
  test("dragging incoming ref onto a sibling accepts it", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupIncomingRef();

    const incomingRef = await screen.findByLabelText("Bitcoin <<< Money");
    const details = await screen.findByLabelText("Details");

    fireEvent.dragStart(incomingRef);
    fireEvent.drop(details);

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);
  });

  test("dragging multiple selected incoming refs onto a sibling accepts all", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupTwoIncomingRefs();

    await clickRow("Bitcoin <<< Tech");
    await userEvent.keyboard("{Shift>}j{/Shift}");

    const incomingRef = await screen.findByLabelText("Bitcoin <<< Tech");
    const details = await screen.findByLabelText("Details");

    fireEvent.dragStart(incomingRef);
    fireEvent.drop(details);

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Tech <<< >>> Bitcoin
    [R] Money <<< >>> Bitcoin
    `);
  });

  test("mixed selection drag: regular item + incoming ref to top of list", async () => {
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
    [I] Bitcoin  <<< Money
    `);

    // Select C + incoming ref
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

  test("dragging incoming ref into another pane accepts it", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupIncomingRef();

    await userEvent.click(screen.getByLabelText("Open new pane"));
    await navigateToNodeViaSearch(1, "Money");

    const incomingRef = await screen.findByLabelText("Bitcoin <<< Money");
    const moneyCollapse = getPane(1).getByLabelText("collapse Money");

    fireEvent.dragStart(incomingRef);
    fireEvent.drop(moneyCollapse);

    await expectTree(`
Crypto
  Bitcoin
    Details
    [I] Bitcoin  <<< Money
Money
  [V]
  Bitcoin
    `);
  });
});

describe("Incoming ref filter toggle", () => {
  test("pressing 0 on focused incoming ref hides it and pressing 0 again brings it back", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupIncomingRef();

    await clickRow("Bitcoin <<< Money");
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
    [I] Bitcoin  <<< Money
    `);
  });

  test("toggling off incoming filter also hides occurrences", async () => {
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
      await screen.findByLabelText("toggle Incoming References filter")
    );

    await expectTree(`
Cities
  Barcelona
    Sagrada Familia
    `);
  });

  test("toggling incoming filter back on shows them again", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupIncomingRef();

    const btn = await screen.findByLabelText(
      "toggle Incoming References filter"
    );
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
    [I] Bitcoin  <<< Money
    `);
  });
});
