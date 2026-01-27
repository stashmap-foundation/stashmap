import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  expectTree,
  findNewNodeEditor,
  renderTree,
  setup,
} from "../utils.test";
import { DEFAULT_TYPE_FILTERS, TYPE_COLORS } from "../constants";

describe("TYPE_COLORS", () => {
  test("has correct colors for relevance types", () => {
    expect(TYPE_COLORS.relevant).toBe("#0288d1");
    expect(TYPE_COLORS.maybe_relevant).toBe("#00acc1");
    expect(TYPE_COLORS.little_relevant).toBe("#26c6da");
    expect(TYPE_COLORS.not_relevant).toBe("#757575");
  });

  test("has correct colors for argument types", () => {
    expect(TYPE_COLORS.confirms).toBe("#2e7d32");
    expect(TYPE_COLORS.contra).toBe("#c62828");
  });

  test("has inactive color", () => {
    expect(TYPE_COLORS.inactive).toBe("#d0d0d0");
  });
});

describe("DEFAULT_TYPE_FILTERS", () => {
  test("includes relevant", () => {
    expect(DEFAULT_TYPE_FILTERS).toContain("relevant");
  });

  test("includes maybe_relevant (empty string)", () => {
    expect(DEFAULT_TYPE_FILTERS).toContain("");
  });

  test("includes confirms", () => {
    expect(DEFAULT_TYPE_FILTERS).toContain("confirms");
  });

  test("includes contra", () => {
    expect(DEFAULT_TYPE_FILTERS).toContain("contra");
  });

  test("excludes little_relevant by default", () => {
    expect(DEFAULT_TYPE_FILTERS).not.toContain("little_relevant");
  });

  test("excludes not_relevant by default", () => {
    expect(DEFAULT_TYPE_FILTERS).not.toContain("not_relevant");
  });
});

describe("TypeFilterButton", () => {
  test("shows filter button for nodes with children", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Parent with a child
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("add to My Notes"));
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("add to Parent"));
    await userEvent.type(await findNewNodeEditor(), "Child{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await expectTree(`
My Notes
  Parent
    Child
    `);

    // Filter button should exist for the parent node
    expect(screen.getByLabelText("filter Parent")).toBeDefined();
  });

  test("opens filter popover on click", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Parent with a child
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("add to My Notes"));
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("add to Parent"));
    await userEvent.type(await findNewNodeEditor(), "Child{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Click filter button for Parent
    fireEvent.click(screen.getByLabelText("filter Parent"));

    // Popover should show filter options
    await screen.findByText("Relevant");
    await screen.findByText("Maybe Relevant");
    await screen.findByText("Little Relevant");
    await screen.findByText("Not Relevant");
    await screen.findByText("Confirms");
    await screen.findByText("Contradicts");
  });

  test("toggling filter hides/shows items", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Parent with children
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("add to My Notes"));
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("add to Parent"));
    await userEvent.type(await findNewNodeEditor(), "Item One{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Item Two{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await screen.findByText("Item One");
    await screen.findByText("Item Two");

    // Open filter popover for Parent
    fireEvent.click(screen.getByLabelText("filter Parent"));
    await screen.findByText("Maybe Relevant");

    // Toggle off "Maybe Relevant" filter (default relevance for new items)
    fireEvent.click(screen.getByText("Maybe Relevant"));

    // Items should be hidden (they have default/maybe_relevant relevance)
    await waitFor(() => {
      expect(screen.queryByText("Item One")).toBeNull();
      expect(screen.queryByText("Item Two")).toBeNull();
    });
  });

  test("enabling not_relevant filter shows hidden items", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Parent with children
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("add to My Notes"));
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("add to Parent"));
    await userEvent.type(await findNewNodeEditor(), "Visible Item{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Hidden Item{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await screen.findByText("Visible Item");
    await screen.findByText("Hidden Item");

    // Mark "Hidden Item" as not relevant using RelevanceSelector
    fireEvent.click(screen.getByLabelText("mark Hidden Item as not relevant"));

    // Hidden Item should disappear (default filters exclude not_relevant)
    await waitFor(() => {
      expect(screen.queryByText("Hidden Item")).toBeNull();
    });

    // Visible Item should still be visible
    expect(screen.getByText("Visible Item")).toBeDefined();

    // Open filter popover for Parent and enable "Not Relevant"
    fireEvent.click(screen.getByLabelText("filter Parent"));
    await screen.findByText("Not Relevant");
    fireEvent.click(screen.getByText("Not Relevant"));

    // Hidden Item should now be visible
    await screen.findByText("Hidden Item");
  });

  test("does not show filter button in Referenced By mode", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create: My Notes -> Money -> Bitcoin
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("add to My Notes"));
    await userEvent.type(await findNewNodeEditor(), "Money{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Money"));
    await userEvent.click(await screen.findByLabelText("add to Money"));
    await userEvent.type(await findNewNodeEditor(), "Bitcoin{Escape}");

    // Navigate to Bitcoin as root
    await userEvent.click(
      await screen.findByLabelText("Search to change pane 0 content")
    );
    await userEvent.type(
      await screen.findByLabelText("search input"),
      "Bitcoin"
    );
    await userEvent.click(await screen.findByLabelText("select Bitcoin"));
    await screen.findByLabelText("expand Bitcoin");

    // Filter button should exist initially
    expect(screen.getByLabelText("filter Bitcoin")).toBeDefined();

    // Switch to Referenced By view
    fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
    await screen.findByLabelText("hide references to Bitcoin");

    // Filter button should NOT be visible in Referenced By mode
    expect(screen.queryByLabelText("filter Bitcoin")).toBeNull();
  });

  test("filter state persists across interactions", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Parent with a child
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("add to My Notes"));
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("add to Parent"));
    await userEvent.type(await findNewNodeEditor(), "Test Item{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await screen.findByText("Test Item");

    // Open filter popover and toggle off "Maybe Relevant"
    // Note: must use userEvent.click for popovers to work correctly
    await userEvent.click(screen.getByLabelText("filter Parent"));
    await screen.findByText("Maybe Relevant");
    await userEvent.click(screen.getByText("Maybe Relevant"));

    // Item should be hidden
    await waitFor(() => {
      expect(screen.queryByText("Test Item")).toBeNull();
    });

    // Close popover by clicking outside
    await userEvent.click(document.body);

    // Item should still be hidden (filter state persists)
    await waitFor(() => {
      expect(screen.queryByText("Test Item")).toBeNull();
    });

    // Reopen filter popover and re-enable "Maybe Relevant"
    await userEvent.click(screen.getByLabelText("filter Parent"));
    await userEvent.click(await screen.findByText("Maybe Relevant"));

    // Item should reappear
    await screen.findByText("Test Item");
  });
});

describe("Suggestions filter", () => {
  test("DEFAULT_TYPE_FILTERS includes suggestions", () => {
    expect(DEFAULT_TYPE_FILTERS).toContain("suggestions");
  });

  test("TYPE_COLORS has other_user color for suggestions", () => {
    expect(TYPE_COLORS.other_user).toBe("#d4826a");
  });

  test("filter popover shows Suggestions option", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Parent with a child
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("add to My Notes"));
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("add to Parent"));
    await userEvent.type(await findNewNodeEditor(), "Child{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Open filter popover for Parent
    fireEvent.click(screen.getByLabelText("filter Parent"));

    // Suggestions option should be visible
    await screen.findByText("Suggestions");
  });
});

describe("Filter integration with RelevanceSelector", () => {
  test("marking item as not_relevant hides it when filter excludes not_relevant", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Parent with children
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("add to My Notes"));
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("add to Parent"));
    await userEvent.type(await findNewNodeEditor(), "Child1{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Child2{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await screen.findByText("Child1");
    await screen.findByText("Child2");

    // Mark Child1 as not relevant using RelevanceSelector
    fireEvent.click(screen.getByLabelText("mark Child1 as not relevant"));

    // Child1 should disappear (default filters exclude not_relevant)
    await waitFor(() => {
      expect(screen.queryByText("Child1")).toBeNull();
    });

    // Enable not_relevant filter for Parent
    fireEvent.click(screen.getByLabelText("filter Parent"));
    await screen.findByText("Not Relevant");
    fireEvent.click(screen.getByText("Not Relevant"));

    // Child1 should reappear
    await screen.findByText("Child1");
  });

  test("relevance change reflects correctly", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Parent with a child
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("add to My Notes"));
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("add to Parent"));
    await userEvent.type(await findNewNodeEditor(), "Child{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await screen.findByText("Child");

    // Child should have Maybe Relevant title initially (default)
    // Use queryAllByTitle since Parent also has this title
    const maybeRelevantElements = screen.queryAllByTitle("Maybe Relevant");
    expect(maybeRelevantElements.length).toBeGreaterThanOrEqual(1);

    // Mark as not relevant
    fireEvent.click(screen.getByLabelText("mark Child as not relevant"));

    // Child disappears
    await waitFor(() => {
      expect(screen.queryByText("Child")).toBeNull();
    });

    // Enable not_relevant filter to see the child again
    fireEvent.click(screen.getByLabelText("filter Parent"));
    fireEvent.click(await screen.findByText("Not Relevant"));

    // Child should reappear with Not Relevant title
    await screen.findByText("Child");
    expect(screen.getByTitle("Not Relevant")).toBeDefined();
  });
});
