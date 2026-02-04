import { List } from "immutable";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  ALICE,
  expectTree,
  navigateToNodeViaSearch,
  renderTree,
  setup,
  type,
} from "../utils.test";
import { updateItemArgument } from "../connections";

describe("EvidenceSelector", () => {
  test("shows evidence selector for child items", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("Root{Enter}Parent{Enter}{Tab}Child1{Enter}Child2{Escape}");

    await expectTree(`
Root
  Parent
    Child1
    Child2
    `);

    await screen.findByLabelText(/Evidence for Child1:/);
    await screen.findByLabelText(/Evidence for Child2:/);
  });

  test("clicking cycles through undefined -> confirms -> contra -> undefined", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("Root{Enter}Parent{Enter}{Tab}Child{Escape}");

    await screen.findByText("Child");

    expect(
      screen.getByLabelText(/Evidence for Child: No evidence type/)
    ).toBeDefined();

    fireEvent.click(
      screen.getByLabelText(/Evidence for Child: No evidence type/)
    );
    await waitFor(() => {
      expect(
        screen.getByLabelText(/Evidence for Child: Confirms/)
      ).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText(/Evidence for Child: Confirms/));
    await waitFor(() => {
      expect(
        screen.getByLabelText(/Evidence for Child: Contradicts/)
      ).toBeDefined();
    });

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

    await type("Root{Enter}Parent{Enter}{Tab}Child{Escape}");

    await screen.findByText("Child");

    fireEvent.click(
      screen.getByLabelText(/Evidence for Child: No evidence type/)
    );

    await screen.findByLabelText(/Evidence for Child: Confirms/);
  });

  test("item with contra argument shows Contradicts label", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("Root{Enter}Parent{Enter}{Tab}Child{Escape}");

    await screen.findByText("Child");

    fireEvent.click(
      screen.getByLabelText(/Evidence for Child: No evidence type/)
    );
    await screen.findByLabelText(/Evidence for Child: Confirms/);
    fireEvent.click(screen.getByLabelText(/Evidence for Child: Confirms/));

    await screen.findByLabelText(/Evidence for Child: Contradicts/);
  });

  test("does not show evidence selector for Referenced By items", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("Root{Enter}Money{Enter}{Tab}Bitcoin{Escape}");

    await navigateToNodeViaSearch(0, "Bitcoin");
    await screen.findByLabelText("collapse Bitcoin");

    fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
    await screen.findByLabelText("hide references to Bitcoin");

    const moneyMatches = await screen.findAllByText(/Money/);
    expect(moneyMatches.length).toBeGreaterThanOrEqual(1);

    const evidenceButtons = screen.queryAllByLabelText(/Evidence for Money:/);
    expect(evidenceButtons.length).toBe(0);
  });

  test("evidence selector persists after setting", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("Root{Enter}Parent{Enter}{Tab}Child1{Enter}Child2{Escape}");

    await screen.findByText("Child1");
    await screen.findByText("Child2");

    fireEvent.click(
      screen.getByLabelText(/Evidence for Child1: No evidence type/)
    );

    await waitFor(() => {
      expect(
        screen.getByLabelText(/Evidence for Child1: Confirms/)
      ).toBeDefined();
    });

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
        { nodeID: "node1" as ID, relevance: undefined as Relevance },
        { nodeID: "node2" as ID, relevance: undefined as Relevance },
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
          relevance: undefined as Relevance,
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
      items: List([{ nodeID: "node1" as ID, relevance: undefined as Relevance }]),
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
