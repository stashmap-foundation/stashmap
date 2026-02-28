import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  CAROL,
  expectTree,
  follow,
  renderApp,
  renderTree,
  setup,
  type,
  navigateToNodeViaSearch,
} from "../utils.test";

async function clickRow(name: string): Promise<void> {
  const row = await screen.findByLabelText(name);
  await userEvent.click(row);
}

async function setupItemLevelIncomingRef(): Promise<void> {
  await type("Money{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Info{Escape}");

  await clickRow("Money / Bitcoin");
  await userEvent.keyboard("!");

  await expectTree(`
Crypto
  Bitcoin
    Info
    [R] Money / Bitcoin
    `);

  await navigateToNodeViaSearch(0, "Money");

  await expectTree(`
Money
  Bitcoin
    Details
    [I] Bitcoin ! <<< Crypto
    `);
}

async function setupTwoIncomingRefs(): Promise<void> {
  await type("Money{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Info{Escape}");

  await clickRow("Money / Bitcoin");
  await userEvent.keyboard("!");

  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("Tech{Enter}{Tab}Bitcoin{Enter}{Tab}Stuff{Escape}");

  await clickRow("Money / Bitcoin");
  await userEvent.keyboard("!");

  await navigateToNodeViaSearch(0, "Money");

  await expectTree(`
Money
  Bitcoin
    Details
    [I] Bitcoin ! <<< Crypto
    [I] Bitcoin ! <<< Tech
    `);
}

describe("Incoming reference display", () => {
  test("cref from another context shows as incoming ref on target", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Money{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Info{Escape}");

    await expectTree(`
Crypto
  Bitcoin
    Info
    [C] Money / Bitcoin
    `);

    await clickRow("Money / Bitcoin");
    await userEvent.keyboard("!");

    await expectTree(`
Crypto
  Bitcoin
    Info
    [R] Money / Bitcoin
    `);

    await navigateToNodeViaSearch(0, "Money");

    await expectTree(`
Money
  Bitcoin
    Details
    [I] Bitcoin ! <<< Crypto
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Money
  Bitcoin
    Details
    [I] Bitcoin ! <<< Crypto
    `);
  });

  test("incoming ref shows outgoing cref relevance indicator", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Money{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Info{Escape}");

    await clickRow("Money / Bitcoin");
    await userEvent.keyboard("?");

    await expectTree(`
Crypto
  Bitcoin
    Info
    [R] Money / Bitcoin
    `);

    await navigateToNodeViaSearch(0, "Money");

    await expectTree(`
Money
  Bitcoin
    Details
    [I] Bitcoin ? <<< Crypto
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Money
  Bitcoin
    Details
    [I] Bitcoin ? <<< Crypto
    `);
  });
});

describe("Incoming keyboard relevance", () => {
  test("? accepts incoming as maybe_relevant bidirectional", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await clickRow("Bitcoin ! <<< Crypto");
    await userEvent.keyboard("?");

    await expectTree(
      `
Money
  Bitcoin
    Details
    {?} [R] Crypto <<< >>> ! Bitcoin
    `,
      { showGutter: true }
    );

    cleanup();
    renderApp(alice());

    await expectTree(
      `
Money
  Bitcoin
    Details
    {?} [R] Crypto <<< >>> ! Bitcoin
    `,
      { showGutter: true }
    );
  });

  test("~ accepts incoming as little_relevant (filtered by default)", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await clickRow("Bitcoin ! <<< Crypto");
    await userEvent.keyboard("~");

    await expectTree(`
Money
  Bitcoin
    Details
    `);

    await userEvent.click(
      await screen.findByLabelText("toggle Little Relevant filter")
    );

    await expectTree(
      `
Money
  Bitcoin
    Details
    {~} [R] Crypto <<< >>> ! Bitcoin
    `,
      { showGutter: true }
    );

    cleanup();
    renderApp(alice());

    await expectTree(
      `
Money
  Bitcoin
    Details
    {~} [R] Crypto <<< >>> ! Bitcoin
    `,
      { showGutter: true }
    );
  });
});

describe("Incoming keyboard argument", () => {
  test("+ accepts incoming and sets confirms argument", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await clickRow("Bitcoin ! <<< Crypto");
    await userEvent.keyboard("+");

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    `);

    await screen.findByLabelText(
      "Evidence for Crypto <<< >>> ! Bitcoin: Confirms"
    );

    cleanup();
    renderApp(alice());

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    `);

    await screen.findByLabelText(
      "Evidence for Crypto <<< >>> ! Bitcoin: Confirms"
    );
  });

  test("- accepts incoming and sets contra argument", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await clickRow("Bitcoin ! <<< Crypto");
    await userEvent.keyboard("-");

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    `);

    await screen.findByLabelText(
      "Evidence for Crypto <<< >>> ! Bitcoin: Contradicts"
    );

    cleanup();
    renderApp(alice());

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    `);

    await screen.findByLabelText(
      "Evidence for Crypto <<< >>> ! Bitcoin: Contradicts"
    );
  });

  test("o clears argument after + sets it", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await clickRow("Bitcoin ! <<< Crypto");
    await userEvent.keyboard("+");

    await screen.findByLabelText(
      "Evidence for Crypto <<< >>> ! Bitcoin: Confirms"
    );

    await userEvent.keyboard("o");

    await screen.findByLabelText(
      "Evidence for Crypto <<< >>> ! Bitcoin: No evidence type"
    );

    cleanup();
    renderApp(alice());

    await screen.findByLabelText(
      "Evidence for Crypto <<< >>> ! Bitcoin: No evidence type"
    );
  });
});

describe("Multiselect keyboard", () => {
  test("multiple incoming refs, ! accepts all", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupTwoIncomingRefs();

    await clickRow("Bitcoin ! <<< Crypto");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("!");

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    [R] Tech <<< >>> ! Bitcoin
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    [R] Tech <<< >>> ! Bitcoin
    `);
  });

  test("mixed regular + incoming, ! sets relevance on both", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await clickRow("Details");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await userEvent.keyboard("!");

    await expectTree(
      `
Money
  Bitcoin
    {!} Details
    {!} [R] Crypto <<< >>> ! Bitcoin
    `,
      { showGutter: true }
    );

    cleanup();
    renderApp(alice());

    await expectTree(
      `
Money
  Bitcoin
    {!} Details
    {!} [R] Crypto <<< >>> ! Bitcoin
    `,
      { showGutter: true }
    );
  });
});

describe("Button clicks", () => {
  test("clicking relevance button accepts incoming ref", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await userEvent.click(
      await screen.findByLabelText("accept Bitcoin ! <<< Crypto as relevant")
    );

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    `);
  });

  test("clicking x button declines incoming ref", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await userEvent.click(
      await screen.findByLabelText("decline Bitcoin ! <<< Crypto")
    );

    await expectTree(`
Money
  Bitcoin
    Details
    `);

    await userEvent.click(
      await screen.findByLabelText("toggle Not Relevant filter")
    );

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Bitcoin ! <<< Crypto
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Bitcoin ! <<< Crypto
    `);
  });
});

describe("Evidence selector on incoming ref", () => {
  test("clicking evidence selector accepts and sets argument", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await userEvent.click(
      await screen.findByLabelText(
        "Evidence for Bitcoin ! <<< Crypto: No evidence type"
      )
    );

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    `);

    await screen.findByLabelText(
      "Evidence for Crypto <<< >>> ! Bitcoin: Confirms"
    );

    cleanup();
    renderApp(alice());

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    `);

    await screen.findByLabelText(
      "Evidence for Crypto <<< >>> ! Bitcoin: Confirms"
    );
  });
});

describe("Head-level incoming refs via alt-drag", () => {
  test("alt-drag creates head-level cref, incoming ref appears on source", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Source{Enter}{Tab}Child{Escape}");
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Target{Enter}{Tab}Items{Escape}");

    await expectTree(`
Target
  Items
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Source");

    await userEvent.keyboard("{Alt>}");
    const sourceItems = screen.getAllByRole("treeitem", { name: "Source" });
    fireEvent.dragStart(sourceItems[sourceItems.length - 1]);
    const targetItems = screen.getAllByRole("treeitem", { name: "Target" });
    fireEvent.dragOver(targetItems[0], { altKey: true });
    fireEvent.drop(targetItems[0], { altKey: true });
    await userEvent.keyboard("{/Alt}");

    await userEvent.click(screen.getAllByLabelText("Close pane")[0]);

    await navigateToNodeViaSearch(0, "Source");

    await expectTree(`
Source
  Child
  [I] Target
    `);

    cleanup();
    renderApp(alice());

    await navigateToNodeViaSearch(0, "Source");

    await expectTree(`
Source
  Child
  [I] Target
    `);
  });

  test("! on head-level incoming ref creates bidirectional", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Source{Enter}{Tab}Child{Escape}");
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Target{Enter}{Tab}Items{Escape}");

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Source");

    await userEvent.keyboard("{Alt>}");
    const sourceItems = screen.getAllByRole("treeitem", { name: "Source" });
    fireEvent.dragStart(sourceItems[sourceItems.length - 1]);
    const targetItems = screen.getAllByRole("treeitem", { name: "Target" });
    fireEvent.dragOver(targetItems[0], { altKey: true });
    fireEvent.drop(targetItems[0], { altKey: true });
    await userEvent.keyboard("{/Alt}");

    await userEvent.click(screen.getAllByLabelText("Close pane")[0]);

    await navigateToNodeViaSearch(0, "Source");

    await clickRow("Target");
    await userEvent.keyboard("!");

    await expectTree(`
Source
  Child
  [R] Target
    `);

    cleanup();
    renderApp(alice());

    await navigateToNodeViaSearch(0, "Source");

    await expectTree(`
Source
  Child
  [R] Target
    `);
  });

  test("full round-trip head-level: both sides bidirectional", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Source{Enter}{Tab}Child{Escape}");
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Target{Enter}{Tab}Items{Escape}");

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Source");

    await userEvent.keyboard("{Alt>}");
    const sourceItems = screen.getAllByRole("treeitem", { name: "Source" });
    fireEvent.dragStart(sourceItems[sourceItems.length - 1]);
    const targetItems = screen.getAllByRole("treeitem", { name: "Target" });
    fireEvent.dragOver(targetItems[0], { altKey: true });
    fireEvent.drop(targetItems[0], { altKey: true });
    await userEvent.keyboard("{/Alt}");

    await userEvent.click(screen.getAllByLabelText("Close pane")[0]);

    await navigateToNodeViaSearch(0, "Source");

    await clickRow("Target");
    await userEvent.keyboard("!");

    await expectTree(`
Source
  Child
  [R] Target
    `);

    await navigateToNodeViaSearch(0, "Target");

    await expectTree(`
Target
  [R] Source
  Items
    `);

    cleanup();
    renderApp(alice());

    await navigateToNodeViaSearch(0, "Source");

    await expectTree(`
Source
  Child
  [R] Target
    `);

    await navigateToNodeViaSearch(0, "Target");

    await expectTree(`
Target
  [R] Source
  Items
    `);
  });
});

describe("Filter toggle", () => {
  test("toggle Incoming filter off hides incoming refs, back on shows them", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await expectTree(`
Money
  Bitcoin
    Details
    [I] Bitcoin ! <<< Crypto
    `);

    await userEvent.click(
      await screen.findByLabelText("toggle Incoming filter")
    );

    await expectTree(`
Money
  Bitcoin
    Details
    `);

    await userEvent.click(
      await screen.findByLabelText("toggle Incoming filter")
    );

    await expectTree(`
Money
  Bitcoin
    Details
    [I] Bitcoin ! <<< Crypto
    `);
  });

  test("toggle Occurrences filter off hides occurrences but NOT incoming refs", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Money{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Info{Escape}");

    await clickRow("Money / Bitcoin");
    await userEvent.keyboard("!");

    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Tech{Enter}{Tab}Bitcoin{Enter}{Tab}Stuff{Escape}");

    await navigateToNodeViaSearch(0, "Money");

    await expectTree(`
Money
  Bitcoin
    Details
    [I] Bitcoin ! <<< Crypto
    [C] Tech / Bitcoin
    `);

    await userEvent.click(
      await screen.findByLabelText("toggle Occurrences filter")
    );

    await expectTree(`
Money
  Bitcoin
    Details
    [I] Bitcoin ! <<< Crypto
    `);

    await userEvent.click(
      await screen.findByLabelText("toggle Occurrences filter")
    );

    await expectTree(`
Money
  Bitcoin
    Details
    [I] Bitcoin ! <<< Crypto
    [C] Tech / Bitcoin
    `);
  });
});

describe("Drag and drop incoming refs", () => {
  test("drag incoming ref onto sibling accepts it", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await expectTree(`
Money
  Bitcoin
    Details
    [I] Bitcoin ! <<< Crypto
    `);

    const source = screen.getByRole("treeitem", {
      name: "Bitcoin ! <<< Crypto",
    });
    const target = screen.getByRole("treeitem", { name: "Details" });

    fireEvent.dragStart(source);
    fireEvent.drop(target);

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    `);
  });

  test("drag multiple selected incoming refs accepts all", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupTwoIncomingRefs();

    await clickRow("Bitcoin ! <<< Crypto");
    await userEvent.keyboard("{Shift>}j{/Shift}");

    const source = screen.getByRole("treeitem", {
      name: "Bitcoin ! <<< Crypto",
    });
    const target = screen.getByRole("treeitem", { name: "Details" });

    fireEvent.dragStart(source);
    fireEvent.drop(target);

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    [R] Tech <<< >>> ! Bitcoin
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    [R] Tech <<< >>> ! Bitcoin
    `);
  });

  test("drag incoming ref into another pane", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Crypto");

    const source = screen.getAllByRole("treeitem", {
      name: "Bitcoin ! <<< Crypto",
    })[0];
    const targetItems = screen.getAllByRole("treeitem", { name: "Bitcoin" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    fireEvent.dragStart(source);
    fireEvent.drop(targetInPane1);

    await expectTree(`
Money
  Bitcoin
    Details
    [I] Bitcoin ! <<< Crypto
Crypto
  Bitcoin
  [R] Crypto / Bitcoin
    `);

    cleanup();
    renderApp(alice());

    await navigateToNodeViaSearch(0, "Money");
    await navigateToNodeViaSearch(1, "Crypto");

    await expectTree(`
Money
  Bitcoin
    Details
    [I] Bitcoin ! <<< Crypto
Crypto
  Bitcoin
  [R] Crypto / Bitcoin
    `);
  });

  test("mixed drag: regular node + incoming ref accepts incoming", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await clickRow("Details");
    await userEvent.keyboard("{Shift>}j{/Shift}");

    const source = screen.getByRole("treeitem", { name: "Details" });
    const target = screen.getByRole("treeitem", { name: "Money" });

    fireEvent.dragStart(source);
    fireEvent.drop(target);

    await expectTree(`
Money
  Details
  [R] Crypto <<< >>> ! Bitcoin
  Bitcoin
    [I] Bitcoin ! <<< Crypto
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Money
  Details
  [R] Crypto <<< >>> ! Bitcoin
  Bitcoin
    [I] Bitcoin ! <<< Crypto
    `);
  });
});

describe("Item-level bidirectional", () => {
  test("! on item-level incoming ref creates bidirectional", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await clickRow("Bitcoin ! <<< Crypto");
    await userEvent.keyboard("!");

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    `);
  });

  test("x on item-level incoming ref hides it, toggle shows as incoming", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await clickRow("Bitcoin ! <<< Crypto");
    await userEvent.keyboard("x");

    await expectTree(`
Money
  Bitcoin
    Details
    `);

    await userEvent.click(
      await screen.findByLabelText("toggle Not Relevant filter")
    );

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Bitcoin ! <<< Crypto
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Bitcoin ! <<< Crypto
    `);
  });

  test("not_relevant on source side prevents bidirectional", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await clickRow("Bitcoin ! <<< Crypto");
    await userEvent.keyboard("!");

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    `);

    await navigateToNodeViaSearch(0, "Crypto");

    await expectTree(`
Crypto
  Bitcoin
    Info
    [R] Money <<< >>> ! Bitcoin
    `);

    await clickRow("Money <<< >>> ! Bitcoin");
    await userEvent.keyboard("x");

    await expectTree(`
Crypto
  Bitcoin
    Info
    `);

    await navigateToNodeViaSearch(0, "Money");

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto / Bitcoin
    `);

    cleanup();
    renderApp(alice());

    await navigateToNodeViaSearch(0, "Money");

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto / Bitcoin
    `);
  });

  test("full round-trip: both sides show bidirectional", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await clickRow("Bitcoin ! <<< Crypto");
    await userEvent.keyboard("!");

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    `);

    await navigateToNodeViaSearch(0, "Crypto");

    await expectTree(`
Crypto
  Bitcoin
    Info
    [R] Money <<< >>> ! Bitcoin
    `);

    cleanup();
    renderApp(alice());

    await navigateToNodeViaSearch(0, "Money");

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    `);

    await navigateToNodeViaSearch(0, "Crypto");

    await expectTree(`
Crypto
  Bitcoin
    Info
    [R] Money <<< >>> ! Bitcoin
    `);
  });
});

describe("Multi-user incoming refs", () => {
  test("incoming ref from other user shows [OI] prefix", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(alice);
    await type("Money{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");
    cleanup();

    await follow(bob, alice().user.publicKey);
    renderTree(bob);
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Info{Escape}");

    await expectTree(`
Crypto
  Bitcoin
    Info
    [OC] Money / Bitcoin
    `);

    const row = await screen.findByLabelText("Money / Bitcoin");
    await userEvent.click(row);
    await userEvent.keyboard("!");

    await expectTree(`
Crypto
  Bitcoin
    Info
    [OR] Money / Bitcoin
    `);

    cleanup();

    await follow(alice, bob().user.publicKey);
    renderTree(alice);

    await expectTree(`
Money
  Bitcoin
    Details
    [OI] Bitcoin ! <<< Crypto
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
Money
  Bitcoin
    Details
    [OI] Bitcoin ! <<< Crypto
    `);
  });

  test("accepting [OI] incoming ref creates bidirectional", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(alice);
    await type("Money{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");
    cleanup();

    await follow(bob, alice().user.publicKey);
    renderTree(bob);
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Info{Escape}");

    const row = await screen.findByLabelText("Money / Bitcoin");
    await userEvent.click(row);
    await userEvent.keyboard("!");
    cleanup();

    await follow(alice, bob().user.publicKey);
    renderTree(alice);

    await expectTree(`
Money
  Bitcoin
    Details
    [OI] Bitcoin ! <<< Crypto
    `);

    const incomingRow = await screen.findByLabelText("Bitcoin ! <<< Crypto");
    await userEvent.click(incomingRow);
    await userEvent.keyboard("!");

    await expectTree(`
Money
  Bitcoin
    Details
    [OR] Crypto <<< >>> ! Bitcoin
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
Money
  Bitcoin
    Details
    [OR] Crypto <<< >>> ! Bitcoin
    `);
  });

  test("declining [OI] incoming ref hides it", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(alice);
    await type("Money{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");
    cleanup();

    await follow(bob, alice().user.publicKey);
    renderTree(bob);
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Info{Escape}");

    const row = await screen.findByLabelText("Money / Bitcoin");
    await userEvent.click(row);
    await userEvent.keyboard("!");
    cleanup();

    await follow(alice, bob().user.publicKey);
    renderTree(alice);

    const incomingRow = await screen.findByLabelText("Bitcoin ! <<< Crypto");
    await userEvent.click(incomingRow);
    await userEvent.keyboard("x");

    await expectTree(`
Money
  Bitcoin
    Details
    `);

    await userEvent.click(
      await screen.findByLabelText("toggle Not Relevant filter")
    );

    await expectTree(`
Money
  Bitcoin
    Details
    [OR] Bitcoin ! <<< Crypto
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
Money
  Bitcoin
    Details
    [OR] Bitcoin ! <<< Crypto
    `);
  });

  test("dedup: Bob + Carol both have crefs to Alice, only one incoming shows", async () => {
    const [alice, bob, carol] = setup([ALICE, BOB, CAROL]);

    renderTree(alice);
    await type("Money{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");
    cleanup();

    await follow(bob, alice().user.publicKey);
    renderTree(bob);
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Info{Escape}");

    const bobRow = await screen.findByLabelText("Money / Bitcoin");
    await userEvent.click(bobRow);
    await userEvent.keyboard("!");
    cleanup();

    await follow(carol, alice().user.publicKey);
    renderTree(carol);
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Stuff{Escape}");

    const carolRow = await screen.findByLabelText("Money / Bitcoin");
    await userEvent.click(carolRow);
    await userEvent.keyboard("!");
    cleanup();

    await follow(alice, bob().user.publicKey);
    await follow(alice, carol().user.publicKey);
    renderTree(alice);

    await expectTree(`
Money
  Bitcoin
    Details
    [OI] Bitcoin ! <<< Crypto
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
Money
  Bitcoin
    Details
    [OI] Bitcoin ! <<< Crypto
    `);
  });
});

describe("Tombstone / deleted ref interactions", () => {
  test("accept incoming ref, delete source relation, outgoing cref shows [D]", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await clickRow("Bitcoin ! <<< Crypto");
    await userEvent.keyboard("!");

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    `);

    await navigateToNodeViaSearch(0, "Crypto");

    await expectTree(`
Crypto
  Bitcoin
    Info
    [R] Money <<< >>> ! Bitcoin
    `);

    await userEvent.click(await screen.findByLabelText("edit Crypto"));
    await userEvent.keyboard("{Escape}{Delete}");

    await navigateToNodeViaSearch(0, "Money");

    await expectTree(`
Money
  Bitcoin
    Details
    [D] (deleted) Crypto / Bitcoin
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Money
  Bitcoin
    Details
    [D] (deleted) Crypto / Bitcoin
    `);
  });

  test("delete source of incoming ref, incoming ref disappears", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await expectTree(`
Money
  Bitcoin
    Details
    [I] Bitcoin ! <<< Crypto
    `);

    await navigateToNodeViaSearch(0, "Crypto");

    await userEvent.click(await screen.findByLabelText("edit Crypto"));
    await userEvent.keyboard("{Escape}{Delete}");

    await navigateToNodeViaSearch(0, "Money");

    await expectTree(`
Money
  Bitcoin
    Details
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Money
  Bitcoin
    Details
    `);
  });

  test("bidirectional, delete one side, remaining shows [D] on both sides", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await setupItemLevelIncomingRef();

    await clickRow("Bitcoin ! <<< Crypto");
    await userEvent.keyboard("!");

    await expectTree(`
Money
  Bitcoin
    Details
    [R] Crypto <<< >>> ! Bitcoin
    `);

    await navigateToNodeViaSearch(0, "Crypto");

    await expectTree(`
Crypto
  Bitcoin
    Info
    [R] Money <<< >>> ! Bitcoin
    `);

    await userEvent.click(await screen.findByLabelText("edit Crypto"));
    await userEvent.keyboard("{Escape}{Delete}");

    await navigateToNodeViaSearch(0, "Money");

    await expectTree(`
Money
  Bitcoin
    Details
    [D] (deleted) Crypto / Bitcoin
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Money
  Bitcoin
    Details
    [D] (deleted) Crypto / Bitcoin
    `);
  });
});
