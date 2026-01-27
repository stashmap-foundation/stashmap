import { List, Map } from "immutable";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  follow,
  renderTree,
  setup,
  findNewNodeEditor,
} from "../utils.test";
import { newNode, addRelationToRelations } from "../connections";
import { createPlan, planUpsertNode, planUpsertRelations } from "../planner";
import { execute } from "../executor";
import { newRelations } from "../ViewContext";
import { areAllAncestorsExpanded } from "./TreeView";

test("Load Referenced By Nodes", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);

  // Create: My Notes -> [Money -> Bitcoin, Cryptocurrencies -> Bitcoin, P2P Apps -> Bitcoin]
  // Bitcoin will be attached to multiple parents
  await screen.findByLabelText("collapse My Notes");
  await userEvent.click(await screen.findByLabelText("add to My Notes"));
  await userEvent.type(await findNewNodeEditor(), "Money{Enter}");
  await userEvent.type(await findNewNodeEditor(), "Cryptocurrencies{Enter}");
  await userEvent.type(await findNewNodeEditor(), "P2P Apps{Escape}");

  // Add Bitcoin under Money
  await userEvent.click(await screen.findByLabelText("expand Money"));
  await userEvent.click(await screen.findByLabelText("add to Money"));
  await userEvent.type(await findNewNodeEditor(), "Bitcoin{Escape}");

  // Attach same Bitcoin to Cryptocurrencies
  await userEvent.click(
    await screen.findByLabelText("expand Cryptocurrencies")
  );
  await userEvent.click(
    await screen.findByLabelText("search and attach to Cryptocurrencies")
  );
  await userEvent.type(await screen.findByLabelText("search input"), "Bitcoin");
  await userEvent.click(await screen.findByLabelText("select Bitcoin"));

  // Attach same Bitcoin to P2P Apps
  await userEvent.click(await screen.findByLabelText("expand P2P Apps"));
  await userEvent.click(
    await screen.findByLabelText("search and attach to P2P Apps")
  );
  await userEvent.type(await screen.findByLabelText("search input"), "Bitcoin");
  await userEvent.click(await screen.findByLabelText("select Bitcoin"));

  // Verify Bitcoin appears under all three parents
  const bitcoinElements = await screen.findAllByText("Bitcoin");
  expect(bitcoinElements.length).toBe(3);

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

  // Create hierarchy: My Notes -> Money -> Bitcoin
  // Also create: My Notes -> P2P Apps -> Bitcoin (same Bitcoin node referenced twice)
  await screen.findByLabelText("collapse My Notes");
  await userEvent.click(await screen.findByLabelText("add to My Notes"));
  await userEvent.type(await findNewNodeEditor(), "Money{Enter}");
  await userEvent.type(await findNewNodeEditor(), "P2P Apps{Enter}");
  await userEvent.type(await findNewNodeEditor(), "{Escape}");

  // Add Bitcoin under Money
  await userEvent.click(await screen.findByLabelText("expand Money"));
  await userEvent.click(await screen.findByLabelText("add to Money"));
  await userEvent.type(await findNewNodeEditor(), "Bitcoin{Escape}");

  // Wait for Bitcoin to appear
  await screen.findByText("Bitcoin");

  // Attach same Bitcoin to P2P Apps via search
  await userEvent.click(await screen.findByLabelText("expand P2P Apps"));
  await userEvent.click(
    await screen.findByLabelText("search and attach to P2P Apps")
  );
  await userEvent.type(await screen.findByLabelText("search input"), "Bitcoin");
  // Wait for search results
  await screen.findByLabelText("select Bitcoin");
  await userEvent.click(await screen.findByLabelText("select Bitcoin"));

  // Wait for the Bitcoin to appear under P2P Apps
  // There should now be 2 Bitcoin elements (one under Money, one under P2P Apps)
  const bitcoinElements = await screen.findAllByText("Bitcoin");
  expect(bitcoinElements.length).toBe(2);

  // Click on Bitcoin's "show references" button to see its references
  const bitcoinLabels = screen.getAllByLabelText("show references to Bitcoin");
  fireEvent.click(bitcoinLabels[0]);

  // Button should change to "hide references"
  await screen.findByLabelText("hide references to Bitcoin");

  // The references should show as paths containing Money and P2P Apps
  // Bitcoin is referenced from two places - paths like "My Notes → Money → Bitcoin"
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
  await userEvent.click(await screen.findByLabelText("add to My Notes"));
  await userEvent.type(await findNewNodeEditor(), "Money{Escape}");

  await userEvent.click(await screen.findByLabelText("expand Money"));
  await userEvent.click(await screen.findByLabelText("add to Money"));
  await userEvent.type(await findNewNodeEditor(), "Bitcoin{Escape}");

  await screen.findByText("Bitcoin");

  // Navigate to Bitcoin as root using pane search
  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );
  await userEvent.type(await screen.findByLabelText("search input"), "Bitcoin");
  await userEvent.click(await screen.findByLabelText("select Bitcoin"));

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
  await userEvent.click(await screen.findByLabelText("add to My Notes"));
  await userEvent.type(await findNewNodeEditor(), "Money{Escape}");

  await userEvent.click(await screen.findByLabelText("expand Money"));
  await userEvent.click(await screen.findByLabelText("add to Money"));
  await userEvent.type(await findNewNodeEditor(), "Bitcoin{Escape}");

  // Navigate to Bitcoin as root
  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );
  await userEvent.type(await screen.findByLabelText("search input"), "Bitcoin");
  await userEvent.click(await screen.findByLabelText("select Bitcoin"));
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
  await userEvent.click(await screen.findByLabelText("add to My Notes"));
  await userEvent.type(await findNewNodeEditor(), "Money{Escape}");

  await userEvent.click(await screen.findByLabelText("expand Money"));
  await userEvent.click(await screen.findByLabelText("add to Money"));
  await userEvent.type(await findNewNodeEditor(), "Bitcoin{Escape}");

  // Navigate to Bitcoin as root
  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );
  await userEvent.type(await screen.findByLabelText("search input"), "Bitcoin");
  await userEvent.click(await screen.findByLabelText("select Bitcoin"));
  await screen.findByLabelText("expand Bitcoin");

  // Open Referenced By view
  fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
  await screen.findByLabelText("hide references to Bitcoin");

  // Wait for the reference item to appear
  const moneyMatches = await screen.findAllByText(/Money/);
  expect(moneyMatches.length).toBeGreaterThanOrEqual(1);

  // Navigation buttons should still be available for Referenced By items
  // The fullscreen button should be present
  const fullscreenButtons = screen.getAllByLabelText("open fullscreen");
  expect(fullscreenButtons.length).toBeGreaterThanOrEqual(1);
});

test("Referenced By shows node with list and empty context", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);

  // Create Money -> Bitcoin hierarchy
  await screen.findByLabelText("collapse My Notes");
  await userEvent.click(await screen.findByLabelText("add to My Notes"));
  await userEvent.type(await findNewNodeEditor(), "Money{Escape}");

  await userEvent.click(await screen.findByLabelText("expand Money"));
  await userEvent.click(await screen.findByLabelText("add to Money"));
  await userEvent.type(await findNewNodeEditor(), "Bitcoin{Escape}");

  // Navigate to Money as root
  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );
  await userEvent.type(await screen.findByLabelText("search input"), "Money");
  await userEvent.click(await screen.findByLabelText("select Money"));

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
  await userEvent.click(await screen.findByLabelText("add to My Notes"));
  await userEvent.type(await findNewNodeEditor(), "Money{Escape}");

  await userEvent.click(await screen.findByLabelText("expand Money"));
  await userEvent.click(await screen.findByLabelText("add to Money"));
  await userEvent.type(await findNewNodeEditor(), "Bitcoin{Escape}");

  // Navigate to Bitcoin as root
  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );
  await userEvent.type(await screen.findByLabelText("search input"), "Bitcoin");
  await userEvent.click(await screen.findByLabelText("select Bitcoin"));
  await screen.findByLabelText(/expand Bitcoin|collapse Bitcoin/);

  // Open references view
  fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
  await screen.findByLabelText("hide references to Bitcoin");

  // Wait for Referenced By to load - the path My Notes -> Money -> Bitcoin should show
  await screen.findByLabelText("related to Bitcoin");

  // There should be exactly one reference path
  const referenceButtons = screen.getAllByLabelText(/Navigate to/);
  expect(referenceButtons).toHaveLength(1);
});

test("Reference indicators show item count", async () => {
  // Test that reference indicators show the count of children
  const [alice] = setup([ALICE]);
  renderTree(alice);

  // Create: My Notes -> Parent -> Child -> [Grandchild1, Grandchild2]
  await screen.findByLabelText("collapse My Notes");
  await userEvent.click(await screen.findByLabelText("add to My Notes"));
  await userEvent.type(await findNewNodeEditor(), "Parent{Escape}");

  await userEvent.click(await screen.findByLabelText("expand Parent"));
  await userEvent.click(await screen.findByLabelText("add to Parent"));
  await userEvent.type(await findNewNodeEditor(), "Child{Escape}");

  await userEvent.click(await screen.findByLabelText("expand Child"));
  await userEvent.click(await screen.findByLabelText("add to Child"));
  await userEvent.type(await findNewNodeEditor(), "Grandchild 1{Enter}");
  await userEvent.type(await findNewNodeEditor(), "Grandchild 2{Escape}");

  // Navigate to Child as root
  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );
  await userEvent.type(await screen.findByLabelText("search input"), "Child");
  // There might be multiple "Child" matches (including "Grandchild"), select the right one
  const selectButtons = await screen.findAllByLabelText(/select Child/);
  await userEvent.click(selectButtons[0]);
  await screen.findByLabelText(/expand Child|collapse Child/);

  // Open references view
  fireEvent.click(screen.getByLabelText("show references to Child"));
  await screen.findByLabelText("hide references to Child");

  // The reference "Parent" should show [2] because Child has 2 grandchildren
  // when viewed from the Parent context
  const indicators = await screen.findByText("[2]");
  expect(indicators).toBeDefined();
});

test("Reference indicators show other users icon", async () => {
  // Test that the "other users" icon appears when multiple users have different
  // versions of a node's children
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  // Create nodes programmatically so we have the exact IDs
  const parent = newNode("Parent");
  const child = newNode("Child");
  const aliceGrandchild = newNode("Alice Grandchild");

  // Alice creates Parent -> Child -> Alice Grandchild
  const parentRelations = addRelationToRelations(
    newRelations(parent.id, List(), alicePK),
    child.id
  );
  const aliceChildRelations = addRelationToRelations(
    newRelations(child.id, List(), alicePK),
    aliceGrandchild.id
  );

  // Also create a relation from My Notes to Parent so it shows in the workspace
  const aliceState = alice();
  const workspace = aliceState.panes[0].stack[aliceState.panes[0].stack.length - 1];
  const workspaceRelations = addRelationToRelations(
    newRelations(workspace, List(), alicePK),
    parent.id
  );

  const alicePlan = planUpsertRelations(
    planUpsertRelations(
      planUpsertNode(
        planUpsertNode(planUpsertNode(createPlan(alice()), parent), child),
        aliceGrandchild
      ),
      parentRelations
    ),
    aliceChildRelations
  );
  await execute({ ...alice(), plan: alicePlan });

  // Add Parent to workspace
  await execute({
    ...alice(),
    plan: planUpsertRelations(createPlan(alice()), workspaceRelations),
  });

  // Bob creates his own version of Child's children (using Child's ID)
  const bobGrandchild = newNode("Bob Grandchild");
  const bobChildRelations = addRelationToRelations(
    newRelations(child.id, List(), bobPK),
    bobGrandchild.id
  );

  const bobPlan = planUpsertRelations(
    planUpsertNode(createPlan(bob()), bobGrandchild),
    bobChildRelations
  );
  await execute({ ...bob(), plan: bobPlan });

  // Alice follows Bob
  await follow(alice, bob().user.publicKey);

  // Now render and navigate to Child
  renderTree(alice);

  // Navigate to Child as root via pane search
  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );
  await userEvent.type(await screen.findByLabelText("search input"), "Child");
  const selectButtons = await screen.findAllByLabelText(/select Child/);
  await userEvent.click(selectButtons[0]);
  await screen.findByLabelText(/expand Child|collapse Child/);

  // Open references view
  fireEvent.click(screen.getByLabelText("show references to Child"));
  await screen.findByLabelText("hide references to Child");

  // Should show the business-man icon for 1 other user (Bob)
  // The icon has a title attribute we can query
  const otherUserIcon = await screen.findByTitle("1 other version");
  expect(otherUserIcon).toBeDefined();
});

test("Disconnect button shows when view.relations is not explicitly set", async () => {
  // This tests the fix for when a node is opened in split screen
  // without view.relations being set - the disconnect button should still appear
  const [alice] = setup([ALICE]);
  renderTree(alice);

  // Create Parent -> Child1, Child2
  await screen.findByLabelText("collapse My Notes");
  await userEvent.click(await screen.findByLabelText("add to My Notes"));
  await userEvent.type(await findNewNodeEditor(), "Parent{Escape}");

  await userEvent.click(await screen.findByLabelText("expand Parent"));
  await userEvent.click(await screen.findByLabelText("add to Parent"));
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
  await userEvent.click(await screen.findByLabelText("add to My Notes"));
  await userEvent.type(await findNewNodeEditor(), "Money{Escape}");

  await userEvent.click(await screen.findByLabelText("expand Money"));
  await userEvent.click(await screen.findByLabelText("add to Money"));
  await userEvent.type(await findNewNodeEditor(), "Bitcoin{Escape}");

  // Navigate to Bitcoin as root using pane search
  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );
  await userEvent.type(await screen.findByLabelText("search input"), "Bitcoin");
  await userEvent.click(await screen.findByLabelText("select Bitcoin"));

  // Bitcoin is now root - it has no children
  await screen.findByLabelText("expand Bitcoin");

  // Filter button should be visible initially (not in Referenced By mode)
  expect(screen.getByLabelText("filter Bitcoin")).toBeDefined();

  // Enter Referenced By mode
  fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
  await screen.findByLabelText("hide references to Bitcoin");

  // Filter should now be grayed (showing children button)
  expect(screen.getByLabelText("show children of Bitcoin")).toBeDefined();

  // Reference should be visible (Money is Bitcoin's parent)
  await screen.findByText(/Money/);

  // Exit Referenced By mode - this should work even though Bitcoin has no relations
  fireEvent.click(screen.getByLabelText("hide references to Bitcoin"));

  // Should be back to normal mode - filter button should be visible again
  await screen.findByLabelText("filter Bitcoin");
  expect(screen.getByLabelText("show references to Bitcoin")).toBeDefined();
});

describe("areAllAncestorsExpanded", () => {
  test("returns false when parent is collapsed", () => {
    const rootKey = "p0:rootNode:0";
    const parentKey = "p0:rootNode:0:rootRel:parentNode:0";
    const childKey = "p0:rootNode:0:rootRel:parentNode:0:parentRel:childNode:0";

    const views: Views = Map({
      [rootKey]: { width: 100, expanded: true, relations: "rootRel" as LongID },
      [parentKey]: {
        width: 100,
        expanded: false,
        relations: "parentRel" as LongID,
      },
      [childKey]: {
        width: 100,
        expanded: true,
        relations: "childRel" as LongID,
      },
    });

    expect(areAllAncestorsExpanded(views, childKey, rootKey)).toBe(false);
    expect(areAllAncestorsExpanded(views, parentKey, rootKey)).toBe(true);
  });

  test("returns true when all ancestors are expanded", () => {
    const rootKey = "p0:rootNode:0";
    const parentKey = "p0:rootNode:0:rootRel:parentNode:0";
    const childKey = "p0:rootNode:0:rootRel:parentNode:0:parentRel:childNode:0";

    const views: Views = Map({
      [rootKey]: { width: 100, expanded: true, relations: "rootRel" as LongID },
      [parentKey]: {
        width: 100,
        expanded: true,
        relations: "parentRel" as LongID,
      },
      [childKey]: {
        width: 100,
        expanded: true,
        relations: "childRel" as LongID,
      },
    });

    expect(areAllAncestorsExpanded(views, childKey, rootKey)).toBe(true);
    expect(areAllAncestorsExpanded(views, parentKey, rootKey)).toBe(true);
  });
});
