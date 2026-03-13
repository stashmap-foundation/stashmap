import { List } from "immutable";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ALICE, expectTree, renderTree, setup, type } from "../utils.test";
import { updateItemArgument } from "../connections";

function makeItem(
  id: ID,
  author: PublicKey,
  root: ID,
  relevance: Relevance,
  argument?: Argument
): GraphNode {
  return {
    children: List<GraphNode>(),
    id,
    text: "",
    updated: Date.now(),
    author,
    root,
    relevance,
    ...(argument !== undefined ? { argument } : {}),
  };
}

describe("EvidenceSelector", () => {
  test("shows evidence selector for child children", async () => {
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

  test("incoming refs show both relevance and evidence selectors", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("Crypto{Enter}{Tab}Bitcoin{Escape}");
    fireEvent.click(screen.getByLabelText("Create new note"));
    await type("Money{Enter}{Tab}Bitcoin{Enter}{Tab}Details{Escape}");

    await expectTree(`
Money
  Bitcoin
    Details
    [C] Crypto / Bitcoin
    `);

    await screen.findByLabelText(/decline Crypto \/ Bitcoin/);
    await screen.findByLabelText(/Evidence for Crypto \/ Bitcoin/);
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
    const nodes: GraphNode = {
      children: List([
        makeItem(
          "node1" as ID,
          "author" as PublicKey,
          "rel1" as LongID,
          undefined
        ),
        makeItem(
          "node2" as ID,
          "author" as PublicKey,
          "rel1" as LongID,
          undefined
        ),
      ]),
      id: "rel1" as LongID,
      text: "head",
      parent: undefined,
      updated: Date.now(),
      author: "author" as PublicKey,
      root: "rel1" as ID,
      relevance: undefined,
    };

    const updated = updateItemArgument(nodes, 0, "confirms");
    const { children } = updated;
    expect(children.get(0)?.argument).toBe("confirms");
    expect(children.get(1)?.argument).toBeUndefined();
  });

  test("can set argument to undefined", () => {
    const nodes: GraphNode = {
      children: List([
        makeItem(
          "node1" as ID,
          "author" as PublicKey,
          "rel1" as LongID,
          undefined,
          "confirms"
        ),
      ]),
      id: "rel1" as LongID,
      text: "head",
      parent: undefined,
      updated: Date.now(),
      author: "author" as PublicKey,
      root: "rel1" as ID,
      relevance: undefined,
    };

    const updated = updateItemArgument(nodes, 0, undefined);
    const { children } = updated;
    expect(children.get(0)?.argument).toBeUndefined();
  });

  test("returns unchanged nodes for invalid index", () => {
    const nodes: GraphNode = {
      children: List([
        makeItem(
          "node1" as ID,
          "author" as PublicKey,
          "rel1" as LongID,
          undefined
        ),
      ]),
      id: "rel1" as LongID,
      text: "head",
      parent: undefined,
      updated: Date.now(),
      author: "author" as PublicKey,
      root: "rel1" as ID,
      relevance: undefined,
    };

    const updated = updateItemArgument(nodes, 5, "confirms");
    expect(updated).toBe(nodes);
  });
});
