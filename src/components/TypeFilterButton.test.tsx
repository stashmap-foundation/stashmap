import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  expectTree,
  findNewNodeEditor,
  navigateToNodeViaSearch,
  renderTree,
  setup,
} from "../utils.test";
import { DEFAULT_TYPE_FILTERS, TYPE_COLORS } from "../constants";

describe("TYPE_COLORS", () => {
  test("has correct colors for relevance types", () => {
    expect(TYPE_COLORS.relevant).toBe("#268bd2");
    expect(TYPE_COLORS.maybe_relevant).toBe("#d33682");
    expect(TYPE_COLORS.little_relevant).toBe("#b58900");
    expect(TYPE_COLORS.not_relevant).toBe("#93a1a1");
  });

  test("has correct colors for argument types", () => {
    expect(TYPE_COLORS.confirms).toBe("#859900");
    expect(TYPE_COLORS.contra).toBe("#dc322f");
  });

  test("has inactive color", () => {
    expect(TYPE_COLORS.inactive).toBe("#586e75");
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
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("edit Parent"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Child{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await expectTree(`
My Notes
  Parent
    Child
    `);

    // Inline filter dots should exist in the pane header
    expect(screen.getByLabelText("toggle Relevant filter")).toBeDefined();
    expect(screen.getByLabelText("toggle Maybe Relevant filter")).toBeDefined();
    expect(screen.getByLabelText("toggle Not Relevant filter")).toBeDefined();
  });

  test("inline filter dots are clickable", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Parent with a child
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("edit Parent"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Child{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Inline filter dots should exist
    expect(screen.getByLabelText("toggle Relevant filter")).toBeDefined();
    expect(screen.getByLabelText("toggle Maybe Relevant filter")).toBeDefined();
    expect(
      screen.getByLabelText("toggle Little Relevant filter")
    ).toBeDefined();
    expect(screen.getByLabelText("toggle Not Relevant filter")).toBeDefined();
    expect(screen.getByLabelText("toggle Confirms filter")).toBeDefined();
    expect(screen.getByLabelText("toggle Contradicts filter")).toBeDefined();
  });

  test("toggling filter hides/shows items", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Parent with children
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("edit Parent"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Item One{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Item Two{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await screen.findByText("Item One");
    await screen.findByText("Item Two");

    // Toggle off "Maybe Relevant" filter using inline dot (default relevance for new items)
    fireEvent.click(screen.getByLabelText("toggle Maybe Relevant filter"));

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
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("edit Parent"));
    await userEvent.keyboard("{Enter}");
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

    // Enable "Not Relevant" filter using inline dot
    fireEvent.click(screen.getByLabelText("toggle Not Relevant filter"));

    // Hidden Item should now be visible
    await screen.findByText("Hidden Item");
  });

  test("inline filter dots are always visible in pane header", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create: My Notes -> Money -> Bitcoin
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Money{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Money"));
    await userEvent.click(await screen.findByLabelText("edit Money"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Bitcoin{Escape}");

    // Navigate to Bitcoin as root
    await navigateToNodeViaSearch(0, "Bitcoin");
    await screen.findByLabelText("expand Bitcoin");

    // Inline filter dots should exist in pane header
    expect(screen.getByLabelText("toggle Relevant filter")).toBeDefined();

    // Switch to Referenced By view
    fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
    await screen.findByLabelText("hide references to Bitcoin");

    // Inline filter dots should still be visible (they're in pane header)
    expect(screen.getByLabelText("toggle Relevant filter")).toBeDefined();
  });

  test("filter state persists across interactions", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Parent with a child
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("edit Parent"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Test Item{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await screen.findByText("Test Item");

    // Toggle off "Maybe Relevant" filter using inline dot
    await userEvent.click(
      screen.getByLabelText("toggle Maybe Relevant filter")
    );

    // Item should be hidden
    await waitFor(() => {
      expect(screen.queryByText("Test Item")).toBeNull();
    });

    // Item should still be hidden (filter state persists)
    await waitFor(() => {
      expect(screen.queryByText("Test Item")).toBeNull();
    });

    // Re-enable "Maybe Relevant" filter
    await userEvent.click(
      screen.getByLabelText("toggle Maybe Relevant filter")
    );

    // Item should reappear
    await screen.findByText("Test Item");
  });
});

describe("Suggestions filter", () => {
  test("DEFAULT_TYPE_FILTERS includes suggestions", () => {
    expect(DEFAULT_TYPE_FILTERS).toContain("suggestions");
  });

  test("TYPE_COLORS has other_user color for suggestions", () => {
    expect(TYPE_COLORS.other_user).toBe("#6c71c4");
  });

  test("inline filter dots include Suggestions option", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Parent with a child
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("edit Parent"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Child{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Suggestions filter dot should be visible in pane header
    expect(screen.getByLabelText("toggle Suggestions filter")).toBeDefined();
  });
});

describe("Filter integration with RelevanceSelector", () => {
  test("marking item as not_relevant hides it when filter excludes not_relevant", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Parent with children
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("edit Parent"));
    await userEvent.keyboard("{Enter}");
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

    // Enable not_relevant filter using inline dot
    fireEvent.click(screen.getByLabelText("toggle Not Relevant filter"));

    // Child1 should reappear
    await screen.findByText("Child1");
  });

  test("relevance change reflects correctly", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Parent with a child
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("edit Parent"));
    await userEvent.keyboard("{Enter}");
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
    fireEvent.click(screen.getByLabelText("toggle Not Relevant filter"));

    // Child should reappear with Not Relevant relevance
    await screen.findByText("Child");
    // There are two elements with "Not Relevant" title (filter dot and relevance selector)
    const notRelevantElements = screen.getAllByTitle("Not Relevant");
    expect(notRelevantElements.length).toBeGreaterThanOrEqual(2);
  });
});
