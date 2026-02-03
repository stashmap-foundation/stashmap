import { Map } from "immutable";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  expectTree,
  follow,
  renderTree,
  setup,
  findNewNodeEditor,
  navigateToNodeViaSearch,
  getTreeStructure,
} from "../utils.test";
import { areAllAncestorsExpanded } from "./TreeView";

test("Load Referenced By Nodes", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);

  // Create: My Notes -> Money -> Bitcoin, Cryptocurrencies -> Bitcoin, P2P Apps -> Bitcoin
  // Since nodes are content-addressed, typing "Bitcoin" multiple times creates the same node
  await userEvent.click(await screen.findByLabelText("edit My Notes"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(
    await findNewNodeEditor(),
    "Money{Enter}{Tab}Bitcoin{Escape}"
  );

  await userEvent.click(await screen.findByLabelText("edit My Notes"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(
    await findNewNodeEditor(),
    "Cryptocurrencies{Enter}{Tab}Bitcoin{Escape}"
  );

  await userEvent.click(await screen.findByLabelText("edit My Notes"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(
    await findNewNodeEditor(),
    "P2P Apps{Enter}{Tab}Bitcoin{Escape}"
  );

  await expectTree(`
My Notes
  P2P Apps
    Bitcoin
  Cryptocurrencies
    Bitcoin
  Money
    Bitcoin
  `);

  // Click show references on Bitcoin (pick first one)
  const showRefBtns = screen.getAllByLabelText("show references to Bitcoin");
  fireEvent.click(showRefBtns[0]);

  // After clicking, should be in Referenced By mode - button now says "hide"
  await screen.findByLabelText("hide references to Bitcoin");

  // Reference nodes display the paths containing Money, Cryptocurrencies, P2P Apps
  const moneyMatches = await screen.findAllByText(/Money/);
  expect(moneyMatches.length).toBeGreaterThanOrEqual(1);
  const cryptoMatches = await screen.findAllByText(/Cryptocurrencies/);
  expect(cryptoMatches.length).toBeGreaterThanOrEqual(1);
  const p2pMatches = await screen.findAllByText(/P2P Apps/);
  expect(p2pMatches.length).toBeGreaterThanOrEqual(1);
});

test("Show Referenced By with content details", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);

  // Create: My Notes -> Money -> Bitcoin, P2P Apps -> Bitcoin
  // Since nodes are content-addressed, typing "Bitcoin" twice creates the same node
  await userEvent.click(await screen.findByLabelText("edit My Notes"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(
    await findNewNodeEditor(),
    "Money{Enter}{Tab}Bitcoin{Escape}"
  );

  await userEvent.click(await screen.findByLabelText("edit My Notes"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(
    await findNewNodeEditor(),
    "P2P Apps{Enter}{Tab}Bitcoin{Escape}"
  );

  await expectTree(`
My Notes
  P2P Apps
    Bitcoin
  Money
    Bitcoin
  `);

  // Click on Bitcoin's "show references" button to see its references
  const bitcoinLabels = screen.getAllByLabelText("show references to Bitcoin");
  fireEvent.click(bitcoinLabels[0]);

  // Button should change to "hide references"
  await screen.findByLabelText("hide references to Bitcoin");

  // The references should show as paths containing Money and P2P Apps
  const moneyMatches = await screen.findAllByText(/Money/);
  expect(moneyMatches.length).toBeGreaterThanOrEqual(1);
  const p2pMatches = await screen.findAllByText(/P2P Apps/);
  expect(p2pMatches.length).toBeGreaterThanOrEqual(1);
});

test("Root node shows references when there are more than 0", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);

  // Create Money -> Bitcoin hierarchy
  await screen.findByLabelText("collapse My Notes");
  await userEvent.click(await screen.findByLabelText("edit My Notes"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(await findNewNodeEditor(), "Money{Escape}");

  await userEvent.click(await screen.findByLabelText("expand Money"));
  await userEvent.click(await screen.findByLabelText("edit Money"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(await findNewNodeEditor(), "Bitcoin{Escape}");

  await screen.findByText("Bitcoin");

  // Navigate to Bitcoin as root using pane search
  await navigateToNodeViaSearch(0, "Bitcoin");

  // Now Bitcoin is the root - wait for it to appear as root
  // Bitcoin has no children so it shows "expand" by default
  await screen.findByLabelText("expand Bitcoin");

  // Show references to Bitcoin
  fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
  await screen.findByLabelText("hide references to Bitcoin");

  // The reference should show Money as the parent
  const content = (await screen.findByLabelText("related to Bitcoin"))
    .textContent;
  expect(content).toMatch(/Money/);
});

test("Referenced By items do not show relation selector", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);

  // Create Money -> Bitcoin hierarchy
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

  // The root node (Bitcoin) should have a relation selector
  expect(screen.getByLabelText("show references to Bitcoin")).toBeDefined();

  // Open Referenced By view
  fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
  await screen.findByLabelText("hide references to Bitcoin");

  // Wait for the reference item to appear
  const moneyMatches = await screen.findAllByText(/Money/);
  expect(moneyMatches.length).toBeGreaterThanOrEqual(1);

  // The Referenced By items should NOT have relation selectors
  // Only the root node (Bitcoin) should have one
  const allRelationSelectors = screen.getAllByRole("button", {
    name: /show references|hide references/,
  });
  // Should only find one - for the root Bitcoin node
  expect(allRelationSelectors).toHaveLength(1);
});

test("Referenced By items still show navigation buttons", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);

  // Create Money -> Bitcoin hierarchy
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

  // Open Referenced By view
  fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
  await screen.findByLabelText("hide references to Bitcoin");

  // Wait for the reference item to appear
  const moneyMatches = await screen.findAllByText(/Money/);
  expect(moneyMatches.length).toBeGreaterThanOrEqual(1);

  // Navigation buttons should still be available for Referenced By items
  // The fullscreen button should be present (aria-label includes display text)
  const fullscreenButtons = screen.getAllByLabelText(/open.*in fullscreen/);
  expect(fullscreenButtons.length).toBeGreaterThanOrEqual(1);
});

test("Referenced By shows node with list and empty context", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);

  // Create Money -> Bitcoin hierarchy
  await screen.findByLabelText("collapse My Notes");
  await userEvent.click(await screen.findByLabelText("edit My Notes"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(await findNewNodeEditor(), "Money{Escape}");

  await userEvent.click(await screen.findByLabelText("expand Money"));
  await userEvent.click(await screen.findByLabelText("edit Money"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(await findNewNodeEditor(), "Bitcoin{Escape}");

  // Navigate to Money as root
  await navigateToNodeViaSearch(0, "Money");

  // Money is now root - wait for it to appear (could be expanded or collapsed)
  await screen.findByLabelText(/expand Money|collapse Money/);

  // Open Referenced By view
  fireEvent.click(screen.getByLabelText("show references to Money"));
  await screen.findByLabelText("hide references to Money");

  // The node with a list should appear in its own Referenced By
  // It should display just "Money" (the node name), not "Loading..."
  const content = (await screen.findByLabelText("related to Money"))
    .textContent;
  expect(content).toMatch(/Money/);
  expect(content).not.toMatch(/Loading/);
});

test("Referenced By deduplicates paths from multiple users", async () => {
  // Test that when the same node is referenced from the same parent path,
  // the references are deduplicated in the UI
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
  await screen.findByLabelText(/expand Bitcoin|collapse Bitcoin/);

  // Open references view
  fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
  await screen.findByLabelText("hide references to Bitcoin");

  // Wait for Referenced By to load - the path My Notes -> Money -> Bitcoin should show
  await screen.findByLabelText("related to Bitcoin");

  // There should be exactly one reference path (not counting breadcrumb links)
  const referenceButtons = screen
    .getAllByLabelText(/Navigate to/)
    .filter((btn) => btn.classList.contains("reference-link-btn"));
  expect(referenceButtons).toHaveLength(1);
});

test("Reference indicators show other users icon", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);

  // Bob creates: My Notes -> Parent -> Child
  renderTree(bob);
  await userEvent.click(await screen.findByLabelText("edit My Notes"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(
    await findNewNodeEditor(),
    "Parent{Enter}{Tab}Child{Escape}"
  );
  cleanup();

  // Alice creates: My Notes -> Parent -> Child (same structure)
  renderTree(alice);
  await userEvent.click(await screen.findByLabelText("edit My Notes"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(
    await findNewNodeEditor(),
    "Parent{Enter}{Tab}Child{Escape}"
  );

  // Navigate to Child and show references
  await navigateToNodeViaSearch(0, "Child");

  fireEvent.click(await screen.findByLabelText("show references to Child"));

  // Expand abstract reference to see concrete references
  await userEvent.click(await screen.findByLabelText(/expand.*Parent.*Child/));

  // Bob's concrete reference should show the other user icon
  const otherUserIcon = await screen.findByTitle("Content from another user");
  expect(otherUserIcon).toBeDefined();
});

test("Relevance selector shows when node is expanded", async () => {
  // This tests that child nodes show relevance selectors when visible
  const [alice] = setup([ALICE]);
  renderTree(alice);

  // Create Parent -> Child1, Child2
  await screen.findByLabelText("collapse My Notes");
  await userEvent.click(await screen.findByLabelText("edit My Notes"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(await findNewNodeEditor(), "Parent{Escape}");

  await userEvent.click(await screen.findByLabelText("expand Parent"));
  await userEvent.click(await screen.findByLabelText("edit Parent"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(await findNewNodeEditor(), "Child1{Enter}");
  await userEvent.type(await findNewNodeEditor(), "Child2{Escape}");

  // Verify children are visible under Parent
  await screen.findByText("Child1");
  await screen.findByText("Child2");

  // The relevance selectors should appear for the children
  // (Child1 and Child2 each have their own relevance button)
  expect(screen.getByLabelText("mark Child1 as not relevant")).toBeDefined();
  expect(screen.getByLabelText("mark Child2 as not relevant")).toBeDefined();
});

test("Can exit Referenced By mode even when node has no relations", async () => {
  // This tests the fix for when a node has references TO it
  // but no children/relations of its own - you should still be able
  // to exit Referenced By mode
  const [alice] = setup([ALICE]);
  renderTree(alice);

  // Create Money -> Bitcoin (Bitcoin has no children)
  await screen.findByLabelText("collapse My Notes");
  await userEvent.click(await screen.findByLabelText("edit My Notes"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(await findNewNodeEditor(), "Money{Escape}");

  await userEvent.click(await screen.findByLabelText("expand Money"));
  await userEvent.click(await screen.findByLabelText("edit Money"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(await findNewNodeEditor(), "Bitcoin{Escape}");

  // Navigate to Bitcoin as root using pane search
  await navigateToNodeViaSearch(0, "Bitcoin");

  // Bitcoin is now root - it has no children
  await screen.findByLabelText("expand Bitcoin");

  // Filter dots should be visible initially (not in Referenced By mode)
  expect(screen.getByLabelText("toggle Relevant filter")).toBeDefined();

  // Enter Referenced By mode
  fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
  await screen.findByLabelText("hide references to Bitcoin");

  // Reference should be visible (Money is Bitcoin's parent)
  // Wait for references to load - look for the reference path containing Money
  await waitFor(async () => {
    const tree = await getTreeStructure();
    expect(tree).toMatch(/Money/);
  });

  // Exit Referenced By mode - this should work even though Bitcoin has no relations
  fireEvent.click(screen.getByLabelText("hide references to Bitcoin"));

  // Should be back to normal mode - filter dots should be visible again
  await screen.findByLabelText("toggle Relevant filter");
  expect(screen.getByLabelText("show references to Bitcoin")).toBeDefined();
});

describe("areAllAncestorsExpanded", () => {
  test("returns false when parent is collapsed", () => {
    const rootKey = "p0:rootNode:0";
    const parentKey = "p0:rootNode:0:rootRel:parentNode:0";
    const childKey = "p0:rootNode:0:rootRel:parentNode:0:parentRel:childNode:0";

    const views: Views = Map({
      [rootKey]: { viewingMode: undefined, expanded: true },
      [parentKey]: { viewingMode: undefined, expanded: false },
      [childKey]: { viewingMode: undefined, expanded: true },
    });

    expect(areAllAncestorsExpanded(views, childKey, rootKey)).toBe(false);
    expect(areAllAncestorsExpanded(views, parentKey, rootKey)).toBe(true);
  });

  test("returns true when all ancestors are expanded", () => {
    const rootKey = "p0:rootNode:0";
    const parentKey = "p0:rootNode:0:rootRel:parentNode:0";
    const childKey = "p0:rootNode:0:rootRel:parentNode:0:parentRel:childNode:0";

    const views: Views = Map({
      [rootKey]: { viewingMode: undefined, expanded: true },
      [parentKey]: { viewingMode: undefined, expanded: true },
      [childKey]: { viewingMode: undefined, expanded: true },
    });

    expect(areAllAncestorsExpanded(views, childKey, rootKey)).toBe(true);
    expect(areAllAncestorsExpanded(views, parentKey, rootKey)).toBe(true);
  });
});
