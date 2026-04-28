import { List } from "immutable";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  expectTree,
  navigateToNodeViaSearch,
  renderApp,
  renderTree,
  setup,
  type,
} from "../utils.test";
import { updateNodeItemMetadata } from "../nodeItemMetadata";
import { plainSpans } from "../core/nodeSpans";

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
    spans: plainSpans(""),
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
    renderApp(alice());

    await type("Source{Enter}{Tab}Child{Escape}");
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Target{Enter}{Tab}Items{Escape}");

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Source");

    await userEvent.keyboard("{Alt>}");
    const sourceItems = screen.getAllByRole("treeitem", { name: "Source" });
    fireEvent.dragStart(sourceItems[sourceItems.length - 1]);
    const targetItems = screen.getAllByRole("treeitem", { name: "Target" });
    fireEvent.dragOver(targetItems[0], { altKey: true });
    fireEvent.drop(targetItems[0], { altKey: true });
    await userEvent.keyboard("{/Alt}");

    await userEvent.click(screen.getAllByLabelText("Close pane")[0]);
    await navigateToNodeViaSearch(0, "Source");

    await expectTree(`
Source
  Child
  [I] Target
    `);

    await screen.findByLabelText(/decline Target/);
    await screen.findByLabelText(/Evidence for Target/);
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

describe("updateNodeItemMetadata", () => {
  test("updates argument on existing item", () => {
    const item = makeItem(
      "node1" as ID,
      "author" as PublicKey,
      "rel1" as LongID,
      undefined
    );

    const updated = updateNodeItemMetadata(item, { argument: "confirms" });
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

    const updated = updateNodeItemMetadata(item, { argument: undefined });
    expect(updated.argument).toBeUndefined();
  });

  test("returns unchanged node when metadata is empty", () => {
    const item = makeItem(
      "node1" as ID,
      "author" as PublicKey,
      "rel1" as LongID,
      undefined
    );

    const updated = updateNodeItemMetadata(item, {});
    expect(updated).toEqual(item);
  });
});
