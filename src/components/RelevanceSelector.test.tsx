import { List } from "immutable";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  CAROL,
  expectTree,
  findNewNodeEditor,
  follow,
  navigateToNodeViaSearch,
  renderApp,
  renderTree,
  setup,
  type,
} from "../utils.test";
import {
  newNode,
  addRelationToRelations,
  itemMatchesType,
} from "../connections";
import { createPlan, planUpsertNode, planUpsertRelations } from "../planner";
import { execute } from "../executor";
import { newRelations } from "../ViewContext";
import {
  relevanceToLevel,
  levelToRelevance,
  RELEVANCE_LABELS,
} from "./useUpdateRelevance";

// Unit tests for helper functions
describe("relevanceToLevel", () => {
  test("maps relevant to level 3", () => {
    expect(relevanceToLevel("relevant")).toBe(3);
  });

  test("maps maybe_relevant to level 2", () => {
    expect(relevanceToLevel("maybe_relevant")).toBe(2);
  });

  test("maps undefined (contains) to level -1", () => {
    expect(relevanceToLevel(undefined)).toBe(-1);
  });

  test("maps little_relevant to level 1", () => {
    expect(relevanceToLevel("little_relevant")).toBe(1);
  });

  test("maps not_relevant to level 0", () => {
    expect(relevanceToLevel("not_relevant")).toBe(0);
  });

  test("defaults to level -1 for unknown values", () => {
    expect(relevanceToLevel("unknown" as Relevance)).toBe(-1);
  });
});

describe("levelToRelevance", () => {
  test("maps level 3 to relevant", () => {
    expect(levelToRelevance(3)).toBe("relevant");
  });

  test("maps level 2 to maybe_relevant", () => {
    expect(levelToRelevance(2)).toBe("maybe_relevant");
  });

  test("maps level 1 to little_relevant", () => {
    expect(levelToRelevance(1)).toBe("little_relevant");
  });

  test("maps level 0 to not_relevant", () => {
    expect(levelToRelevance(0)).toBe("not_relevant");
  });

  test("defaults to undefined for unknown levels", () => {
    expect(levelToRelevance(5)).toBe(undefined);
    expect(levelToRelevance(-1)).toBe(undefined);
    expect(levelToRelevance(4)).toBe(undefined);
  });
});

describe("RELEVANCE_LABELS", () => {
  test("has correct labels for all levels", () => {
    expect(RELEVANCE_LABELS[-1]).toBe("Contains");
    expect(RELEVANCE_LABELS[0]).toBe("Not Relevant");
    expect(RELEVANCE_LABELS[1]).toBe("Little Relevant");
    expect(RELEVANCE_LABELS[2]).toBe("Maybe Relevant");
    expect(RELEVANCE_LABELS[3]).toBe("Relevant");
  });
});

describe("itemMatchesType", () => {
  test("matches relevant items", () => {
    const item: RelationItem = { nodeID: "test" as ID, relevance: "relevant" };
    expect(itemMatchesType(item, "relevant")).toBe(true);
    expect(itemMatchesType(item, "contains")).toBe(false);
  });

  test("matches maybe_relevant items", () => {
    const item: RelationItem = {
      nodeID: "test" as ID,
      relevance: "maybe_relevant",
    };
    expect(itemMatchesType(item, "maybe_relevant")).toBe(true);
    expect(itemMatchesType(item, "relevant")).toBe(false);
  });

  test("matches contains items with undefined relevance", () => {
    const item: RelationItem = { nodeID: "test" as ID, relevance: undefined };
    expect(itemMatchesType(item, "contains")).toBe(true);
    expect(itemMatchesType(item, "relevant")).toBe(false);
  });

  test("matches little_relevant items", () => {
    const item: RelationItem = {
      nodeID: "test" as ID,
      relevance: "little_relevant",
    };
    expect(itemMatchesType(item, "little_relevant")).toBe(true);
    expect(itemMatchesType(item, "contains")).toBe(false);
  });

  test("matches not_relevant items", () => {
    const item: RelationItem = {
      nodeID: "test" as ID,
      relevance: "not_relevant",
    };
    expect(itemMatchesType(item, "not_relevant")).toBe(true);
    expect(itemMatchesType(item, "contains")).toBe(false);
  });

  test("contains filter only matches items with undefined relevance AND undefined argument", () => {
    const itemWithArg: RelationItem = {
      nodeID: "test" as ID,
      relevance: undefined,
      argument: "confirms",
    };
    expect(itemMatchesType(itemWithArg, "contains")).toBe(false);

    const itemWithoutArg: RelationItem = {
      nodeID: "test" as ID,
      relevance: undefined,
    };
    expect(itemMatchesType(itemWithoutArg, "contains")).toBe(true);
  });

  test("matches argument types correctly", () => {
    const confirmItem: RelationItem = {
      nodeID: "test" as ID,
      relevance: undefined,
      argument: "confirms",
    };
    const contraItem: RelationItem = {
      nodeID: "test" as ID,
      relevance: undefined,
      argument: "contra",
    };

    expect(itemMatchesType(confirmItem, "confirms")).toBe(true);
    expect(itemMatchesType(confirmItem, "contra")).toBe(false);
    expect(itemMatchesType(contraItem, "contra")).toBe(true);
    expect(itemMatchesType(contraItem, "confirms")).toBe(false);
  });
});

// Integration tests for RelevanceSelector component
describe("RelevanceSelector", () => {
  test("shows relevance selector for child items", async () => {
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
    renderTree(alice);

    await type("Money{Enter}{Tab}Bitcoin{Escape}");
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [I] Bitcoin  <<< Money
    `);

    await userEvent.click(
      await screen.findByLabelText(/accept .* <<< Money as relevant/)
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
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
    Details
    [R] Money <<< >>> Bitcoin
    `);
  });

  test("accepting incoming ref as maybe relevant makes it bidirectional, filter toggle preserves it", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("Money{Enter}{Tab}Bitcoin{Escape}");
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [I] Bitcoin  <<< Money
    `);

    await userEvent.click(
      await screen.findByLabelText(/accept .* <<< Money as maybe relevant/)
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);

    await userEvent.click(
      screen.getByLabelText("toggle Maybe Relevant filter")
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    `);

    await userEvent.click(
      screen.getByLabelText("toggle Maybe Relevant filter")
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);
  });

  test("accepting incoming ref as little relevant makes it bidirectional, filter toggle preserves it", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("Money{Enter}{Tab}Bitcoin{Escape}");
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

    await userEvent.click(
      screen.getByLabelText("toggle Little Relevant filter")
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [I] Bitcoin  <<< Money
    `);

    await userEvent.click(
      await screen.findByLabelText(/accept .* <<< Money as little relevant/)
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);

    await userEvent.click(
      screen.getByLabelText("toggle Little Relevant filter")
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    `);

    await userEvent.click(
      screen.getByLabelText("toggle Little Relevant filter")
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);
  });

  test("declining incoming ref hides it, not relevant filter shows it struck through", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("Money{Enter}{Tab}Bitcoin{Escape}");
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [I] Bitcoin  <<< Money
    `);

    fireEvent.click(screen.getByLabelText(/decline .* <<< Money/));

    await expectTree(`
Crypto
  Bitcoin
    Details
    `);

    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> Bitcoin
    `);

    const refNode = screen.getByText(
      (content, element) =>
        // eslint-disable-next-line testing-library/no-node-access
        element?.closest('[data-testid="reference-node"]') !== null &&
        content.includes("Money")
    );
    // eslint-disable-next-line testing-library/no-node-access
    const styledSpan = refNode.closest(
      "span[style*='text-decoration']"
    ) as HTMLElement;
    expect(styledSpan?.style.textDecoration).toBe("line-through");

    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));

    await expectTree(`
Crypto
  Bitcoin
    Details
    `);
  });

  test("accepting incoming ref with confirms argument shows indicator, filter toggle preserves it", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("Money{Enter}{Tab}Bitcoin{Escape}");

    await userEvent.click(
      screen.getByLabelText("Evidence for Bitcoin: No evidence type")
    );

    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [I] Bitcoin + <<< Money
    `);

    await userEvent.click(
      await screen.findByLabelText(/accept .* <<< Money as relevant/)
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> + Bitcoin
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
    Details
    [R] Money <<< >>> + Bitcoin
    `);
  });

  test("accepting incoming ref with contra argument shows indicator, filter toggle preserves it", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("Money{Enter}{Tab}Bitcoin{Escape}");

    const evidenceBtn = screen.getByLabelText(
      "Evidence for Bitcoin: No evidence type"
    );
    await userEvent.click(evidenceBtn);
    await userEvent.click(
      screen.getByLabelText("Evidence for Bitcoin: Confirms")
    );

    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [I] Bitcoin - <<< Money
    `);

    await userEvent.click(
      await screen.findByLabelText(/accept .* <<< Money as relevant/)
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [R] Money <<< >>> - Bitcoin
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
    Details
    [R] Money <<< >>> - Bitcoin
    `);
  });

  test("accepting incoming ref from other user as relevant makes it bidirectional", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(bob);
    await type("Money{Enter}{Tab}Bitcoin{Escape}");
    cleanup();

    await follow(alice, bob().user.publicKey);
    renderTree(alice);
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [OI] Bitcoin  <<< Money
    `);

    await userEvent.click(
      await screen.findByLabelText(/accept .* <<< Money as relevant/)
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [OR] Money <<< >>> Bitcoin
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
    Details
    [OR] Money <<< >>> Bitcoin
    `);
  });

  test("accepting incoming ref suppresses duplicates from other users with same context", async () => {
    const [alice, bob, carol] = setup([ALICE, BOB, CAROL]);

    renderTree(bob);
    await type("Money{Enter}{Tab}Bitcoin{Escape}");
    cleanup();

    renderTree(carol);
    await type("Money{Enter}{Tab}Bitcoin{Escape}");
    cleanup();

    await follow(alice, bob().user.publicKey);
    await follow(alice, carol().user.publicKey);
    renderTree(alice);
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [OI] Bitcoin  <<< Money
    `);

    await userEvent.click(
      await screen.findByLabelText(/accept .* <<< Money as relevant/)
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [OR] Money <<< >>> Bitcoin
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
  test("default filters show maybe relevant items", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}Parent{Enter}{Tab}Visible Item{Escape}");

    // Item should be visible (default relevance "" is included in default filters)
    await screen.findByText("Visible Item");
  });

  test("marking items as not relevant hides them", async () => {
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

  test("items default to maybe relevant and are visible", async () => {
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
    const { publicKey: alicePK } = alice().user;
    const { publicKey: bobPK } = bob().user;

    // Alice creates Parent
    const parent = newNode("Parent");
    const aliceChild = newNode("Alice Child");

    const aliceRelations = addRelationToRelations(
      newRelations(parent.id, List(), alicePK),
      aliceChild.id
    );

    const alicePlan = planUpsertRelations(
      planUpsertNode(planUpsertNode(createPlan(alice()), parent), aliceChild),
      aliceRelations
    );
    await execute({ ...alice(), plan: alicePlan });

    // Bob adds a different child to the same parent
    const bobChild = newNode("Bob Child");
    const bobRelations = addRelationToRelations(
      newRelations(parent.id, List(), bobPK),
      bobChild.id
    );

    const bobPlan = planUpsertRelations(
      planUpsertNode(createPlan(bob()), bobChild),
      bobRelations
    );
    await execute({ ...bob(), plan: bobPlan });

    // Alice follows Bob
    await follow(alice, bobPK);

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
    const { publicKey: alicePK } = alice().user;
    const { publicKey: bobPK } = bob().user;

    // Alice creates Parent with a child (needed for search to find it as a reference)
    const parent = newNode("Parent");
    const aliceChild = newNode("Alice Child");
    const aliceRelations = addRelationToRelations(
      newRelations(parent.id, List(), alicePK),
      aliceChild.id
    );

    const alicePlan = planUpsertRelations(
      planUpsertNode(planUpsertNode(createPlan(alice()), parent), aliceChild),
      aliceRelations
    );
    await execute({ ...alice(), plan: alicePlan });

    // Bob adds a child to the same parent
    const bobChild = newNode("Bob Child");
    const bobRelations = addRelationToRelations(
      newRelations(parent.id, List(), bobPK),
      bobChild.id
    );

    const bobPlan = planUpsertRelations(
      planUpsertNode(createPlan(bob()), bobChild),
      bobRelations
    );
    await execute({ ...bob(), plan: bobPlan });

    // Alice follows Bob
    await follow(alice, bobPK);

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
    const { publicKey: alicePK } = alice().user;
    const { publicKey: bobPK } = bob().user;

    // Alice creates Parent with a child (needed for search to find it as a reference)
    const parent = newNode("Parent");
    const aliceChild = newNode("Alice Child");
    const aliceRelations = addRelationToRelations(
      newRelations(parent.id, List(), alicePK),
      aliceChild.id
    );

    const alicePlan = planUpsertRelations(
      planUpsertNode(planUpsertNode(createPlan(alice()), parent), aliceChild),
      aliceRelations
    );
    await execute({ ...alice(), plan: alicePlan });

    // Bob adds a child
    const bobChild = newNode("Bob Child");
    const bobRelations = addRelationToRelations(
      newRelations(parent.id, List(), bobPK),
      bobChild.id
    );

    const bobPlan = planUpsertRelations(
      planUpsertNode(createPlan(bob()), bobChild),
      bobRelations
    );
    await execute({ ...bob(), plan: bobPlan });

    // Alice follows Bob
    await follow(alice, bobPK);

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

// Tests for removing items from list
describe("Remove from list", () => {
  test("not relevant item shows 'remove from list' aria-label", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}Parent{Enter}{Tab}Child{Escape}");

    await screen.findByText("Child");

    // Mark as not relevant - child gets hidden
    fireEvent.click(screen.getByLabelText("mark Child as not relevant"));
    await waitFor(() => {
      expect(screen.queryByText("Child")).toBeNull();
    });

    // Enable not_relevant filter to see the child
    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));

    // Child should now be visible
    await screen.findByText("Child");

    // The X button should now say "remove from list" instead of "mark as not relevant"
    const removeBtn = screen.getByLabelText("remove Child from list");
    expect(removeBtn).toBeDefined();
  });

  test("clicking X on not relevant item removes it completely from list", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "My Notes{Enter}{Tab}Parent{Enter}{Tab}Child1{Enter}Child2{Escape}"
    );

    await screen.findByText("Child1");
    await screen.findByText("Child2");

    // Mark Child1 as not relevant - it gets hidden
    fireEvent.click(screen.getByLabelText("mark Child1 as not relevant"));
    await waitFor(() => {
      expect(screen.queryByText("Child1")).toBeNull();
    });

    // Enable not_relevant filter to see Child1
    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));
    await screen.findByText("Child1");

    // Click the remove button to completely remove Child1
    fireEvent.click(screen.getByLabelText("remove Child1 from list"));

    // Child1 should disappear completely
    await waitFor(() => {
      expect(screen.queryByText("Child1")).toBeNull();
    });

    // Child2 should still be visible
    expect(screen.getByText("Child2")).toBeDefined();
  });

  test("two-step deletion: first mark as not relevant, then remove", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}Parent{Enter}{Tab}Child{Escape}");

    await screen.findByText("Child");

    // Step 1: Mark as not relevant - child gets hidden
    fireEvent.click(screen.getByLabelText("mark Child as not relevant"));
    await waitFor(() => {
      expect(screen.queryByText("Child")).toBeNull();
    });

    // Enable not_relevant filter to see the child again
    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));
    await screen.findByText("Child");

    // Now the X button should say "remove from list"
    const removeBtn = await screen.findByLabelText("remove Child from list");
    expect(removeBtn).toBeDefined();

    // Step 2: Remove from list completely
    fireEvent.click(removeBtn);

    // Child should be completely gone
    await waitFor(() => {
      expect(screen.queryByText("Child")).toBeNull();
    });

    // Even with not_relevant filter enabled, Child should not reappear
    expect(screen.queryByText("Child")).toBeNull();
  });

  test("remove from list cleans up orphaned descendant relations", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type(
      "Root{Enter}{Tab}Parent{Enter}{Tab}Child{Enter}{Tab}GrandChild{Escape}"
    );

    await expectTree(`
Root
  Parent
    Child
      GrandChild
    `);

    const splitPaneButtons = screen.getAllByLabelText("open in split pane");
    await userEvent.click(splitPaneButtons[0]);
    await navigateToNodeViaSearch(1, "Child");

    await expectTree(`
Root
  Parent
    Child
      GrandChild
Child
  GrandChild
    `);

    fireEvent.click(screen.getAllByLabelText("mark Child as not relevant")[0]);
    await waitFor(() => {
      expect(screen.queryAllByRole("treeitem", { name: "Child" })).toHaveLength(
        1
      );
    });

    const notRelevantFilters = screen.getAllByLabelText(
      "toggle Not Relevant filter"
    );
    await userEvent.click(notRelevantFilters[0]);
    await screen.findByLabelText("remove Child from list");

    fireEvent.click(screen.getByLabelText("remove Child from list"));

    await waitFor(() => {
      expect(screen.queryByLabelText("remove Child from list")).toBeNull();
    });

    await userEvent.click(
      screen.getAllByLabelText("toggle Not Relevant filter")[0]
    );

    await expectTree(`
Root
  Parent
Child
    `);
  });

  test("removing ~Versions from list does not delete orphaned descendant relations", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}Barcelona{Escape}");

    const barcelonaEditor = await screen.findByLabelText("edit Barcelona");
    await userEvent.click(barcelonaEditor);
    await userEvent.clear(barcelonaEditor);
    await userEvent.type(barcelonaEditor, "BCN");
    fireEvent.blur(barcelonaEditor, { relatedTarget: document.body });

    await expectTree(`
My Notes
  BCN
    `);

    await userEvent.click(await screen.findByLabelText("edit BCN"));
    await userEvent.keyboard("{Enter}");
    const newEditor = await findNewNodeEditor();
    await userEvent.type(newEditor, "~Versions");
    await userEvent.click(newEditor);
    await userEvent.keyboard("{Home}{Tab}");

    await expectTree(`
My Notes
  BCN
    ~Versions
    `);

    await userEvent.click(await screen.findByLabelText("expand ~Versions"));

    await expectTree(`
My Notes
  BCN
    ~Versions
      BCN
      Barcelona
    `);

    fireEvent.click(screen.getByLabelText("mark ~Versions as not relevant"));
    await waitFor(() => {
      expect(screen.queryByText("~Versions")).toBeNull();
    });

    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));
    await screen.findByText("~Versions");

    fireEvent.click(screen.getByLabelText("remove ~Versions from list"));

    await waitFor(() => {
      expect(screen.queryByText("~Versions")).toBeNull();
    });

    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));

    await expectTree(`
My Notes
  BCN
    `);

    const bcnEditor = await screen.findByLabelText("edit BCN");
    await userEvent.click(bcnEditor);
    await userEvent.clear(bcnEditor);
    await userEvent.type(bcnEditor, "Barcelona");
    fireEvent.blur(bcnEditor, { relatedTarget: document.body });

    await expectTree(`
My Notes
  Barcelona
    `);
  });
});

describe("Relation lookup consistency (regression)", () => {
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

  test("setting relevance persists correctly on item accessed via nodeIndex", async () => {
    const [alice] = setup([ALICE]);
    const { publicKey: alicePK } = alice().user;

    const parent = newNode("Parent");
    const child = newNode("Child");

    const relations = addRelationToRelations(
      addRelationToRelations(
        newRelations(parent.id, List(), alicePK),
        child.id,
        undefined
      ),
      child.id,
      undefined
    );

    const plan = planUpsertRelations(
      planUpsertNode(planUpsertNode(createPlan(alice()), parent), child),
      relations
    );
    await execute({ ...alice(), plan });

    renderTree(alice);

    await navigateToNodeViaSearch(0, "Parent");

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
    const { publicKey: alicePK } = alice().user;
    const { publicKey: bobPK } = bob().user;

    // Alice creates Parent -> Child
    const parent = newNode("Parent");
    const child = newNode("Child");

    // Alice marks Child as relevant (default)
    const aliceRelations = addRelationToRelations(
      newRelations(parent.id, List(), alicePK),
      child.id,
      undefined // contains (default)
    );

    const alicePlan = planUpsertRelations(
      planUpsertNode(planUpsertNode(createPlan(alice()), parent), child),
      aliceRelations
    );
    await execute({ ...alice(), plan: alicePlan });

    // Bob marks the same Child as not_relevant in his version
    const bobRelations = addRelationToRelations(
      newRelations(parent.id, List(), bobPK),
      child.id,
      "not_relevant"
    );

    const bobPlan = planUpsertRelations(createPlan(bob()), bobRelations);
    await execute({ ...bob(), plan: bobPlan });

    // Alice follows Bob
    await follow(alice, bobPK);

    renderTree(alice);

    // Navigate to Parent
    await navigateToNodeViaSearch(0, "Parent");

    // Child should be visible because Alice's relevance is "" (relevant)
    await screen.findByText("Child");
  });
});

describe("Accepting suggestions via RelevanceSelector", () => {
  test("accepting with level 3 sets relevance to relevant", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(bob);
    await type("My Notes{Enter}{Tab}BobItem{Escape}");

    cleanup();

    await follow(alice, bob().user.publicKey);
    renderTree(alice);
    await type("My Notes{Escape}");

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

    renderTree(bob);
    await type("My Notes{Enter}{Tab}BobItem{Escape}");

    cleanup();

    await follow(alice, bob().user.publicKey);
    renderTree(alice);
    await type("My Notes{Escape}");

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

    renderTree(bob);
    await type("My Notes{Enter}{Tab}BobItem{Escape}");

    cleanup();

    await follow(alice, bob().user.publicKey);
    renderTree(alice);
    await type("My Notes{Escape}");

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

    renderTree(bob);
    await type("My Notes{Enter}{Tab}BobItem{Escape}");

    cleanup();

    await follow(alice, bob().user.publicKey);
    renderTree(alice);
    await type("My Notes{Escape}");

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

    await screen.findByLabelText("remove BobItem from list");
  });

  test("accepted item is no longer a suggestion", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(bob);
    await type("My Notes{Enter}{Tab}BobItem{Escape}");

    cleanup();

    await follow(alice, bob().user.publicKey);
    renderTree(alice);
    await type("My Notes{Escape}");

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

    renderTree(bob);
    await type("My Notes{Enter}{Tab}BobFolder{Enter}{Tab}BobChild{Escape}");

    cleanup();

    await follow(alice, bob().user.publicKey);
    renderTree(alice);
    await type("My Notes{Escape}");

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

describe("Occurrence relevance", () => {
  test("accepting occurrence as relevant, filter toggle preserves it", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(bob);
    await type("Bitcoin{Enter}{Tab}Price History{Escape}");
    cleanup();

    await follow(alice, bob().user.publicKey);
    renderTree(alice);
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [OC] Bitcoin
    `);

    await userEvent.click(
      await screen.findByLabelText(/accept Bitcoin as relevant/)
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [OR] Bitcoin
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
    Details
    [OR] Bitcoin
    `);
  });

  test("accepting occurrence as maybe relevant, filter toggle preserves it", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(bob);
    await type("Bitcoin{Enter}{Tab}Price History{Escape}");
    cleanup();

    await follow(alice, bob().user.publicKey);
    renderTree(alice);
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [OC] Bitcoin
    `);

    await userEvent.click(
      await screen.findByLabelText(/accept Bitcoin as maybe relevant/)
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [OR] Bitcoin
    `);

    await userEvent.click(
      screen.getByLabelText("toggle Maybe Relevant filter")
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    `);

    await userEvent.click(
      screen.getByLabelText("toggle Maybe Relevant filter")
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [OR] Bitcoin
    `);
  });

  test("accepting occurrence as little relevant, filter toggle preserves it", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(bob);
    await type("Bitcoin{Enter}{Tab}Price History{Escape}");
    cleanup();

    await follow(alice, bob().user.publicKey);
    renderTree(alice);
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

    await userEvent.click(
      screen.getByLabelText("toggle Little Relevant filter")
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [OC] Bitcoin
    `);

    await userEvent.click(
      await screen.findByLabelText(/accept Bitcoin as little relevant/)
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [OR] Bitcoin
    `);

    await userEvent.click(
      screen.getByLabelText("toggle Little Relevant filter")
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    `);

    await userEvent.click(
      screen.getByLabelText("toggle Little Relevant filter")
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [OR] Bitcoin
    `);
  });

  test("declining occurrence hides it, not relevant filter shows it struck through", async () => {
    const [alice, bob] = setup([ALICE, BOB]);

    renderTree(bob);
    await type("Bitcoin{Enter}{Tab}Price History{Escape}");
    cleanup();

    await follow(alice, bob().user.publicKey);
    renderTree(alice);
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [OC] Bitcoin
    `);

    fireEvent.click(screen.getByLabelText(/decline Bitcoin/));

    await expectTree(`
Crypto
  Bitcoin
    Details
    `);

    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));

    await expectTree(`
Crypto
  Bitcoin
    Details
    [OR] Bitcoin
    `);

    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));

    await expectTree(`
Crypto
  Bitcoin
    Details
    `);
  });

  test("accepting occurrence suppresses duplicates from other users", async () => {
    const [alice, bob, carol] = setup([ALICE, BOB, CAROL]);

    renderTree(bob);
    await type("Bitcoin{Enter}{Tab}Price History{Escape}");
    cleanup();

    renderTree(carol);
    await type("Bitcoin{Enter}{Tab}Mining{Escape}");
    cleanup();

    await follow(alice, bob().user.publicKey);
    await follow(alice, carol().user.publicKey);
    renderTree(alice);
    await type("Crypto{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

    await expectTree(`
Crypto
  Bitcoin
    Details
    [OC] Bitcoin
    `);

    await userEvent.click(
      await screen.findByLabelText(/accept Bitcoin as relevant/)
    );

    await expectTree(`
Crypto
  Bitcoin
    Details
    [OR] Bitcoin
    `);
  });
});
