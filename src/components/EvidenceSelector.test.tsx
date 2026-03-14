import { List } from "immutable";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ALICE, expectTree, renderTree, setup, type } from "../utils.test";
import { updateRelationItemMetadata } from "../relationItemMetadata";

function makeItem(
  id: ID,
  author: PublicKey,
  root: ID,
  relevance: Relevance,
  argument?: Argument
): GraphNode {
  return {
    children: List<ID>(),
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

describe("updateRelationItemMetadata", () => {
  test("updates argument on existing item", () => {
    const item = makeItem(
      "node1" as ID,
      "author" as PublicKey,
      "rel1" as LongID,
      undefined
    );

    const updated = updateRelationItemMetadata(item, { argument: "confirms" });
    expect(updated.argument).toBe("confirms");
  });

  test("can set argument to undefined", () => {
    const item = makeItem(
      "node1" as ID,
      "author" as PublicKey,
      "rel1" as LongID,
      undefined,
      "confirms"
    );

    const updated = updateRelationItemMetadata(item, { argument: undefined });
    expect(updated.argument).toBeUndefined();
  });

  test("returns unchanged node when metadata is empty", () => {
    const item = makeItem(
      "node1" as ID,
      "author" as PublicKey,
      "rel1" as LongID,
      undefined
    );

    const updated = updateRelationItemMetadata(item, {});
    expect(updated).toEqual(item);
  });
});
