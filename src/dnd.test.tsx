import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  expectTree,
  forkReadonlyRoot,
  findNewNodeEditor,
  follow,
  navigateToNodeViaSearch,
  renderApp,
  renderTree,
  setup,
  type,
  setDropIndentLevel,
  expectIndentationLimits,
} from "./utils.test";

test("Drag node within tree view", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);

  await type("Root{Enter}Item A{Enter}Item B{Enter}Item C{Escape}");

  await expectTree(`
Root
  Item A
  Item B
  Item C
  `);

  const itemC = screen.getByText("Item C");
  const root = screen.getByLabelText("Root");

  fireEvent.dragStart(itemC);
  fireEvent.drop(root);

  await expectTree(`
Root
  Item C
  Item A
  Item B
  `);
});

test("Same-pane drag to different parent moves node", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Root{Enter}Parent{Enter}{Tab}Child A{Enter}Draggable Item{Escape}"
  );

  await expectTree(`
Root
  Parent
    Child A
    Draggable Item
  `);

  const splitPaneButtons = screen.getAllByLabelText("open in split pane");
  await userEvent.click(splitPaneButtons[0]);

  await navigateToNodeViaSearch(1, "Parent");

  const collapseParentButtons = await screen.findAllByLabelText(
    "collapse Parent"
  );
  expect(collapseParentButtons.length).toBe(2);

  const draggableItems = screen.getAllByText("Draggable Item");
  const rootToggle = screen.getAllByLabelText("collapse Root")[0];

  fireEvent.dragStart(draggableItems[0]);
  fireEvent.drop(rootToggle);

  await expectTree(`
Root
  Draggable Item
  Parent
    Child A
Parent
  Child A
  `);
});

test("Alt-dragged concrete ref survives move and shows children", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type("Root{Enter}Source{Enter}Target{Enter}OtherParent{Escape}");

  await expectTree(`
Root
  Source
  Target
  OtherParent
  `);

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await navigateToNodeViaSearch(1, "Target");

  const targetTreeItems = screen.getAllByRole("treeitem", { name: "Target" });
  const targetInPane1 = targetTreeItems[targetTreeItems.length - 1];

  await userEvent.keyboard("{Alt>}");
  fireEvent.dragStart(screen.getAllByText("Source")[0]);
  fireEvent.dragOver(targetInPane1, { altKey: true });
  fireEvent.drop(targetInPane1, { altKey: true });
  await userEvent.keyboard("{/Alt}");

  await expectTree(`
Root
  Source
  Target
  OtherParent
Target
  [R] Root / Source
  `);

  cleanup();
  renderApp(alice());

  await expectTree(`
Root
  Source
  Target
  OtherParent
Target
  [R] Root / Source
  `);

  const source = screen.getAllByRole("treeitem", { name: "Source" })[0];
  const otherParent = screen.getAllByRole("treeitem", {
    name: "OtherParent",
  })[0];
  fireEvent.dragStart(source);
  setDropIndentLevel("Source", "OtherParent", 3);
  fireEvent.dragOver(otherParent);
  fireEvent.drop(otherParent);

  await expectTree(`
Root
  Target
  OtherParent
    Source
Target
  [R] Root / OtherParent / Source
  `);

  await userEvent.click(await screen.findByLabelText("edit Source"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(
    await findNewNodeEditor(),
    "{Tab}Child1{Enter}Child2{Escape}"
  );

  await expectTree(`
Root
  Target
  OtherParent
    Source
      Child1
      Child2
      [I] Target <<< Root
Target
  [R] Root / OtherParent / Source
  `);

  await userEvent.click(
    await screen.findByLabelText(
      "open Root / OtherParent / Source in fullscreen"
    )
  );

  await expectTree(`
Root
  Target
  OtherParent
    Source
      Child1
      Child2
      [I] Target <<< Root
OtherParent
  Source
  `);
});

test("Deep copy preserves all children when forked duplicate nodes exist", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);

  renderTree(alice);
  await type(
    "Holiday Destinations{Enter}{Tab}Spain{Enter}{Tab}Valencia{Enter}Malaga{Escape}"
  );
  cleanup();

  await forkReadonlyRoot(bob(), alice().user.publicKey, "Holiday Destinations");
  await userEvent.click(
    await screen.findByLabelText("open Spain in fullscreen")
  );
  await userEvent.click(await screen.findByLabelText("edit Spain"));
  await userEvent.keyboard("{Enter}");
  await type("Sevilla{Enter}Barcelona{Enter}Madrid{Enter}Granada{Escape}");
  cleanup();

  renderApp({
    ...alice(),
    initialRoute: "/n/Holiday%20Destinations",
  });
  await userEvent.click(
    await screen.findByLabelText("open Spain in fullscreen")
  );

  await expectTree(`
Spain
  Valencia
  Malaga
  [S] Sevilla
  [S] Barcelona
  [S] Madrid
  [VO] +4
  `);

  cleanup();
  renderApp({
    ...alice(),
    initialRoute: "/n/Holiday%20Destinations",
  });

  await userEvent.click(
    await screen.findByLabelText("edit Holiday Destinations")
  );
  await userEvent.keyboard("{Enter}");
  await userEvent.type(await findNewNodeEditor(), "Target{Escape}");

  await userEvent.click(
    await screen.findByLabelText("open Spain in fullscreen")
  );

  await expectTree(`
Spain
  Valencia
  Malaga
  [S] Sevilla
  [S] Barcelona
  [S] Madrid
  [VO] +4
  `);

  const versionFullscreenBtns = await screen.findAllByLabelText(
    /open .* \+4 in fullscreen/
  );
  await userEvent.click(versionFullscreenBtns[0]);

  await expectTree(`
[O] Spain
  [O] Sevilla
  [O] Barcelona
  [O] Madrid
  [O] Granada
  [O] Valencia
  [O] Malaga
  [VO] -4
  `);

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await navigateToNodeViaSearch(1, "Target");

  const spainTreeItems = screen.getAllByRole("treeitem", { name: "Spain" });
  const targetDropTargets = screen.getAllByRole("treeitem", { name: "Target" });
  fireEvent.dragStart(spainTreeItems[0]);
  fireEvent.drop(targetDropTargets[targetDropTargets.length - 1]);

  const expandButtons = await screen.findAllByLabelText("expand Spain");
  await userEvent.click(expandButtons[expandButtons.length - 1]);

  await expectTree(`
[O] Spain
  [O] Sevilla
  [O] Barcelona
  [O] Madrid
  [O] Granada
  [O] Valencia
  [O] Malaga
  [VO] -4
Target
  Spain
    Sevilla
    Barcelona
    Madrid
    Granada
    Valencia
    Malaga
    [V] -4
  `);
});

test("Drag node onto expanded sibling's child moves it", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Holiday Destinations{Enter}Barcelona{Enter}Spain{Enter}{Tab}Sevilla{Escape}"
  );

  await expectTree(`
Holiday Destinations
  Barcelona
  Spain
    Sevilla
  `);

  const barcelona = screen.getByText("Barcelona");
  const spain = screen.getByText("Spain");

  fireEvent.dragStart(barcelona);
  fireEvent.drop(spain);

  await expectTree(`
Holiday Destinations
  Spain
    Barcelona
    Sevilla
  `);
});

test("search result path updates when source is moved", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Enter}{Tab}Barcelona{Enter}{Tab}Sagrada Familia{Escape}"
  );

  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );
  await userEvent.type(
    await screen.findByLabelText("search input"),
    "Barcelona{Enter}"
  );

  await expectTree(`
Search: Barcelona
  [R] My Notes / Holiday Destinations / Spain / Barcelona
  `);

  await userEvent.click(await screen.findByLabelText("Navigate to Log"));
  await userEvent.click(await screen.findByLabelText("Navigate to My Notes"));

  const myNotesFullscreenButtons = screen.queryAllByLabelText(
    "open My Notes in fullscreen"
  );
  if (myNotesFullscreenButtons.length > 0) {
    await userEvent.click(
      myNotesFullscreenButtons[myNotesFullscreenButtons.length - 1]
    );
  }

  await expectTree(`
My Notes
  Holiday Destinations
    Spain
      Barcelona
        Sagrada Familia
  `);

  const spain = screen.getByRole("treeitem", { name: "Spain" });
  const hdToggle = screen.getByLabelText("collapse Holiday Destinations");
  fireEvent.dragStart(spain);
  fireEvent.drop(hdToggle);

  await expectTree(`
My Notes
  Holiday Destinations
  Spain
    Barcelona
      Sagrada Familia
  `);

  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );
  await userEvent.type(
    await screen.findByLabelText("search input"),
    "Barcelona{Enter}"
  );

  await expectTree(`
Search: Barcelona
  [R] My Notes / Spain / Barcelona
  `);
});

test("Depth drop: depth 3 on collapsed sibling inserts as its child", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type("Root{Enter}Target{Enter}Sibling{Enter}Draggable{Escape}");

  await expectTree(`
Root
  Target
  Sibling
  Draggable
  `);

  const draggable = screen.getByRole("treeitem", { name: "Draggable" });
  const target = screen.getByRole("treeitem", { name: "Target" });

  expectIndentationLimits("Draggable", "Target").toBe(2, 3);
  fireEvent.dragStart(draggable);
  setDropIndentLevel("Draggable", "Target", 3);
  fireEvent.drop(target);

  await expectTree(`
Root
  Target
    Draggable
  Sibling
  `);
});

test("Depth drop: depth 2 on last item outdents to root level", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Holiday Destinations{Enter}Spain{Enter}{Tab}Barcelona{Enter}Malaga{Enter}Draggable{Escape}"
  );

  await expectTree(`
Holiday Destinations
  Spain
    Barcelona
    Malaga
    Draggable
  `);

  const draggable = screen.getByRole("treeitem", { name: "Draggable" });
  const malaga = screen.getByRole("treeitem", { name: "Malaga" });

  expectIndentationLimits("Draggable", "Malaga").toBe(2, 4);
  fireEvent.dragStart(draggable);
  setDropIndentLevel("Draggable", "Malaga", 2);
  fireEvent.drop(malaga);

  await expectTree(`
Holiday Destinations
  Spain
    Barcelona
    Malaga
  Draggable
  `);
});

test("Depth drop: depth 4 inserts as child of a leaf node", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Holiday Destinations{Enter}Spain{Enter}{Tab}Barcelona{Enter}Malaga{Enter}Draggable{Escape}"
  );

  await expectTree(`
Holiday Destinations
  Spain
    Barcelona
    Malaga
    Draggable
  `);

  const draggable = screen.getByRole("treeitem", { name: "Draggable" });
  const barcelona = screen.getByRole("treeitem", { name: "Barcelona" });

  expectIndentationLimits("Draggable", "Barcelona").toBe(3, 4);
  fireEvent.dragStart(draggable);
  setDropIndentLevel("Draggable", "Barcelona", 4);
  fireEvent.drop(barcelona);

  await expectTree(`
Holiday Destinations
  Spain
    Barcelona
      Draggable
    Malaga
  `);
});

test("Depth drop: expanded parent forces child depth", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type("Root{Enter}Draggable{Enter}Spain{Enter}{Tab}Barcelona{Escape}");

  await expectTree(`
Root
  Draggable
  Spain
    Barcelona
  `);

  const draggable = screen.getByRole("treeitem", { name: "Draggable" });
  const spain = screen.getByRole("treeitem", { name: "Spain" });

  expectIndentationLimits("Draggable", "Spain").toBe(3, 3);
  fireEvent.dragStart(draggable);
  setDropIndentLevel("Draggable", "Spain", 3);
  fireEvent.drop(spain);

  await expectTree(`
Root
  Spain
    Draggable
    Barcelona
  `);
});

test("Depth drop: last item at shallowest depth inserts after parent", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Holiday Destinations{Enter}Spain{Enter}{Tab}Barcelona{Enter}Sevilla{Escape}"
  );

  await expectTree(`
Holiday Destinations
  Spain
    Barcelona
    Sevilla
  `);

  const sevilla = screen.getByRole("treeitem", { name: "Sevilla" });
  const barcelona = screen.getByRole("treeitem", { name: "Barcelona" });

  expectIndentationLimits("Sevilla", "Barcelona").toBe(2, 4);
  fireEvent.dragStart(sevilla);
  setDropIndentLevel("Sevilla", "Barcelona", 2);
  fireEvent.drop(barcelona);

  await expectTree(`
Holiday Destinations
  Spain
    Barcelona
  Sevilla
  `);
});

test("Depth drop: deeply nested last item outdents three levels to root", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Root{Enter}A{Enter}{Tab}B{Enter}{Tab}C{Enter}{Tab}Draggable{Escape}"
  );

  await expectTree(`
Root
  A
    B
      C
        Draggable
  `);

  const draggable = screen.getByRole("treeitem", { name: "Draggable" });
  const c = screen.getByRole("treeitem", { name: "C" });

  expectIndentationLimits("Draggable", "C").toBe(2, 5);
  fireEvent.dragStart(draggable);
  setDropIndentLevel("Draggable", "C", 2);
  fireEvent.drop(c);

  await expectTree(`
Root
  A
    B
      C
  Draggable
  `);
});

test("Move expanded node onto sibling keeps it as sibling", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type("My Notes{Enter}A{Enter}{Tab}ChildOfA{Escape}");

  await userEvent.click(await screen.findByLabelText("collapse A"));
  await userEvent.click(await screen.findByLabelText("edit A"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(await findNewNodeEditor(), "B{Enter}C{Escape}");

  await userEvent.click(await screen.findByLabelText("expand A"));

  await expectTree(`
My Notes
  A
    ChildOfA
  B
  C
  `);

  expectIndentationLimits("A", "C").toBe(2, 3);
  fireEvent.dragStart(screen.getByText("A"));
  fireEvent.drop(screen.getByText("C"));

  await expectTree(`
My Notes
  B
  C
  A
    ChildOfA
  `);
});

test("Move expanded node with children onto previous sibling stays as sibling", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Root{Enter}First{Enter}Second{Enter}{Tab}Child1{Enter}Child2{Escape}"
  );

  await expectTree(`
Root
  First
  Second
    Child1
    Child2
  `);

  expectIndentationLimits("Second", "First").toBe(2, 3);
  fireEvent.dragStart(screen.getByText("Second"));
  fireEvent.drop(screen.getByText("First"));

  await expectTree(`
Root
  First
  Second
    Child1
    Child2
  `);
});

test("Outdent expanded node past its own children to root level", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Root{Enter}Parent{Enter}{Tab}Draggable{Enter}{Tab}DeepChild{Escape}"
  );

  await expectTree(`
Root
  Parent
    Draggable
      DeepChild
  `);

  const draggable = screen.getByRole("treeitem", { name: "Draggable" });
  const parent = screen.getByRole("treeitem", { name: "Parent" });

  expectIndentationLimits("Draggable", "Parent").toBe(2, 3);
  fireEvent.dragStart(draggable);
  setDropIndentLevel("Draggable", "Parent", 2);
  fireEvent.drop(parent);

  await expectTree(`
Root
  Parent
  Draggable
    DeepChild
  `);
});

test("Drag last child onto previous sibling outdents past parent", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Holiday Destinations{Enter}Barcelona{Enter}{Tab}Sagrada Familia{Escape}"
  );
  await userEvent.click(await screen.findByLabelText("collapse Barcelona"));
  await userEvent.click(await screen.findByLabelText("edit Barcelona"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(
    await findNewNodeEditor(),
    "Spain{Enter}{Tab}Malaga{Enter}Sevilla{Enter}{Tab}Beach{Escape}"
  );

  await expectTree(`
Holiday Destinations
  Barcelona
  Spain
    Malaga
    Sevilla
      Beach
  `);

  const sevilla = screen.getByRole("treeitem", { name: "Sevilla" });
  const malaga = screen.getByRole("treeitem", { name: "Malaga" });

  expectIndentationLimits("Sevilla", "Malaga").toBe(2, 4);
  fireEvent.dragStart(sevilla);
  setDropIndentLevel("Sevilla", "Malaga", 2);
  fireEvent.drop(malaga);

  await expectTree(`
Holiday Destinations
  Barcelona
  Spain
    Malaga
  Sevilla
    Beach
  `);
});

test("Cannot drag a parent into its own child or grandchild", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Root{Enter}Parent{Enter}{Tab}Child{Enter}{Tab}GrandChild{Escape}"
  );

  await expectTree(`
Root
  Parent
    Child
      GrandChild
  `);

  const parent = screen.getByRole("treeitem", { name: "Parent" });
  const child = screen.getByRole("treeitem", { name: "Child" });
  const grandChild = screen.getByRole("treeitem", { name: "GrandChild" });

  expectIndentationLimits("Parent", "Child").toBe(2, 4);
  fireEvent.dragStart(parent);
  fireEvent.drop(child);

  await expectTree(`
Root
  Parent
    Child
      GrandChild
  `);

  expectIndentationLimits("Parent", "GrandChild").toBe(2, 5);
  fireEvent.dragStart(parent);
  fireEvent.drop(grandChild);

  await expectTree(`
Root
  Parent
    Child
      GrandChild
  `);
});

test("Cross-pane drag to same parent copies instead of reordering", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type("Root{Enter}Item A{Enter}Item B{Enter}Item C{Escape}");

  await expectTree(`
Root
  Item A
  Item B
  Item C
  `);

  const splitPaneButtons = screen.getAllByLabelText("open in split pane");
  await userEvent.click(splitPaneButtons[0]);
  await navigateToNodeViaSearch(1, "Root");

  const collapseButtons = await screen.findAllByLabelText("collapse Root");
  expect(collapseButtons.length).toBe(2);

  const itemCElements = screen.getAllByRole("treeitem", { name: "Item C" });
  const rootElements = screen.getAllByLabelText("collapse Root");

  fireEvent.dragStart(itemCElements[0]);
  fireEvent.drop(rootElements[1]);

  await expectTree(`
Root
  Item C
  Item A
  Item B
  Item C
Root
  Item C
  Item A
  Item B
  Item C
  `);
});

test("Drag node into empty split pane navigates that pane to the node", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type("Root{Enter}Spain{Enter}France{Escape}");

  await expectTree(`
Root
  Spain
  France
  `);

  await userEvent.click(screen.getByLabelText("Open new pane"));

  const emptyTreeItems = await screen.findAllByRole("treeitem", { name: "" });
  const dropTarget = emptyTreeItems[emptyTreeItems.length - 1];

  fireEvent.dragStart(screen.getByText("Spain"));
  fireEvent.drop(dropTarget);

  await expectTree(`
Root
  Spain
  France
Spain
  `);
});

test("Drag node with children into empty pane shows children", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type("Root{Enter}Spain{Enter}{Tab}Barcelona{Enter}Madrid{Escape}");

  await expectTree(`
Root
  Spain
    Barcelona
    Madrid
  `);

  await userEvent.click(screen.getByLabelText("Open new pane"));

  const emptyTreeItems = await screen.findAllByRole("treeitem", { name: "" });
  const dropTarget = emptyTreeItems[emptyTreeItems.length - 1];

  fireEvent.dragStart(screen.getByText("Spain"));
  fireEvent.drop(dropTarget);

  await expectTree(`
Root
  Spain
    Barcelona
    Madrid
Spain
  Barcelona
  Madrid
  `);
});
