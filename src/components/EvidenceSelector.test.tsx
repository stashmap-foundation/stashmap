import { List } from "immutable";
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
import { updateItemArgument } from "../connections";

// Integration tests for EvidenceSelector component
describe("EvidenceSelector", () => {
  test("shows evidence selector for child items", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create parent with children
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("add to My Notes"));
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Expand Parent and add children
    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("add to Parent"));
    await userEvent.type(await findNewNodeEditor(), "Child1{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Child2{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await expectTree(`
My Notes
  Parent
    Child1
    Child2
    `);

    // Both children should have evidence selectors
    await screen.findByLabelText(/Evidence for Child1:/);
    await screen.findByLabelText(/Evidence for Child2:/);
  });

  test("clicking cycles through undefined -> confirms -> contra -> undefined", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create parent with one child
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("add to My Notes"));
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("add to Parent"));
    await userEvent.type(await findNewNodeEditor(), "Child{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await screen.findByText("Child");

    // Initial state: no evidence type
    expect(
      screen.getByLabelText(/Evidence for Child: No evidence type/)
    ).toBeDefined();

    // Click 1: undefined -> confirms
    fireEvent.click(
      screen.getByLabelText(/Evidence for Child: No evidence type/)
    );
    await waitFor(() => {
      expect(
        screen.getByLabelText(/Evidence for Child: Confirms/)
      ).toBeDefined();
    });

    // Click 2: confirms -> contra
    fireEvent.click(screen.getByLabelText(/Evidence for Child: Confirms/));
    await waitFor(() => {
      expect(
        screen.getByLabelText(/Evidence for Child: Contradicts/)
      ).toBeDefined();
    });

    // Click 3: contra -> undefined
    fireEvent.click(screen.getByLabelText(/Evidence for Child: Contradicts/));
    await waitFor(() => {
      expect(
        screen.getByLabelText(/Evidence for Child: No evidence type/)
      ).toBeDefined();
    });
  });

  test("item with confirms argument shows Confirms label", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create parent with child
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("add to My Notes"));
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("add to Parent"));
    await userEvent.type(await findNewNodeEditor(), "Child{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await screen.findByText("Child");

    // Set to confirms by clicking once
    fireEvent.click(
      screen.getByLabelText(/Evidence for Child: No evidence type/)
    );

    // Evidence selector should show "Confirms"
    await screen.findByLabelText(/Evidence for Child: Confirms/);
  });

  test("item with contra argument shows Contradicts label", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create parent with child
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("add to My Notes"));
    await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("add to Parent"));
    await userEvent.type(await findNewNodeEditor(), "Child{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await screen.findByText("Child");

    // Set to contra by clicking twice (undefined -> confirms -> contra)
    fireEvent.click(
      screen.getByLabelText(/Evidence for Child: No evidence type/)
    );
    await screen.findByLabelText(/Evidence for Child: Confirms/);
    fireEvent.click(screen.getByLabelText(/Evidence for Child: Confirms/));

    // Evidence selector should show "Contradicts"
    await screen.findByLabelText(/Evidence for Child: Contradicts/);
  });

  test("does not show evidence selector for Referenced By items", async () => {
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
    await navigateToNodeViaSearch(0, "Bitcoin");
    await screen.findByLabelText("expand Bitcoin");

    // Open Referenced By view for Bitcoin
    fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
    await screen.findByLabelText("hide references to Bitcoin");

    // Wait for the Referenced By content to load - Money should appear
    const moneyMatches = await screen.findAllByText(/Money/);
    expect(moneyMatches.length).toBeGreaterThanOrEqual(1);

    // Referenced By items should NOT have evidence selectors
    const evidenceButtons = screen.queryAllByLabelText(/Evidence for Money:/);
    expect(evidenceButtons.length).toBe(0);
  });

  test("evidence selector persists after setting", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create parent with children
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

    // Set Child1 to confirms
    fireEvent.click(
      screen.getByLabelText(/Evidence for Child1: No evidence type/)
    );

    await waitFor(() => {
      expect(
        screen.getByLabelText(/Evidence for Child1: Confirms/)
      ).toBeDefined();
    });

    // Child1 should show Confirms, Child2 should still show No evidence type
    expect(
      screen.getByLabelText(/Evidence for Child1: Confirms/)
    ).toBeDefined();
    expect(
      screen.getByLabelText(/Evidence for Child2: No evidence type/)
    ).toBeDefined();
  });
});

// Tests for updateItemArgument function
describe("updateItemArgument", () => {
  test("updates argument on existing item", () => {
    const relations: Relations = {
      items: List([
        { nodeID: "node1" as ID, relevance: "" as Relevance },
        { nodeID: "node2" as ID, relevance: "" as Relevance },
      ]),
      head: "head" as ID,
      context: List(),
      id: "rel1" as LongID,
      updated: Date.now(),
      author: "author" as PublicKey,
    };

    const updated = updateItemArgument(relations, 0, "confirms");
    expect(updated.items.get(0)?.argument).toBe("confirms");
    expect(updated.items.get(1)?.argument).toBeUndefined();
  });

  test("can set argument to undefined", () => {
    const relations: Relations = {
      items: List([
        {
          nodeID: "node1" as ID,
          relevance: "" as Relevance,
          argument: "confirms" as Argument,
        },
      ]),
      head: "head" as ID,
      context: List(),
      id: "rel1" as LongID,
      updated: Date.now(),
      author: "author" as PublicKey,
    };

    const updated = updateItemArgument(relations, 0, undefined);
    expect(updated.items.get(0)?.argument).toBeUndefined();
  });

  test("returns unchanged relations for invalid index", () => {
    const relations: Relations = {
      items: List([{ nodeID: "node1" as ID, relevance: "" as Relevance }]),
      head: "head" as ID,
      context: List(),
      id: "rel1" as LongID,
      updated: Date.now(),
      author: "author" as PublicKey,
    };

    const updated = updateItemArgument(relations, 5, "confirms");
    expect(updated).toBe(relations);
  });
});
