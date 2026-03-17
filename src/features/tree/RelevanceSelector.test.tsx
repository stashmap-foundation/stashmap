import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { List } from "immutable";
import {
  ALICE,
  BOB,
  CAROL,
  expectTree,
  follow,
  forkReadonlyRoot,
  getPane,
  navigateToNodeViaSearch,
  renderApp,
  renderTree,
  setup,
  type,
  type UpdateState,
} from "../../tests/testutils";
import { nodeMatchesType } from "../../graph/queries";
import type { GraphNode } from "../../graph/types";

function makeItem(
  id: ID,
  relevance: Relevance,
  argument?: Argument
): GraphNode {
  return {
    children: List<ID>(),
    id,
    text: "",
    updated: Date.now(),
    author: ALICE.publicKey,
    root: "root" as LongID,
    relevance,
    ...(argument !== undefined ? { argument } : {}),
  };
}

async function createForkedMyNotesVersion(
  alice: UpdateState,
  bob: UpdateState,
  aliceInput: string,
  bobRootInput: string
): Promise<void> {
  renderTree(alice);
  await type(aliceInput);
  cleanup();

  await follow(bob, alice().user.publicKey);
  await forkReadonlyRoot(bob(), alice().user.publicKey, "My Notes");
  await userEvent.click(await screen.findByLabelText("edit My Notes"));
  await userEvent.keyboard("{Enter}");
  await type(bobRootInput);
  cleanup();

  await follow(alice, bob().user.publicKey);
}

async function createForkedMyNotesNodeVersion(
  alice: UpdateState,
  bob: UpdateState,
  aliceInput: string,
  nodeLabel: string,
  bobNodeInput: string
): Promise<void> {
  renderTree(alice);
  await type(aliceInput);
  cleanup();

  await follow(bob, alice().user.publicKey);
  await forkReadonlyRoot(bob(), alice().user.publicKey, "My Notes");
  await userEvent.click(
    await screen.findByLabelText(`open ${nodeLabel} in fullscreen`)
  );
  await userEvent.click(await screen.findByLabelText(`edit ${nodeLabel}`));
  await userEvent.keyboard("{Enter}");
  await type(bobNodeInput);
  cleanup();

  await follow(alice, bob().user.publicKey);
}

async function createAcceptedItemLevelRefOnCurrentPane(
  relevanceKey: "!" | "?" = "!"
): Promise<void> {
  const sourceBitcoin = getPane(1).getByRole("treeitem", { name: "Bitcoin" });
  const targetBitcoin = getPane(0).getByRole("treeitem", { name: "Bitcoin" });

  await userEvent.keyboard("{Alt>}");
  fireEvent.dragStart(sourceBitcoin);
  fireEvent.dragOver(targetBitcoin, { altKey: true });
  fireEvent.drop(targetBitcoin, { altKey: true });
  await userEvent.keyboard("{/Alt}");

  await userEvent.click(
    await getPane(0).findByRole("treeitem", {
      name: /^Money \/ (?:[+-] )?Bitcoin$/,
    })
  );
  await userEvent.keyboard(relevanceKey);
}

async function selectIncomingRefRow(
  name: RegExp = /Bitcoin ! <<< Crypto/
): Promise<void> {
  const expandBitcoin = screen.queryByLabelText("expand Bitcoin");
  if (expandBitcoin) {
    await userEvent.click(expandBitcoin);
  }
  await userEvent.click(await screen.findByRole("treeitem", { name }));
}

async function setArgumentOnSource(argument: Argument): Promise<void> {
  await userEvent.click(
    screen.getByLabelText("Evidence for Bitcoin: No evidence type")
  );
  if (argument === "contra") {
    await userEvent.click(
      screen.getByLabelText("Evidence for Bitcoin: Confirms")
    );
  }
}

async function setupLocalIncomingRefOnMoney(
  relevanceKey: "!" | "?" = "!"
): Promise<void> {
  await type("Money{Enter}{Tab}Bitcoin{Escape}");
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await navigateToNodeViaSearch(1, "Money");
  await createAcceptedItemLevelRefOnCurrentPane(relevanceKey);
  await userEvent.click(getPane(1).getByLabelText("Close pane"));
  await navigateToNodeViaSearch(0, "Money");
}

async function setupLocalOutgoingRefOnCrypto(
  argument?: Argument
): Promise<void> {
  await type("Money{Enter}{Tab}Bitcoin{Escape}");
  if (argument) {
    await setArgumentOnSource(argument);
  }
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await navigateToNodeViaSearch(1, "Money");
  await createAcceptedItemLevelRefOnCurrentPane("!");
  await userEvent.click(getPane(1).getByLabelText("Close pane"));
  await navigateToNodeViaSearch(0, "Crypto");
}

describe("nodeMatchesType", () => {
  test("matches relevant children", () => {
    const item = makeItem("test" as ID, "relevant");
    expect(nodeMatchesType(item, "relevant")).toBe(true);
    expect(nodeMatchesType(item, "contains")).toBe(false);
  });

  test("matches maybe_relevant children", () => {
    const item = makeItem("test" as ID, "maybe_relevant");
    expect(nodeMatchesType(item, "maybe_relevant")).toBe(true);
    expect(nodeMatchesType(item, "relevant")).toBe(false);
  });

  test("matches contains children with undefined relevance", () => {
    const item = makeItem("test" as ID, undefined);
    expect(nodeMatchesType(item, "contains")).toBe(true);
    expect(nodeMatchesType(item, "relevant")).toBe(false);
  });

  test("matches little_relevant children", () => {
    const item = makeItem("test" as ID, "little_relevant");
    expect(nodeMatchesType(item, "little_relevant")).toBe(true);
    expect(nodeMatchesType(item, "contains")).toBe(false);
  });

  test("matches not_relevant children", () => {
    const item = makeItem("test" as ID, "not_relevant");
    expect(nodeMatchesType(item, "not_relevant")).toBe(true);
    expect(nodeMatchesType(item, "contains")).toBe(false);
  });

  test("contains filter only matches children with undefined relevance AND undefined argument", () => {
    const itemWithArg = makeItem("test" as ID, undefined, "confirms");
    expect(nodeMatchesType(itemWithArg, "contains")).toBe(false);

    const itemWithoutArg = makeItem("test" as ID, undefined);
    expect(nodeMatchesType(itemWithoutArg, "contains")).toBe(true);
  });

  test("matches argument types correctly", () => {
    const confirmItem = makeItem("test" as ID, undefined, "confirms");
    const contraItem = makeItem("test" as ID, undefined, "contra");

    expect(nodeMatchesType(confirmItem, "confirms")).toBe(true);
    expect(nodeMatchesType(confirmItem, "contra")).toBe(false);
    expect(nodeMatchesType(contraItem, "contra")).toBe(true);
    expect(nodeMatchesType(contraItem, "confirms")).toBe(false);
  });
});

// Integration tests for RelevanceSelector component
describe("RelevanceSelector", () => {
  test("shows relevance selector for child children", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "My Notes{Enter}{Tab}Parent{Enter}{Tab}Child1{Enter}Child2{Escape}"
    );

    await expectTree(`
My Notes
  Parent
    Child1
    Child2
    `);

    // Both children should have relevance selectors
    const relevanceButtons = screen.getAllByLabelText(
      /mark .* as not relevant/
    );
    expect(relevanceButtons.length).toBeGreaterThanOrEqual(2);
  });

  test("accepting incoming ref as relevant makes it bidirectional, filter toggle preserves it", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await setupLocalIncomingRefOnMoney();
    await selectIncomingRefRow();

    await userEvent.click(
      await screen.findByLabelText(/accept Bitcoin ! <<< Crypto as relevant/)
    );

    await expectTree(`
Money
  Bitcoin
    [R] Crypto <<< >>> ! Bitcoin
    `);

    await userEvent.click(screen.getByLabelText("toggle Relevant filter"));

    await expectTree(`
Money
  Bitcoin
    `);

    await userEvent.click(screen.getByLabelText("toggle Relevant filter"));

    await expectTree(`
Money
  Bitcoin
    [R] Crypto <<< >>> ! Bitcoin
    `);
  });

  test("accepting incoming ref as maybe relevant makes it bidirectional, filter toggle preserves it", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await setupLocalIncomingRefOnMoney();
    await selectIncomingRefRow();

    await userEvent.click(
      await screen.findByLabelText(
        /accept Bitcoin ! <<< Crypto as maybe relevant/
      )
    );

    await expectTree(`
Money
  Bitcoin
    [R] Crypto <<< >>> ! Bitcoin
    `);

    await userEvent.click(
      screen.getByLabelText("toggle Maybe Relevant filter")
    );

    await expectTree(`
Money
  Bitcoin
    `);

    await userEvent.click(
      screen.getByLabelText("toggle Maybe Relevant filter")
    );

    await expectTree(`
Money
  Bitcoin
    [R] Crypto <<< >>> ! Bitcoin
    `);
  });

  test("accepting incoming ref as little relevant makes it bidirectional, filter toggle preserves it", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await setupLocalIncomingRefOnMoney();
    await userEvent.click(
      screen.getByLabelText("toggle Little Relevant filter")
    );
    await selectIncomingRefRow();

    await userEvent.click(
      await screen.findByLabelText(
        /accept Bitcoin ! <<< Crypto as little relevant/
      )
    );

    await expectTree(`
Money
  Bitcoin
    [R] Crypto <<< >>> ! Bitcoin
    `);

    await userEvent.click(
      screen.getByLabelText("toggle Little Relevant filter")
    );

    await expectTree(`
Money
  Bitcoin
    `);

    await userEvent.click(
      screen.getByLabelText("toggle Little Relevant filter")
    );

    await expectTree(`
Money
  Bitcoin
    [R] Crypto <<< >>> ! Bitcoin
    `);
  });

  test("declining incoming ref hides it, not relevant filter shows it struck through", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await setupLocalIncomingRefOnMoney();
    await selectIncomingRefRow();

    fireEvent.click(screen.getByLabelText(/decline Bitcoin ! <<< Crypto/));

    await expectTree(`
Money
  Bitcoin
    `);

    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));

    await expectTree(`
Money
  Bitcoin
    [R] Bitcoin ! <<< Crypto
    `);

    const referenceRow = screen.getByText(
      (content, element) =>
        // eslint-disable-next-line testing-library/no-node-access
        element?.closest('[data-testid="reference-row"]') !== null &&
        content.includes("Crypto")
    );
    // eslint-disable-next-line testing-library/no-node-access
    const styledSpan = referenceRow.closest(
      "span[style*='text-decoration']"
    ) as HTMLElement;
    expect(styledSpan?.style.textDecoration).toBe("line-through");

    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));

    await expectTree(`
Money
  Bitcoin
    `);
  });

  test("incoming ref with confirms argument shows indicator, filter toggle preserves it", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await setupLocalOutgoingRefOnCrypto("confirms");

    await expectTree(`
Crypto
  Bitcoin
    [R] Money / + Bitcoin
    Details
    `);

    await userEvent.click(screen.getByLabelText("toggle Relevant filter"));

    await expectTree(`
Crypto
  Bitcoin
    Details
    `);

    await userEvent.click(screen.getByLabelText("toggle Relevant filter"));

    await expectTree(`
Crypto
  Bitcoin
    [R] Money / + Bitcoin
    Details
    `);
  });

  test("incoming ref with contra argument shows indicator, filter toggle preserves it", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await setupLocalOutgoingRefOnCrypto("contra");

    await expectTree(`
Crypto
  Bitcoin
    [R] Money / - Bitcoin
    Details
    `);

    await userEvent.click(screen.getByLabelText("toggle Relevant filter"));

    await expectTree(`
Crypto
  Bitcoin
    Details
    `);

    await userEvent.click(screen.getByLabelText("toggle Relevant filter"));

    await expectTree(`
Crypto
  Bitcoin
    [R] Money / - Bitcoin
    Details
    `);
  });

  test("accepting incoming ref from other user as relevant makes it bidirectional", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderApp(alice());
    await type("Money{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");
    cleanup();

    await follow(bob, alice().user.publicKey);
    renderApp(bob());
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");
    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Money");
    await createAcceptedItemLevelRefOnCurrentPane("!");
    cleanup();

    await follow(alice, bob().user.publicKey);
    renderApp(alice());
    await selectIncomingRefRow();
    await userEvent.click(
      await screen.findByLabelText(/accept Bitcoin ! <<< Crypto as relevant/)
    );

    await expectTree(`
Money
  Bitcoin
    Details
    [OR] Crypto <<< >>> ! Bitcoin
    `);

    await userEvent.click(screen.getByLabelText("toggle Relevant filter"));

    await expectTree(`
Money
  Bitcoin
    Details
    `);

    await userEvent.click(screen.getByLabelText("toggle Relevant filter"));

    await expectTree(`
Money
  Bitcoin
    Details
    [OR] Crypto <<< >>> ! Bitcoin
    `);
  });

  test("accepting incoming ref suppresses duplicates from other users with same context", async () => {
    const [alice, bob, carol] = setup([ALICE, BOB, CAROL]);

    renderApp(alice());
    await type("Money{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");
    cleanup();

    await follow(bob, alice().user.publicKey);
    renderApp(bob());
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");
    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Money");
    await createAcceptedItemLevelRefOnCurrentPane("!");
    cleanup();

    await follow(carol, alice().user.publicKey);
    renderApp(carol());
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Stuff{Escape}");
    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Money");
    await createAcceptedItemLevelRefOnCurrentPane("!");
    cleanup();

    await follow(alice, bob().user.publicKey);
    await follow(alice, carol().user.publicKey);
    renderApp(alice());
    await selectIncomingRefRow();
    await userEvent.click(
      await screen.findByLabelText(/accept Bitcoin ! <<< Crypto as relevant/)
    );

    await expectTree(`
Money
  Bitcoin
    Details
    [OR] Crypto <<< >>> ! Bitcoin
    `);
  });

  test("clicking X marks item as not relevant and hides it", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "My Notes{Enter}{Tab}Parent{Enter}{Tab}Child1{Enter}Child2{Escape}"
    );

    await screen.findByText("Child1");
    await screen.findByText("Child2");

    // Click the X button to mark Child1 as not relevant
    fireEvent.click(screen.getByLabelText("mark Child1 as not relevant"));

    // Child1 should be hidden (not_relevant filter is OFF by default)
    await waitFor(() => {
      expect(screen.queryByText("Child1")).toBeNull();
    });

    // Child2 should still be visible
    expect(screen.getByText("Child2")).toBeDefined();
  });

  test("item with default relevance shows Contains", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}Parent{Enter}{Tab}Child{Escape}");

    await screen.findByText("Child");

    // Default relevance is undefined (contains), shown with Contains title
    const selectors = screen.queryAllByTitle("Contains");
    expect(selectors.length).toBeGreaterThanOrEqual(1);
  });

  test("clicking current relevance level toggles it back to contains", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}Parent{Enter}{Tab}Child{Escape}");

    await screen.findByText("Child");

    fireEvent.click(screen.getByLabelText("set Child to relevant"));

    await waitFor(() => {
      const selectors = screen.queryAllByTitle("Relevant");
      expect(selectors.length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.click(screen.getByLabelText("set Child to relevant"));

    await waitFor(() => {
      const selectors = screen.queryAllByTitle("Contains");
      expect(selectors.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// Tests for relevance filtering
describe("Relevance filtering", () => {
  test("default filters show maybe relevant children", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}Parent{Enter}{Tab}Visible Item{Escape}");

    // Item should be visible (default relevance "" is included in default filters)
    await screen.findByText("Visible Item");
  });

  test("marking children as not relevant hides them", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "My Notes{Enter}{Tab}Parent{Enter}{Tab}Child1{Enter}Child2{Enter}Child3{Escape}"
    );

    await screen.findByText("Child1");
    await screen.findByText("Child2");
    await screen.findByText("Child3");

    // Mark Child1 as not relevant - it should be hidden
    fireEvent.click(screen.getByLabelText("mark Child1 as not relevant"));
    await waitFor(() => {
      expect(screen.queryByText("Child1")).toBeNull();
    });

    // Mark Child2 as not relevant - it should be hidden
    fireEvent.click(screen.getByLabelText("mark Child2 as not relevant"));
    await waitFor(() => {
      expect(screen.queryByText("Child2")).toBeNull();
    });

    // Only Child3 should still be visible
    expect(screen.getByText("Child3")).toBeDefined();
  });

  test("children default to maybe relevant and are visible", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}Parent{Enter}{Tab}Child{Escape}");

    // Child should be visible (default relevance is undefined/contains which is included in default filters)
    await screen.findByText("Child");

    // Relevance selector should show "Contains" title (default)
    const selectors = screen.queryAllByTitle("Contains");
    expect(selectors.length).toBeGreaterThanOrEqual(1);
  });
});

// Tests for diff item relevance selection
describe("Diff item relevance selection", () => {
  test("diff item shows RelevanceSelector with no dots selected", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await createForkedMyNotesNodeVersion(
      alice,
      bob,
      "My Notes{Enter}{Tab}Parent{Enter}{Tab}Alice Child{Escape}",
      "Parent",
      "Bob Child{Escape}"
    );

    renderTree(alice);

    // Navigate to Parent
    await navigateToNodeViaSearch(0, "Parent");

    await screen.findByText("Alice Child");

    // Bob's child should appear as a diff item
    await screen.findByText("Bob Child");

    await screen.findByLabelText("Set relevance for Bob Child");
  });

  test("clicking dot on diff item accepts it with that relevance", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await createForkedMyNotesNodeVersion(
      alice,
      bob,
      "My Notes{Enter}{Tab}Parent{Enter}{Tab}Alice Child{Escape}",
      "Parent",
      "Bob Child{Escape}"
    );

    renderTree(alice);

    // Navigate to Parent
    await navigateToNodeViaSearch(0, "Parent");

    await screen.findByText("Bob Child");

    // Accept the diff item as "relevant" by clicking the third dot
    const acceptButton = screen.getByLabelText("accept Bob Child as relevant");
    fireEvent.click(acceptButton);

    // After accepting, it should no longer be a diff item
    // It should now show "Relevant" title (indicating it's now in Alice's list)
    await waitFor(() => {
      const selectors = screen.queryAllByTitle("Relevant");
      expect(selectors.length).toBeGreaterThanOrEqual(1);
    });
  });

  test("clicking X on diff item declines it as not relevant", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await createForkedMyNotesNodeVersion(
      alice,
      bob,
      "My Notes{Enter}{Tab}Parent{Enter}{Tab}Alice Child{Escape}",
      "Parent",
      "Bob Child{Escape}"
    );

    renderTree(alice);

    // Navigate to Parent
    await navigateToNodeViaSearch(0, "Parent");

    await screen.findByText("Bob Child");

    // Decline the diff item by clicking X
    const declineButton = screen.getByLabelText("decline Bob Child");
    fireEvent.click(declineButton);

    // After declining, it should disappear (default filters exclude not_relevant)
    await waitFor(() => {
      expect(screen.queryByText("Bob Child")).toBeNull();
    });
  });
});

describe("X toggle (not_relevant)", () => {
  test("not relevant item shows 'mark as contains' aria-label", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}Parent{Enter}{Tab}Child{Escape}");

    await screen.findByText("Child");

    fireEvent.click(screen.getByLabelText("mark Child as not relevant"));
    await waitFor(() => {
      expect(screen.queryByText("Child")).toBeNull();
    });

    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));

    await screen.findByText("Child");

    const toggleBtn = screen.getByLabelText("mark Child as contains");
    expect(toggleBtn).toBeDefined();
  });

  test("clicking X on not relevant item toggles it back to contains", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "My Notes{Enter}{Tab}Parent{Enter}{Tab}Child1{Enter}Child2{Escape}"
    );

    await screen.findByText("Child1");

    fireEvent.click(screen.getByLabelText("mark Child1 as not relevant"));
    await waitFor(() => {
      expect(screen.queryByText("Child1")).toBeNull();
    });

    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));
    await screen.findByText("Child1");

    fireEvent.click(screen.getByLabelText("mark Child1 as contains"));

    await waitFor(() => {
      expect(screen.queryByLabelText("mark Child1 as contains")).toBeNull();
    });

    await screen.findByLabelText("mark Child1 as not relevant");
  });
});

describe("Node lookup consistency (regression)", () => {
  test("setting relevance to little_relevant hides item", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}Parent{Enter}{Tab}Child{Escape}");

    await screen.findByText("Child");

    // Click the first dot to set relevance to "little_relevant"
    const firstDot = screen.getByLabelText("set Child to little relevant");
    fireEvent.click(firstDot);

    // Item should be hidden (little_relevant filter is OFF by default)
    await waitFor(() => {
      expect(screen.queryByText("Child")).toBeNull();
    });

    // Enable little_relevant filter to verify the item still exists
    await userEvent.click(
      screen.getByLabelText("toggle Little Relevant filter")
    );

    // Child should reappear
    await screen.findByText("Child");

    // And it should show the correct relevance (1 dot = little relevant)
    const selectors = screen.queryAllByTitle("Little Relevant");
    expect(selectors.length).toBeGreaterThanOrEqual(1);
  });

  test("setting relevance persists correctly for one of two duplicate children", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);
    await type(
      "My Notes{Enter}{Tab}Parent{Enter}{Tab}Child{Enter}Child{Escape}"
    );

    const childElements = await screen.findAllByText("Child");
    expect(childElements.length).toBe(2);

    const markNotRelevantBtns = screen.getAllByLabelText(
      /mark Child as not relevant/
    );
    fireEvent.click(markNotRelevantBtns[0]);

    // Only ONE Child should disappear (not_relevant filter is OFF by default)
    await waitFor(() => {
      const remaining = screen.getAllByText("Child");
      expect(remaining.length).toBe(1);
    });
  });
});

// Tests for multi-user relevance scenarios
describe("Multi-user relevance", () => {
  test("each user can set different relevance for same item", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    const { publicKey: bobPK } = bob().user;
    renderTree(alice);
    await type("My Notes{Enter}{Tab}Parent{Enter}{Tab}Child{Escape}");

    cleanup();

    renderTree(bob);
    await type("My Notes{Enter}{Tab}Parent{Enter}{Tab}Child{Escape}");
    fireEvent.click(screen.getByLabelText("mark Child as not relevant"));
    cleanup();

    // Alice follows Bob
    await follow(alice, bobPK);

    renderTree(alice);

    // Child should be visible because Alice's relevance is "" (relevant)
    await screen.findByText("Child");
  });
});

describe("Accepting suggestions via RelevanceSelector", () => {
  test("accepting with level 3 sets relevance to relevant", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await createForkedMyNotesVersion(
      alice,
      bob,
      "My Notes{Escape}",
      "BobItem{Escape}"
    );

    renderTree(alice);

    await expectTree(`
My Notes
  [S] BobItem
    `);

    fireEvent.click(screen.getByLabelText("accept BobItem as relevant"));

    await expectTree(`
My Notes
  BobItem
    `);

    await screen.findByLabelText("set BobItem to relevant");
  });

  test("accepting with level 2 sets relevance to maybe relevant", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await createForkedMyNotesVersion(
      alice,
      bob,
      "My Notes{Escape}",
      "BobItem{Escape}"
    );

    renderTree(alice);

    await expectTree(`
My Notes
  [S] BobItem
    `);

    fireEvent.click(screen.getByLabelText("accept BobItem as maybe relevant"));

    await expectTree(`
My Notes
  BobItem
    `);

    await screen.findByLabelText("set BobItem to maybe relevant");
  });

  test("accepting with level 1 sets relevance to little relevant", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await createForkedMyNotesVersion(
      alice,
      bob,
      "My Notes{Escape}",
      "BobItem{Escape}"
    );

    renderTree(alice);

    await userEvent.click(
      screen.getByLabelText("toggle Little Relevant filter")
    );

    await expectTree(`
My Notes
  [S] BobItem
    `);

    fireEvent.click(screen.getByLabelText("accept BobItem as little relevant"));

    await expectTree(`
My Notes
  BobItem
    `);

    await screen.findByLabelText("set BobItem to little relevant");
  });

  test("declining suggestion sets relevance to not_relevant", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await createForkedMyNotesVersion(
      alice,
      bob,
      "My Notes{Escape}",
      "BobItem{Escape}"
    );

    renderTree(alice);

    await expectTree(`
My Notes
  [S] BobItem
    `);

    fireEvent.click(screen.getByLabelText("decline BobItem"));

    await expectTree(`
My Notes
  [VO] +1
    `);

    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));

    await expectTree(`
My Notes
  BobItem
  [VO] +1
    `);

    await screen.findByLabelText("mark BobItem as contains");
  });

  test("accepted item is no longer a suggestion", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await createForkedMyNotesVersion(
      alice,
      bob,
      "My Notes{Escape}",
      "BobItem{Escape}"
    );

    renderTree(alice);

    await expectTree(`
My Notes
  [S] BobItem
    `);

    fireEvent.click(screen.getByLabelText("accept BobItem as relevant"));

    await screen.findByLabelText("set BobItem to relevant");

    await expectTree(`
My Notes
  BobItem
    `);
  });

  test("cref suggestion resolves correctly with relevance", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await createForkedMyNotesVersion(
      alice,
      bob,
      "My Notes{Escape}",
      "BobFolder{Enter}{Tab}BobChild{Escape}"
    );

    renderTree(alice);

    await expectTree(`
My Notes
  [S] BobFolder
    `);

    fireEvent.click(
      screen.getByLabelText("accept BobFolder as little relevant")
    );

    await userEvent.click(
      screen.getByLabelText("toggle Little Relevant filter")
    );

    await expectTree(`
My Notes
  BobFolder
    `);

    await screen.findByLabelText("set BobFolder to little relevant");

    await userEvent.click(await screen.findByLabelText("expand BobFolder"));

    await expectTree(`
My Notes
  BobFolder
    BobChild
    `);

    expect(screen.getByText("BobFolder").textContent).toBe("BobFolder");
  });
});
