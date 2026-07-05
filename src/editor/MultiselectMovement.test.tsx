import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  expectTree,
  navigateToNodeViaSearch,
  renderApp,
  setDropIndentLevel,
  setup,
  type,
} from "../utils.test";
import {
  clickRow,
  expectNoTargets,
  expectTargets,
  modClick,
} from "./Multiselect.testUtils";

describe("Drag and drop with selection", () => {
  test("dragging a selected row moves all selected rows", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}Target{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");

    fireEvent.dragStart(screen.getByText("A"));
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  C
  Target
  A
  B
    `);
  });

  test("dragging an unselected row only moves that row", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}Target{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");

    fireEvent.dragStart(screen.getByText("C"));
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  A
  B
  Target
  C
    `);
  });

  test("reorder selected rows within same parent", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");

    fireEvent.dragStart(screen.getByText("A"));
    setDropIndentLevel("A", "D", 2);
    fireEvent.drop(screen.getByRole("treeitem", { name: "D" }));

    await expectTree(`
Root
  C
  D
  A
  B
    `);
  });

  test("selection clears after DnD", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}Target{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");

    fireEvent.dragStart(screen.getByText("A"));
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectNoTargets();
  });

  test("Alt+drag selected rows creates references for all", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}Target{Escape}");

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");

    const targetItems = screen.getAllByRole("treeitem", { name: "Target" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    await userEvent.keyboard("{Alt>}");
    fireEvent.dragStart(screen.getAllByText("A")[0]);
    fireEvent.dragOver(targetInPane1, { altKey: true });
    fireEvent.drop(targetInPane1, { altKey: true });
    await userEvent.keyboard("{/Alt}");

    await expectTree(`
Root
  A
  B
  Target
Target
  [R] Root / A
  [R] Root / B
    `);
  });

  test("drag selected rows to different pane copies them", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}Target{Escape}");

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    const pane0Items = screen.getAllByLabelText("A");
    await userEvent.click(pane0Items[0]);
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");

    const targetItems = screen.getAllByRole("treeitem", { name: "Target" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    fireEvent.dragStart(screen.getAllByText("A")[0]);
    fireEvent.drop(targetInPane1);

    await expectTree(`
Root
  A
  B
  C
  Target
Target
  A
  B
    `);
  });

  test("non-contiguous selection (Cmd+click) reorders preserving original order", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");
    await clickRow("A");
    modClick(await screen.findByLabelText("C"), { metaKey: true });
    await expectTargets("A", "C");

    fireEvent.dragStart(screen.getByText("A"));
    setDropIndentLevel("A", "D", 2);
    fireEvent.drop(screen.getByRole("treeitem", { name: "D" }));

    await expectTree(`
Root
  B
  D
  A
  C
    `);
  });

  test("non-contiguous selection reverse click order still preserves DOM order", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");
    await clickRow("C");
    modClick(await screen.findByLabelText("A"), { metaKey: true });
    await expectTargets("A", "C");

    fireEvent.dragStart(screen.getByText("C"));
    setDropIndentLevel("C", "D", 2);
    fireEvent.drop(screen.getByRole("treeitem", { name: "D" }));

    await expectTree(`
Root
  B
  D
  A
  C
    `);
  });

  test("three non-contiguous children reorder correctly", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Enter}E{Enter}F{Escape}"
    );
    await clickRow("A");
    modClick(await screen.findByLabelText("C"), { metaKey: true });
    modClick(await screen.findByLabelText("E"), { metaKey: true });
    await expectTargets("A", "C", "E");

    fireEvent.dragStart(screen.getByText("A"));
    setDropIndentLevel("A", "F", 2);
    fireEvent.drop(screen.getByRole("treeitem", { name: "F" }));

    await expectTree(`
Root
  B
  D
  F
  A
  C
  E
    `);
  });

  test("cross-depth selection: dragging parent only moves parent-level siblings", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}{Enter}B{Escape}");

    await expectTree(`
Root
  A
    A1
  B
    `);

    await clickRow("A");
    await userEvent.keyboard("{Shift>}jj{/Shift}");
    await expectTargets("A", "A1", "B");

    fireEvent.dragStart(screen.getByText("A"));
    fireEvent.drop(screen.getByLabelText("collapse Root"));

    await expectTree(`
Root
  A
    A1
  B
    `);
  });

  test("cross-depth selection: all selected children move even from different parents", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}A2{Enter}{Enter}B{Enter}{Tab}B1{Enter}B2{Escape}"
    );

    await expectTree(`
Root
  A
    A1
    A2
  B
    B1
    B2
    `);

    await clickRow("A1");
    await userEvent.keyboard("{Shift>}jjjj{/Shift}");
    await expectTargets("A1", "A2", "B", "B1", "B2");

    fireEvent.dragStart(screen.getByText("A1"));
    setDropIndentLevel("A1", "B2", 2);
    fireEvent.drop(screen.getByRole("treeitem", { name: "B2" }));

    await expectTree(`
Root
  A
  A1
  A2
  B
    B1
    B2
    `);
  });

  test("drop selected parent onto its own descendant is prevented", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}{Tab}Deep{Enter}{Enter}{Enter}B{Escape}"
    );

    await expectTree(`
Root
  A
    A1
      Deep
  B
    `);

    await clickRow("A");
    await userEvent.keyboard("{Shift>}jjj{/Shift}");
    await expectTargets("A", "A1", "Deep", "B");

    fireEvent.dragStart(screen.getByText("A"));
    fireEvent.drop(screen.getByRole("treeitem", { name: "Deep" }));

    await expectTree(`
Root
  A
    A1
      Deep
  B
    `);
  });

  test("dragged item descendants are grayed during drag", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}{Enter}B{Escape}");

    await clickRow("A");
    modClick(await screen.findByLabelText("B"), { metaKey: true });
    await expectTargets("A", "B");

    fireEvent.dragStart(screen.getByText("A"));

    /* eslint-disable testing-library/no-node-access */
    const a1Item = screen
      .getByText("A1")
      .closest('.item[data-row-focusable="true"]');
    expect(a1Item?.classList.contains("is-dragging-child")).toBe(true);

    const bItem = screen
      .getByText("B")
      .closest('.item[data-row-focusable="true"]');
    expect(bItem?.classList.contains("is-dragging-child")).toBe(false);
    /* eslint-enable testing-library/no-node-access */
  });

  test("multi-select move to different parent preserves order", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}{Enter}Target{Escape}");

    await expectTree(`
Root
  A
  B
  C
  Target
    `);

    await clickRow("A");
    await userEvent.keyboard("{Shift>}jj{/Shift}");
    await expectTargets("A", "B", "C");

    fireEvent.dragStart(screen.getByText("A"));
    setDropIndentLevel("A", "Target", 3);
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  Target
    A
    B
    C
    `);
  });
});

describe("Cross-depth DnD edge cases", () => {
  test("cross-pane drag with cross-depth selection copies all selected children", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}Parent{Enter}{Tab}Deep{Enter}{Enter}Shallow{Enter}Last{Escape}"
    );

    await expectTree(`
Root
  Parent
    Deep
  Shallow
  Last
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Last");

    await clickRow("Deep");
    await userEvent.keyboard("{Shift>}jj{/Shift}");
    await expectTargets("Deep", "Shallow", "Last");

    const targetItems = screen.getAllByRole("treeitem", { name: "Last" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    fireEvent.dragStart(screen.getAllByText("Deep")[0]);
    fireEvent.drop(targetInPane1);

    await expectTree(`
Root
  Parent
    Deep
  Shallow
  Last
Last
  Deep
  Shallow
  Last
    `);
  });

  test("same-pane move with cross-depth selection moves all selected children", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}Parent{Enter}{Tab}Deep{Enter}{Enter}Shallow{Enter}Target{Escape}"
    );

    await expectTree(`
Root
  Parent
    Deep
  Shallow
  Target
    `);

    await clickRow("Deep");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("Deep", "Shallow");

    fireEvent.dragStart(screen.getByText("Deep"));
    setDropIndentLevel("Deep", "Target", 3);
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  Parent
  Target
    Deep
    Shallow
    `);
  });

  test("cross-depth Cmd+click selection: cross-pane drag copies all", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}Parent{Enter}{Tab}Deep{Enter}{Enter}Shallow{Escape}"
    );

    await expectTree(`
Root
  Parent
    Deep
  Shallow
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Shallow");

    const deepElements = screen.getAllByLabelText("Deep");
    const shallowElements = screen.getAllByLabelText("Shallow");
    modClick(deepElements[0], { metaKey: true });
    modClick(shallowElements[0], { metaKey: true });
    await expectTargets("Deep", "Shallow");

    const targetItems = screen.getAllByRole("treeitem", { name: "Shallow" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    fireEvent.dragStart(screen.getAllByText("Deep")[0]);
    fireEvent.drop(targetInPane1);

    await expectTree(`
Root
  Parent
    Deep
  Shallow
Shallow
  Deep
  Shallow
    `);
  });

  test("cross-depth selection: Alt+drag creates references for all levels", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}Parent{Enter}{Tab}Deep{Enter}{Enter}Shallow{Enter}Target{Escape}"
    );

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    await clickRow("Deep");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("Deep", "Shallow");

    const targetItems = screen.getAllByRole("treeitem", { name: "Target" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    await userEvent.keyboard("{Alt>}");
    fireEvent.dragStart(screen.getAllByText("Deep")[0]);
    fireEvent.dragOver(targetInPane1, { altKey: true });
    fireEvent.drop(targetInPane1, { altKey: true });
    await userEvent.keyboard("{/Alt}");

    await expectTree(`
Root
  Parent
    Deep
  Shallow
  Target
Target
  [R] Root / Parent / Deep
  [R] Root / Shallow
    `);
  });

  test("three levels deep: drag deepest with shallow siblings to other pane", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}A{Enter}{Tab}B{Enter}{Tab}C{Enter}{Enter}{Enter}D{Escape}"
    );

    await expectTree(`
Root
  A
    B
      C
  D
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "D");

    await clickRow("C");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("C", "D");

    const targetItems = screen.getAllByRole("treeitem", { name: "D" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    fireEvent.dragStart(screen.getAllByText("C")[0]);
    fireEvent.drop(targetInPane1);

    await expectTree(`
Root
  A
    B
      C
  D
D
  C
  D
    `);
  });

  test("same-pane move: sparse Cmd+click at different depths", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}{Enter}B{Enter}{Tab}B1{Enter}{Enter}Target{Escape}"
    );

    await expectTree(`
Root
  A
    A1
  B
    B1
  Target
    `);

    modClick(await screen.findByLabelText("A1"), { metaKey: true });
    modClick(await screen.findByLabelText("B1"), { metaKey: true });
    await expectTargets("A1", "B1");

    fireEvent.dragStart(screen.getByText("A1"));
    setDropIndentLevel("A1", "Target", 3);
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  A
  B
  Target
    A1
    B1
    `);
  });

  test("cross-depth drag: descendant check prevents drop into own child", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}Parent{Enter}{Tab}Child{Enter}{Enter}Sibling{Escape}"
    );

    await expectTree(`
Root
  Parent
    Child
  Sibling
    `);

    await clickRow("Parent");
    await userEvent.keyboard("{Shift>}jj{/Shift}");
    await expectTargets("Parent", "Child", "Sibling");

    fireEvent.dragStart(screen.getByText("Parent"));
    fireEvent.drop(screen.getByRole("treeitem", { name: "Child" }));

    await expectTree(`
Root
  Parent
    Child
  Sibling
    `);
  });

  test("cross-depth selection same-pane move to expanded parent", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}Source{Enter}{Tab}SDeep{Enter}{Enter}Target{Enter}{Tab}Existing{Escape}"
    );

    await expectTree(`
Root
  Source
    SDeep
  Target
    Existing
    `);

    await clickRow("SDeep");
    modClick(await screen.findByLabelText("Source"), { metaKey: true });
    await expectTargets("Source", "SDeep");

    fireEvent.dragStart(screen.getByText("SDeep"));
    setDropIndentLevel("SDeep", "Existing", 3);
    fireEvent.drop(screen.getByRole("treeitem", { name: "Existing" }));

    await expectTree(`
Root
  Target
    Existing
    Source
      SDeep
    `);
  });

  test("cross-pane drag: children from 3 different parents", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}{Enter}B{Enter}{Tab}B1{Enter}{Enter}C{Enter}{Tab}C1{Escape}"
    );

    await expectTree(`
Root
  A
    A1
  B
    B1
  C
    C1
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "C1");

    const a1Elements = screen.getAllByLabelText("A1");
    const b1Elements = screen.getAllByLabelText("B1");
    modClick(a1Elements[0], { metaKey: true });
    modClick(b1Elements[0], { metaKey: true });
    await expectTargets("A1", "B1");

    const targetItems = screen.getAllByRole("treeitem", { name: "C1" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    fireEvent.dragStart(screen.getAllByText("A1")[0]);
    fireEvent.drop(targetInPane1);

    await expectTree(`
Root
  A
    A1
  B
    B1
  C
    C1
C1
  A1
  B1
    `);
  });

  test("cross-depth reorder: siblings at same level reorder normally", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");

    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");

    fireEvent.dragStart(screen.getByText("A"));
    setDropIndentLevel("A", "D", 2);
    fireEvent.drop(screen.getByRole("treeitem", { name: "D" }));

    await expectTree(`
Root
  C
  D
  A
  B
    `);
  });

  test("cross-depth selection: Shift+j through hierarchy then same-pane move", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}P{Enter}{Tab}P1{Enter}P2{Enter}{Enter}Q{Enter}Target{Escape}"
    );

    await expectTree(`
Root
  P
    P1
    P2
  Q
  Target
    `);

    await clickRow("P1");
    await userEvent.keyboard("{Shift>}jj{/Shift}");
    await expectTargets("P1", "P2", "Q");

    fireEvent.dragStart(screen.getByText("P1"));
    setDropIndentLevel("P1", "Target", 3);
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  P
  Target
    P1
    P2
    Q
    `);
  });

  test("cross-depth selection: move deep children to root container", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}A2{Enter}{Enter}B{Escape}"
    );

    await expectTree(`
Root
  A
    A1
    A2
  B
    `);

    await clickRow("A1");
    await userEvent.keyboard("{Shift>}jj{/Shift}");
    await expectTargets("A1", "A2", "B");

    fireEvent.dragStart(screen.getByText("A1"));
    fireEvent.drop(screen.getByLabelText("collapse Root"));

    await expectTree(`
Root
  A1
  A2
  A
  B
    `);
  });

  test("cross-pane: parent+child selection copies only parent (child follows)", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}Parent{Enter}{Tab}Deep{Enter}{Enter}Target{Escape}"
    );

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    modClick(await screen.findByLabelText("Parent"), { metaKey: true });
    modClick(await screen.findByLabelText("Deep"), { metaKey: true });
    await expectTargets("Parent", "Deep");

    const targetItems = screen.getAllByRole("treeitem", { name: "Target" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    fireEvent.dragStart(screen.getAllByText("Parent")[0]);
    fireEvent.drop(targetInPane1);

    await expectTree(`
Root
  Parent
    Deep
  Target
Target
  Parent
    Deep
    `);
  });

  test("cross-pane: non-contiguous selection at varied depths copies in DOM order", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}{Enter}B{Enter}{Tab}B1{Escape}"
    );

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "B1");

    const aElements = screen.getAllByLabelText("A");
    const b1Elements = screen.getAllByLabelText("B1");
    modClick(aElements[0], { metaKey: true });
    modClick(b1Elements[0], { metaKey: true });
    await expectTargets("A", "B1");

    const targetItems = screen.getAllByRole("treeitem", { name: "B1" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    fireEvent.dragStart(screen.getAllByText("A")[0]);
    fireEvent.drop(targetInPane1);

    await expectTree(`
Root
  A
    A1
  B
    B1
B1
  A
    A1
  B1
    `);
  });

  test("cross-depth move: children from sibling branches move to target", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}X{Enter}{Tab}X1{Enter}{Enter}Y{Enter}{Tab}Y1{Enter}{Enter}Z{Escape}"
    );

    await expectTree(`
Root
  X
    X1
  Y
    Y1
  Z
    `);

    modClick(await screen.findByLabelText("X1"), { metaKey: true });
    modClick(await screen.findByLabelText("Y1"), { metaKey: true });
    await expectTargets("X1", "Y1");

    fireEvent.dragStart(screen.getByText("X1"));
    setDropIndentLevel("X1", "Z", 3);
    fireEvent.drop(screen.getByRole("treeitem", { name: "Z" }));

    await expectTree(`
Root
  X
  Y
  Z
    X1
    Y1
    `);
  });

  test("cross-depth drag moves children from different parents to target", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}{Enter}B{Enter}Target{Escape}"
    );

    await expectTree(`
Root
  A
    A1
  B
  Target
    `);

    await clickRow("A1");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A1", "B");

    fireEvent.dragStart(screen.getByText("A1"));
    setDropIndentLevel("A1", "Target", 3);
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  A
  Target
    A1
    B
    `);
  });
});

describe("Batch indent (Tab) with selection", () => {
  test("Tab indents all selected siblings into previous sibling", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");
    await clickRow("B");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("B", "C");
    await userEvent.keyboard("{Tab}");
    await expectTree(`
Root
  A
    B
    C
  D
    `);
  });

  test("Tab preserves order of selected children", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");
    await clickRow("C");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("C", "D");
    await userEvent.keyboard("{Tab}");
    await expectTree(`
Root
  A
  B
    C
    D
    `);
  });

  test("Tab does nothing when first selected is first child", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");
    await userEvent.keyboard("{Tab}");
    await expectTree(`
Root
  A
  B
  C
    `);
  });

  test("Tab does nothing when selection spans different parents", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}A1{Enter}B{Escape}");
    await clickRow("A1");
    await userEvent.keyboard("{Tab}");
    await expectTree(`
Root
  A
    A1
  B
    `);
    await clickRow("A1");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A1", "B");
    await userEvent.keyboard("{Tab}");
    await expectTree(`
Root
  A
    A1
  B
    `);
  });

  test("Tab preserves selection after indent", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("B");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("B", "C");
    await userEvent.keyboard("{Tab}");
    await expectTargets("B", "C");
  });

  test("Shift+Tab right after Tab outdents on first press", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("B");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("B", "C");

    await userEvent.keyboard("{Tab}");
    await expectTree(`
Root
  A
    B
    C
    `);
    await expectTargets("B", "C");

    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expectTree(`
Root
  A
  B
  C
    `);
    await expectTargets("B", "C");
  });

  test("Tab indents single selected row", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await clickRow("B");
    await expectTargets("B");
    await userEvent.keyboard("{Tab}");
    await expectTree(`
Root
  A
    B
    `);
  });

  test("Tab expands collapsed previous sibling", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}A1{Enter}B{Escape}");
    await clickRow("A1");
    await userEvent.keyboard("{Tab}");
    await expectTree(`
Root
  A
    A1
  B
    `);
    await userEvent.click(await screen.findByLabelText("collapse A"));
    await expectTree(`
Root
  A
  B
    `);
    await clickRow("B");
    await userEvent.keyboard("{Tab}");
    await expectTree(`
Root
  A
    A1
    B
    `);
  });
});

describe("Batch outdent (Shift+Tab) with selection", () => {
  test("Shift+Tab outdents all selected siblings to grandparent", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}B{Enter}C{Enter}D{Escape}");
    await clickRow("B");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("B", "C");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expectTree(`
Root
  A
    D
  B
  C
    `);
  });

  test("Shift+Tab preserves order of selected children", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}B{Enter}C{Enter}D{Escape}");
    await clickRow("C");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("C", "D");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expectTree(`
Root
  A
    B
  C
  D
    `);
  });

  test("Shift+Tab does nothing when parent is root-level", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expectTree(`
Root
  A
  B
  C
    `);
  });

  test("Shift+Tab preserves selection after outdent", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}B{Enter}C{Escape}");
    await clickRow("B");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("B", "C");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expectTargets("B", "C");
  });

  test("Shift+Tab outdents single selected row", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}B{Escape}");
    await clickRow("B");
    await expectTargets("B");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expectTree(`
Root
  A
  B
    `);
  });

  test("Shift+Tab inserts after parent in grandparent", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}X{Enter}Y{Escape}");
    await userEvent.keyboard("{Escape}");
    await clickRow("X");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("X", "Y");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expectTree(`
Root
  A
  X
  Y
    `);
  });

  test("Shift+Tab does nothing when selection spans different parents", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}{Escape}");
    await userEvent.keyboard("{Escape}");
    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "A1");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expectTree(`
Root
  A
    A1
    `);
  });
});

describe("View state preservation - multiselect DnD", () => {
  test("move expanded children - both stay expanded", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Escape}");
    await userEvent.click(await screen.findByLabelText("collapse A"));
    await userEvent.click(await screen.findByLabelText("edit A"));
    await userEvent.keyboard("{Enter}");
    await type("B{Enter}{Tab}B1{Escape}");
    await userEvent.click(await screen.findByLabelText("expand A"));
    await userEvent.click(await screen.findByLabelText("collapse B"));
    await userEvent.click(await screen.findByLabelText("edit B"));
    await userEvent.keyboard("{Enter}");
    await type("Target{Escape}");
    await userEvent.click(await screen.findByLabelText("expand B"));

    await expectTree(`
Root
  A
    A1
  B
    B1
  Target
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse B");

    await clickRow("A");
    modClick(await screen.findByLabelText("B"), { metaKey: true });
    await expectTargets("A", "B");

    fireEvent.dragStart(screen.getByText("A"));
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  Target
  A
    A1
  B
    B1
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse B");
  });

  test("non-selected sibling expanded state preserved after multi-move", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}B{Enter}{Tab}B1{Escape}");
    await userEvent.click(await screen.findByLabelText("collapse B"));
    await userEvent.click(await screen.findByLabelText("edit B"));
    await userEvent.keyboard("{Enter}");
    await type("C{Enter}Target{Escape}");
    await userEvent.click(await screen.findByLabelText("expand B"));

    await expectTree(`
Root
  A
  B
    B1
  C
  Target
    `);
    await screen.findByLabelText("collapse B");

    await clickRow("A");
    modClick(await screen.findByLabelText("C"), { metaKey: true });
    await expectTargets("A", "C");

    fireEvent.dragStart(screen.getByText("A"));
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  B
    B1
  Target
  A
  C
    `);
    await screen.findByLabelText("collapse B");
  });

  test("move expanded item with deep descendants preserves all levels", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Enter}{Tab}A1a{Escape}");
    await userEvent.click(await screen.findByLabelText("collapse A"));
    await userEvent.click(await screen.findByLabelText("edit A"));
    await userEvent.keyboard("{Enter}");
    await type("B{Enter}Target{Escape}");
    await userEvent.click(await screen.findByLabelText("expand A"));

    await expectTree(`
Root
  A
    A1
      A1a
  B
  Target
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse A1");

    await clickRow("A");
    modClick(await screen.findByLabelText("B"), { metaKey: true });
    await expectTargets("A", "B");

    fireEvent.dragStart(screen.getByText("A"));
    fireEvent.drop(screen.getByRole("treeitem", { name: "Target" }));

    await expectTree(`
Root
  Target
  A
    A1
      A1a
  B
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse A1");
  });

  test("cross-pane copy of multi-selection preserves expanded state", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}A{Enter}{Tab}A1{Escape}");
    await userEvent.click(await screen.findByLabelText("collapse A"));
    await userEvent.click(await screen.findByLabelText("edit A"));
    await userEvent.keyboard("{Enter}");
    await type("B{Enter}{Tab}B1{Escape}");
    await userEvent.click(await screen.findByLabelText("expand A"));
    await userEvent.click(await screen.findByLabelText("collapse B"));
    await userEvent.click(await screen.findByLabelText("edit B"));
    await userEvent.keyboard("{Enter}");
    await type("Target{Escape}");
    await userEvent.click(await screen.findByLabelText("expand B"));

    await expectTree(`
Root
  A
    A1
  B
    B1
  Target
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse B");

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Target");

    const pane0Items = screen.getAllByLabelText("A");
    await userEvent.click(pane0Items[0]);
    modClick(screen.getAllByLabelText("B")[0], { metaKey: true });

    const targetItems = screen.getAllByRole("treeitem", { name: "Target" });
    const targetInPane1 = targetItems[targetItems.length - 1];

    fireEvent.dragStart(screen.getAllByText("A")[0]);
    fireEvent.drop(targetInPane1);

    await screen.findByText(/syncing/);
    await screen.findByText("synced");

    const collapseA = screen.getAllByLabelText("collapse A");
    expect(collapseA.length).toBeGreaterThanOrEqual(2);
    const collapseB = screen.getAllByLabelText("collapse B");
    expect(collapseB.length).toBeGreaterThanOrEqual(2);
  });
});

describe("View state preservation - multiselect Tab indent", () => {
  test("Tab indent expanded children - both stay expanded", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}Prev{Enter}A{Enter}{Tab}A1{Escape}");
    await userEvent.click(await screen.findByLabelText("collapse A"));
    await userEvent.click(await screen.findByLabelText("edit A"));
    await userEvent.keyboard("{Enter}");
    await type("B{Enter}{Tab}B1{Escape}");
    await userEvent.click(await screen.findByLabelText("expand A"));

    await expectTree(`
Root
  Prev
  A
    A1
  B
    B1
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse B");

    await clickRow("A");
    modClick(await screen.findByLabelText("B"), { metaKey: true });
    await expectTargets("A", "B");
    await userEvent.keyboard("{Tab}");

    await expectTree(`
Root
  Prev
    A
      A1
    B
      B1
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse B");
  });

  test("Tab indent preserves non-selected sibling expanded state", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}Prev{Enter}{Tab}P1{Escape}");
    await userEvent.click(await screen.findByLabelText("collapse Prev"));
    await userEvent.click(await screen.findByLabelText("edit Prev"));
    await userEvent.keyboard("{Enter}");
    await type("A{Enter}B{Escape}");
    await userEvent.click(await screen.findByLabelText("expand Prev"));

    await expectTree(`
Root
  Prev
    P1
  A
  B
    `);
    await screen.findByLabelText("collapse Prev");

    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");
    await userEvent.keyboard("{Tab}");

    await expectTree(`
Root
  Prev
    P1
    A
    B
    `);
    await screen.findByLabelText("collapse Prev");
  });

  test("Tab indent item with deep descendants preserves all levels", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type(
      "Root{Enter}{Tab}Prev{Enter}A{Enter}{Tab}A1{Enter}{Tab}A1a{Escape}"
    );

    await expectTree(`
Root
  Prev
  A
    A1
      A1a
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse A1");

    await clickRow("A");
    await userEvent.keyboard("{Tab}");

    await expectTree(`
Root
  Prev
    A
      A1
        A1a
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse A1");
  });
});

describe("View state preservation - multiselect Shift+Tab outdent", () => {
  test("Shift+Tab outdent expanded children - both stay expanded", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}Parent{Enter}{Tab}A{Enter}{Tab}A1{Escape}");
    await userEvent.click(await screen.findByLabelText("collapse A"));
    await userEvent.click(await screen.findByLabelText("edit A"));
    await userEvent.keyboard("{Enter}");
    await type("B{Enter}{Tab}B1{Escape}");
    await userEvent.click(await screen.findByLabelText("expand A"));

    await expectTree(`
Root
  Parent
    A
      A1
    B
      B1
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse B");

    await clickRow("A");
    modClick(await screen.findByLabelText("B"), { metaKey: true });
    await expectTargets("A", "B");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");

    await expectTree(`
Root
  Parent
  A
    A1
  B
    B1
    `);
    await screen.findByLabelText("collapse A");
    await screen.findByLabelText("collapse B");
  });

  test("Shift+Tab outdent preserves remaining sibling expanded state", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());
    await type("Root{Enter}{Tab}Parent{Enter}{Tab}Stay{Enter}{Tab}S1{Escape}");
    await userEvent.click(await screen.findByLabelText("collapse Stay"));
    await userEvent.click(await screen.findByLabelText("edit Stay"));
    await userEvent.keyboard("{Enter}");
    await type("A{Enter}B{Escape}");
    await userEvent.click(await screen.findByLabelText("expand Stay"));

    await expectTree(`
Root
  Parent
    Stay
      S1
    A
    B
    `);
    await screen.findByLabelText("collapse Stay");

    await clickRow("A");
    await userEvent.keyboard("{Shift>}j{/Shift}");
    await expectTargets("A", "B");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");

    await expectTree(`
Root
  Parent
    Stay
      S1
  A
  B
    `);
    await screen.findByLabelText("collapse Stay");
  });
});
