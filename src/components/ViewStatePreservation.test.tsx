import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  expectTree,
  findNewNodeEditor,
  navigateToNodeViaSearch,
  renderApp,
  renderTree,
  setup,
} from "../utils.test";

async function deleteItem(itemName: string, _parentName: string): Promise<void> {
  fireEvent.click(screen.getByLabelText(`mark ${itemName} as not relevant`));
  await waitFor(() => {
    expect(screen.queryByText(itemName)).toBeNull();
  });
  await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));
  await screen.findByText(itemName);
  fireEvent.click(screen.getByLabelText(`remove ${itemName} from list`));
  await waitFor(() => {
    expect(screen.queryByText(itemName)).toBeNull();
  });
}

describe("View State Preservation - Reorder Within Same List", () => {
  test("Move expanded item down - item stays expanded", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const rootEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(rootEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "A{Enter}B{Enter}C{Escape}"
    );

    await userEvent.click(await screen.findByLabelText("expand A"));
    await userEvent.click(await screen.findByLabelText("add to A"));
    await userEvent.type(await findNewNodeEditor(), "ChildOfA{Escape}");

    await expectTree(`
My Notes
  A
    ChildOfA
  B
  C
    `);

    await screen.findByLabelText("collapse A");

    fireEvent.dragStart(screen.getByText("A"));
    fireEvent.drop(screen.getByText("C"));

    await expectTree(`
My Notes
  B
  A
    ChildOfA
  C
    `);

    await screen.findByLabelText("collapse A");
  });

  test("Move expanded item up - item stays expanded", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const rootEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(rootEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "A{Enter}B{Enter}C{Escape}"
    );

    await userEvent.click(await screen.findByLabelText("expand C"));
    await userEvent.click(await screen.findByLabelText("add to C"));
    await userEvent.type(await findNewNodeEditor(), "ChildOfC{Escape}");

    await expectTree(`
My Notes
  A
  B
  C
    ChildOfC
    `);

    await screen.findByLabelText("collapse C");

    fireEvent.dragStart(screen.getByText("C"));
    fireEvent.drop(screen.getByText("A"));

    await expectTree(`
My Notes
  C
    ChildOfC
  A
  B
    `);

    await screen.findByLabelText("collapse C");
  });

  test("Move collapsed item - siblings with expanded state preserved", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const rootEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(rootEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "A{Enter}B{Enter}C{Escape}"
    );

    await userEvent.click(await screen.findByLabelText("expand A"));
    await userEvent.click(await screen.findByLabelText("add to A"));
    await userEvent.type(await findNewNodeEditor(), "ChildOfA{Escape}");

    await userEvent.click(await screen.findByLabelText("expand C"));
    await userEvent.click(await screen.findByLabelText("add to C"));
    await userEvent.type(await findNewNodeEditor(), "ChildOfC{Escape}");

    await expectTree(`
My Notes
  A
    ChildOfA
  B
  C
    ChildOfC
    `);

    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse C");

    fireEvent.dragStart(screen.getByText("B"));
    fireEvent.drop(screen.getByText("A"));

    await expectTree(`
My Notes
  B
  A
    ChildOfA
  C
    ChildOfC
    `);

    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse C");
  });

  test("Move item with expanded children and grandchildren", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const rootEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(rootEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "A{Enter}B{Enter}{Tab}Child{Enter}{Tab}GrandChild{Escape}"
    );

    await expectTree(`
My Notes
  A
  B
    Child
      GrandChild
    `);

    await screen.findByLabelText("collapse B");
    await screen.findByLabelText("collapse Child");

    fireEvent.dragStart(screen.getByText("B"));
    fireEvent.drop(screen.getByText("A"));

    await expectTree(`
My Notes
  B
    Child
      GrandChild
  A
    `);

    await screen.findByLabelText("collapse B");
    await screen.findByLabelText("collapse Child");
  });
});

describe("View State Preservation - Indent/Outdent (Tab/Shift+Tab)", () => {
  test("Tab indent expanded item - stays expanded", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const rootEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(rootEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Sibling{Enter}Target{Escape}"
    );

    await userEvent.click(await screen.findByLabelText("expand Target"));
    await userEvent.click(await screen.findByLabelText("add to Target"));
    await userEvent.type(await findNewNodeEditor(), "Child{Escape}");

    await expectTree(`
My Notes
  Sibling
  Target
    Child
    `);

    await screen.findByLabelText("collapse Target");

    const targetEditor = await screen.findByLabelText("edit Target");
    await userEvent.click(targetEditor);
    await userEvent.keyboard("{Home}{Tab}");

    await expectTree(`
My Notes
  Sibling
    Target
      Child
    `);

    await screen.findByLabelText("collapse Target");
  });

  test("Tab indent with deeply nested expanded descendants", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const rootEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(rootEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Sibling{Enter}Parent{Enter}{Tab}Child{Enter}{Tab}GrandChild{Escape}"
    );

    await expectTree(`
My Notes
  Sibling
  Parent
    Child
      GrandChild
    `);

    await screen.findByLabelText("collapse Parent");
    await screen.findByLabelText("collapse Child");

    const parentEditor = await screen.findByLabelText("edit Parent");
    await userEvent.click(parentEditor);
    await userEvent.keyboard("{Home}{Tab}");

    await expectTree(`
My Notes
  Sibling
    Parent
      Child
        GrandChild
    `);

    await screen.findByLabelText("collapse Parent");
    await screen.findByLabelText("collapse Child");
  });

  test("Tab indent preserves sibling expanded states", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const rootEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(rootEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "A{Enter}B{Enter}C{Escape}"
    );

    await userEvent.click(await screen.findByLabelText("expand A"));
    await userEvent.click(await screen.findByLabelText("add to A"));
    await userEvent.type(await findNewNodeEditor(), "ChildOfA{Escape}");

    await userEvent.click(await screen.findByLabelText("expand C"));
    await userEvent.click(await screen.findByLabelText("add to C"));
    await userEvent.type(await findNewNodeEditor(), "ChildOfC{Escape}");

    await expectTree(`
My Notes
  A
    ChildOfA
  B
  C
    ChildOfC
    `);

    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse C");

    const bEditor = await screen.findByLabelText("edit B");
    await userEvent.click(bEditor);
    await userEvent.keyboard("{Home}{Tab}");

    await expectTree(`
My Notes
  A
    ChildOfA
    B
  C
    ChildOfC
    `);

    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse C");
  });
});

describe("View State Preservation - Cross-Pane DnD (Copy)", () => {
  test("Cross-pane copy of expanded item preserves expanded state", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    const rootEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(rootEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Source{Enter}{Tab}Child{Escape}"
    );

    await userEvent.click(await screen.findByLabelText("collapse Source"));
    const sourceEditor = await screen.findByLabelText("edit Source");
    await userEvent.click(sourceEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Target{Escape}");
    await userEvent.click(await screen.findByLabelText("expand Source"));
    await userEvent.click(await screen.findByLabelText("expand Target"));

    await expectTree(`
My Notes
  Source
    Child
  Target
    `);

    await screen.findByLabelText("collapse Source");

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    const targetElements = screen
      .getAllByText("Target")
      .filter((el) => el.closest(".item"));
    fireEvent.dragStart(screen.getAllByText("Source")[0]);
    fireEvent.drop(targetElements[1]);

    const collapseButtons = screen.getAllByLabelText("collapse Source");
    expect(collapseButtons.length).toBeGreaterThanOrEqual(2);
  });

  test("Cross-pane copy of deeply nested expanded tree", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    const rootEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(rootEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Parent{Enter}{Tab}Child{Enter}{Tab}GrandChild{Escape}"
    );

    await userEvent.click(await screen.findByLabelText("collapse Parent"));
    const parentEditor = await screen.findByLabelText("edit Parent");
    await userEvent.click(parentEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Target{Escape}");
    await userEvent.click(await screen.findByLabelText("expand Parent"));
    await userEvent.click(await screen.findByLabelText("expand Target"));

    await expectTree(`
My Notes
  Parent
    Child
      GrandChild
  Target
    `);

    await screen.findByLabelText("collapse Parent");
    await screen.findByLabelText("collapse Child");

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    const targetElements = screen
      .getAllByText("Target")
      .filter((el) => el.closest(".item"));
    fireEvent.dragStart(screen.getAllByText("Parent")[0]);
    fireEvent.drop(targetElements[1]);

    const collapseParentButtons = screen.getAllByLabelText("collapse Parent");
    expect(collapseParentButtons.length).toBeGreaterThanOrEqual(2);

    const collapseChildButtons = screen.getAllByLabelText("collapse Child");
    expect(collapseChildButtons.length).toBeGreaterThanOrEqual(2);
  });

  test("Cross-pane copy doesn't affect source expanded states", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    const rootEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(rootEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Source{Enter}{Tab}Child{Escape}"
    );

    await userEvent.click(await screen.findByLabelText("collapse Source"));
    const sourceEditor = await screen.findByLabelText("edit Source");
    await userEvent.click(sourceEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Target{Escape}");
    await userEvent.click(await screen.findByLabelText("expand Source"));
    await userEvent.click(await screen.findByLabelText("expand Target"));

    await expectTree(`
My Notes
  Source
    Child
  Target
    `);

    await screen.findByLabelText("collapse Source");

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    const targetElements = screen
      .getAllByText("Target")
      .filter((el) => el.closest(".item"));
    fireEvent.dragStart(screen.getAllByText("Source")[0]);
    fireEvent.drop(targetElements[1]);

    const collapseSourceButtons = screen.getAllByLabelText("collapse Source");
    expect(collapseSourceButtons.length).toBeGreaterThanOrEqual(2);
  });
});

describe("View State Preservation - Insert Operations", () => {
  test("Insert at beginning - later expanded items stay expanded", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const rootEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(rootEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "A{Enter}{Tab}ChildOfA{Escape}"
    );

    await expectTree(`
My Notes
  A
    ChildOfA
    `);

    await screen.findByLabelText("collapse A");

    await userEvent.click(await screen.findByLabelText("add to My Notes"));
    await userEvent.type(await findNewNodeEditor(), "New{Escape}");

    fireEvent.dragStart(screen.getByText("New"));
    fireEvent.drop(screen.getByText("A"));

    await expectTree(`
My Notes
  New
  A
    ChildOfA
    `);

    await screen.findByLabelText("collapse A");
  });

  test("Insert in middle - items after stay expanded", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const rootEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(rootEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "A{Enter}B{Enter}{Tab}ChildOfB{Escape}"
    );

    await expectTree(`
My Notes
  A
  B
    ChildOfB
    `);

    await screen.findByLabelText("collapse B");

    const aEditor = await screen.findByLabelText("edit A");
    await userEvent.click(aEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "New{Escape}");

    await expectTree(`
My Notes
  A
  New
  B
    ChildOfB
    `);

    await screen.findByLabelText("collapse B");
  });

  test("Insert child - parent's other expanded children stay expanded", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const rootEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(rootEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Parent{Enter}{Tab}A{Enter}{Tab}ChildOfA{Escape}"
    );

    await expectTree(`
My Notes
  Parent
    A
      ChildOfA
    `);

    await screen.findByLabelText("collapse A");

    await userEvent.click(await screen.findByLabelText("add to Parent"));
    await userEvent.type(await findNewNodeEditor(), "New{Escape}");

    await expectTree(`
My Notes
  Parent
    New
    A
      ChildOfA
    `);

    await screen.findByLabelText("collapse A");
  });
});

describe("View State Preservation - Delete Operations", () => {
  test("Delete item before expanded item - expanded item stays expanded", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const rootEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(rootEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "ToDelete{Enter}Keeper{Enter}{Tab}Child{Escape}"
    );

    await expectTree(`
My Notes
  ToDelete
  Keeper
    Child
    `);

    await screen.findByLabelText("collapse Keeper");

    await deleteItem("ToDelete", "My Notes");

    await expectTree(`
My Notes
  Keeper
    Child
    `);

    await screen.findByLabelText("collapse Keeper");
  });

  test("Delete item after expanded item - expanded item stays expanded", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const rootEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(rootEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Keeper{Enter}{Tab}Child{Escape}"
    );

    await userEvent.click(await screen.findByLabelText("collapse Keeper"));
    const keeperEditor = await screen.findByLabelText("edit Keeper");
    await userEvent.click(keeperEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "ToDelete{Escape}");
    await userEvent.click(await screen.findByLabelText("expand Keeper"));

    await expectTree(`
My Notes
  Keeper
    Child
  ToDelete
    `);

    await screen.findByLabelText("collapse Keeper");

    await deleteItem("ToDelete", "My Notes");

    await expectTree(`
My Notes
  Keeper
    Child
    `);

    await screen.findByLabelText("collapse Keeper");
  });

  test("Delete sibling - other siblings keep expanded state", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const rootEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(rootEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "A{Enter}ToDelete{Enter}C{Escape}"
    );

    await userEvent.click(await screen.findByLabelText("expand A"));
    await userEvent.click(await screen.findByLabelText("add to A"));
    await userEvent.type(await findNewNodeEditor(), "ChildOfA{Escape}");

    await userEvent.click(await screen.findByLabelText("expand C"));
    await userEvent.click(await screen.findByLabelText("add to C"));
    await userEvent.type(await findNewNodeEditor(), "ChildOfC{Escape}");

    await expectTree(`
My Notes
  A
    ChildOfA
  ToDelete
  C
    ChildOfC
    `);

    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse C");

    await deleteItem("ToDelete", "My Notes");

    await expectTree(`
My Notes
  A
    ChildOfA
  C
    ChildOfC
    `);

    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse C");
  });
});

describe("View State Preservation - Complex Tree Operations", () => {
  test("Move parent - all descendant expanded states preserved", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const rootEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(rootEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Target{Enter}Source{Enter}{Tab}L1{Enter}{Tab}L2{Enter}{Tab}L3{Escape}"
    );

    await userEvent.click(await screen.findByLabelText("expand Target"));

    await expectTree(`
My Notes
  Target
  Source
    L1
      L2
        L3
    `);

    await screen.findByLabelText("collapse Source");
    await screen.findByLabelText("collapse L1");
    await screen.findByLabelText("collapse L2");

    const sourceEditor = await screen.findByLabelText("edit Source");
    await userEvent.click(sourceEditor);
    await userEvent.keyboard("{Home}{Tab}");

    await expectTree(`
My Notes
  Target
    Source
      L1
        L2
          L3
    `);

    await screen.findByLabelText("collapse Source");
    await screen.findByLabelText("collapse L1");
    await screen.findByLabelText("collapse L2");
  });

  test("Multiple operations preserve state", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const rootEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(rootEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "A{Enter}B{Enter}C{Escape}"
    );

    await userEvent.click(await screen.findByLabelText("expand A"));
    await userEvent.click(await screen.findByLabelText("add to A"));
    await userEvent.type(await findNewNodeEditor(), "ChildOfA{Escape}");

    await userEvent.click(await screen.findByLabelText("expand B"));
    await userEvent.click(await screen.findByLabelText("add to B"));
    await userEvent.type(await findNewNodeEditor(), "ChildOfB{Escape}");

    await expectTree(`
My Notes
  A
    ChildOfA
  B
    ChildOfB
  C
    `);

    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse B");

    fireEvent.dragStart(screen.getByText("C"));
    fireEvent.drop(screen.getByText("A"));

    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse B");

    await userEvent.click(await screen.findByLabelText("add to B"));
    await userEvent.type(await findNewNodeEditor(), "NewChild{Escape}");

    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse B");

    fireEvent.dragStart(screen.getByText("A"));
    fireEvent.drop(screen.getByText("B"));

    await expectTree(`
My Notes
  C
  A
    ChildOfA
  B
    NewChild
    ChildOfB
    `);

    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse B");
  });

  test("Reorder after reload preserves expanded states", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    const rootEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(rootEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "A{Enter}B{Enter}C{Escape}"
    );

    await userEvent.click(await screen.findByLabelText("expand A"));
    await userEvent.click(await screen.findByLabelText("add to A"));
    await userEvent.type(await findNewNodeEditor(), "ChildOfA{Escape}");

    await userEvent.click(await screen.findByLabelText("expand C"));
    await userEvent.click(await screen.findByLabelText("add to C"));
    await userEvent.type(await findNewNodeEditor(), "ChildOfC{Escape}");

    await expectTree(`
My Notes
  A
    ChildOfA
  B
  C
    ChildOfC
    `);

    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse C");

    cleanup();
    renderTree(alice);

    await expectTree(`
My Notes
  A
    ChildOfA
  B
  C
    ChildOfC
    `);

    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse C");

    fireEvent.dragStart(screen.getByText("B"));
    fireEvent.drop(screen.getByText("A"));

    await expectTree(`
My Notes
  B
  A
    ChildOfA
  C
    ChildOfC
    `);

    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse C");
  });
});
