import { cleanup, fireEvent, screen } from "@testing-library/react";
import { List, Map, OrderedSet } from "immutable";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  expectTree,
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
import { dnd, getDropDestinationFromTreeView } from "./dnd";
import {
  addRelationToRelations,
  createConcreteRefId,
  newNode,
  shortID,
} from "./connections";
import { NodeIndex, newRelations, viewPathToString } from "./ViewContext";
import {
  createPlan,
  planBulkUpsertNodes,
  planUpdateViews,
  planUpsertRelations,
} from "./planner";
import { newDB } from "./knowledge";

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

test("Diff items are always added, never moved", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const parent = newNode("Parent");
  const aliceChild = newNode("Alice's Child");
  const bobChild = newNode("Bob's Child");

  const aliceRelations = addRelationToRelations(
    newRelations(parent.id, List(), alicePK),
    aliceChild.id
  );
  const bobRelations = addRelationToRelations(
    newRelations(parent.id, List(), bobPK),
    bobChild.id
  );

  const knowledgeDBs = Map<PublicKey, KnowledgeData>()
    .set(alicePK, {
      nodes: newDB()
        .nodes.set(shortID(parent.id), parent)
        .set(shortID(aliceChild.id), aliceChild),
      relations: newDB().relations.set(
        shortID(aliceRelations.id),
        aliceRelations
      ),
    })
    .set(bobPK, {
      nodes: newDB().nodes.set(shortID(bobChild.id), bobChild),
      relations: newDB().relations.set(shortID(bobRelations.id), bobRelations),
    });

  const parentPath = [
    0,
    {
      nodeID: parent.id,
      nodeIndex: 0 as NodeIndex,
      relationsID: aliceRelations.id,
    },
  ] as const;

  const views = Map<string, View>().set(viewPathToString(parentPath), {
    expanded: true,
  });

  const panes = [{ id: "pane-0", stack: [parent.id], author: alicePK }];

  const plan = planUpdateViews(
    planUpsertRelations(
      planBulkUpsertNodes(
        createPlan({ ...alice(), knowledgeDBs, views, panes }),
        [parent, aliceChild]
      ),
      aliceRelations
    ),
    views
  );

  const diffItemPath = [
    0,
    {
      nodeID: parent.id,
      nodeIndex: 0 as NodeIndex,
      relationsID: aliceRelations.id,
    },
    { nodeID: bobChild.id, nodeIndex: 0 as NodeIndex, isDiffItem: true },
  ] as const;

  const result = dnd(
    plan,
    OrderedSet<string>(),
    viewPathToString(diffItemPath),
    parentPath,
    [parent.id], // stack
    0,
    undefined,
    true
  );

  const updatedRelations = result.knowledgeDBs
    .get(alicePK)
    ?.relations.get(shortID(aliceRelations.id));

  expect(updatedRelations?.items.size).toBe(2);
  const nodeIDs = updatedRelations?.items.map((item) => item.nodeID).toArray();
  expect(nodeIDs).toContain(bobChild.id);
  expect(nodeIDs).toContain(aliceChild.id);
});

test("Dragging a concrete reference keeps it as a reference by default", () => {
  const [alice] = setup([ALICE]);
  const { publicKey: alicePK } = alice().user;

  const root = newNode("Root");
  const target = newNode("Target");
  const refTarget = newNode("Ref Target");
  const refChild = newNode("Ref Child");

  const refRelations = addRelationToRelations(
    newRelations(refTarget.id, List([root.id]), alicePK),
    refChild.id
  );
  const concreteRefId = createConcreteRefId(refRelations.id);
  const rootRelations = addRelationToRelations(
    addRelationToRelations(
      newRelations(root.id, List(), alicePK),
      concreteRefId
    ),
    target.id
  );

  const rootPath = [
    0,
    {
      nodeID: root.id,
      nodeIndex: 0 as NodeIndex,
      relationsID: rootRelations.id,
    },
  ] as const;
  const sourcePath = [
    ...rootPath,
    { nodeID: concreteRefId, nodeIndex: 0 as NodeIndex },
  ] as const;

  const views = Map<string, View>().set(viewPathToString(rootPath), {
    expanded: true,
  });
  const panes = [{ id: "pane-0", stack: [root.id], author: alicePK }];
  const knowledgeDBs = Map<PublicKey, KnowledgeData>().set(alicePK, newDB());

  const plan = planUpdateViews(
    planUpsertRelations(
      planUpsertRelations(
        planBulkUpsertNodes(
          createPlan({ ...alice(), knowledgeDBs, panes, views }),
          [root, target, refTarget, refChild]
        ),
        rootRelations
      ),
      refRelations
    ),
    views
  );

  const result = dnd(
    plan,
    OrderedSet<string>(),
    viewPathToString(sourcePath),
    rootPath,
    [root.id],
    undefined,
    undefined,
    false
  );

  const updatedRootRelations = result.knowledgeDBs
    .get(alicePK)
    ?.relations.get(shortID(rootRelations.id));
  const nodeIDs = updatedRootRelations?.items
    .map((item) => item.nodeID)
    .toArray();

  expect(nodeIDs).toEqual([concreteRefId, target.id, concreteRefId]);
});

test("Alt-dragging a concrete reference still copies it as a reference", () => {
  const [alice] = setup([ALICE]);
  const { publicKey: alicePK } = alice().user;

  const root = newNode("Root");
  const target = newNode("Target");
  const refTarget = newNode("Ref Target");
  const refChild = newNode("Ref Child");

  const refRelations = addRelationToRelations(
    newRelations(refTarget.id, List([root.id]), alicePK),
    refChild.id
  );
  const concreteRefId = createConcreteRefId(refRelations.id);
  const rootRelations = addRelationToRelations(
    addRelationToRelations(
      newRelations(root.id, List(), alicePK),
      concreteRefId
    ),
    target.id
  );

  const rootPath = [
    0,
    {
      nodeID: root.id,
      nodeIndex: 0 as NodeIndex,
      relationsID: rootRelations.id,
    },
  ] as const;
  const sourcePath = [
    ...rootPath,
    { nodeID: concreteRefId, nodeIndex: 0 as NodeIndex },
  ] as const;

  const views = Map<string, View>().set(viewPathToString(rootPath), {
    expanded: true,
  });
  const panes = [{ id: "pane-0", stack: [root.id], author: alicePK }];
  const knowledgeDBs = Map<PublicKey, KnowledgeData>().set(alicePK, newDB());

  const plan = planUpdateViews(
    planUpsertRelations(
      planUpsertRelations(
        planBulkUpsertNodes(
          createPlan({ ...alice(), knowledgeDBs, panes, views }),
          [root, target, refTarget, refChild]
        ),
        rootRelations
      ),
      refRelations
    ),
    views
  );

  const result = dnd(
    plan,
    OrderedSet<string>(),
    viewPathToString(sourcePath),
    rootPath,
    [root.id],
    undefined,
    undefined,
    false,
    true
  );

  const updatedRootRelations = result.knowledgeDBs
    .get(alicePK)
    ?.relations.get(shortID(rootRelations.id));
  const nodeIDs = updatedRootRelations?.items
    .map((item) => item.nodeID)
    .toArray();

  expect(nodeIDs).toEqual([concreteRefId, target.id, concreteRefId]);
});

test("Alt-dragging a normal node creates a concrete reference", () => {
  const [alice] = setup([ALICE]);
  const { publicKey: alicePK } = alice().user;

  const root = newNode("Root");
  const sourceNode = newNode("Source");
  const target = newNode("Target");
  const rootRelations = addRelationToRelations(
    addRelationToRelations(
      newRelations(root.id, List(), alicePK),
      sourceNode.id
    ),
    target.id
  );

  const rootPath = [
    0,
    {
      nodeID: root.id,
      nodeIndex: 0 as NodeIndex,
      relationsID: rootRelations.id,
    },
  ] as const;
  const sourcePath = [
    ...rootPath,
    { nodeID: sourceNode.id, nodeIndex: 0 as NodeIndex },
  ] as const;

  const views = Map<string, View>().set(viewPathToString(rootPath), {
    expanded: true,
  });
  const panes = [{ id: "pane-0", stack: [root.id], author: alicePK }];
  const knowledgeDBs = Map<PublicKey, KnowledgeData>().set(alicePK, newDB());

  const plan = planUpdateViews(
    planUpsertRelations(
      planBulkUpsertNodes(
        createPlan({ ...alice(), knowledgeDBs, panes, views }),
        [root, sourceNode, target]
      ),
      rootRelations
    ),
    views
  );

  const result = dnd(
    plan,
    OrderedSet<string>(),
    viewPathToString(sourcePath),
    rootPath,
    [root.id],
    undefined,
    undefined,
    false,
    true
  );

  const updatedRootRelations = result.knowledgeDBs
    .get(alicePK)
    ?.relations.get(shortID(rootRelations.id));
  const nodeIDs = updatedRootRelations?.items
    .map((item) => item.nodeID)
    .toArray();

  expect(nodeIDs?.length).toBe(3);
  expect(nodeIDs?.[0]).toBe(sourceNode.id);
  expect(nodeIDs?.[1]).toBe(target.id);
  const refId = nodeIDs?.[2] as string;
  expect(refId.startsWith("cref:")).toBe(true);
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
Source
  Child1
  Child2
  [I] Target <<< Root
  `);
});

test("Deep copy preserves all children when forked duplicate relations exist", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);

  renderTree(bob);
  await type(
    "Holiday Destinations{Enter}{Tab}Spain{Enter}{Tab}Sevilla{Enter}Barcelona{Enter}Madrid{Enter}Granada{Escape}"
  );
  await expectTree(`
Holiday Destinations
  Spain
    Sevilla
    Barcelona
    Madrid
    Granada
  `);
  cleanup();

  renderTree(alice);
  await type(
    "Holiday Destinations{Enter}{Tab}Spain{Enter}{Tab}Valencia{Enter}Malaga{Escape}"
  );

  const versionEntries = await screen.findAllByLabelText(/in fullscreen/);
  const versionFullscreen = versionEntries[versionEntries.length - 1];
  await userEvent.click(versionFullscreen);

  await expectTree(`
[O] Spain
  [O] Sevilla
  [O] Barcelona
  [O] Madrid
  [O] Granada
  [VO] +2 -4
  `);

  await userEvent.click(
    await screen.findByLabelText("fork to make your own copy")
  );

  await expectTree(`
Spain
  Sevilla
  Barcelona
  Madrid
  Granada
  [V] +2 -4
  `);

  cleanup();

  renderApp(alice());

  await screen.findByLabelText("Navigate to Holiday Destinations");
  await userEvent.click(
    await screen.findByLabelText("Navigate to Holiday Destinations")
  );

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
  Sevilla
  Barcelona
  Madrid
  Granada
  [V] +2 -4
  `);

  const versionFullscreenBtns = await screen.findAllByLabelText(
    /open .* in fullscreen/
  );
  await userEvent.click(
    versionFullscreenBtns[versionFullscreenBtns.length - 1]
  );

  await expectTree(`
Spain
  Valencia
  Malaga
  [S] Sevilla
  [S] Barcelona
  [S] Madrid
  [V] +4 -2
  [VO] +4 -2
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
Spain
  Valencia
  Malaga
  [S] Sevilla
  [S] Barcelona
  [S] Madrid
  [V] +4 -2
  [VO] +4 -2
Target
  Spain
    Valencia
    Malaga
  `);
});

test("Incoming reference updates when source is moved (deep cleanup)", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Enter}{Tab}Barcelona{Enter}{Tab}Sagrada Familia{Escape}"
  );

  await userEvent.click(screen.getByLabelText("Open new pane"));
  await type("Cities in Spain{Enter}{Tab}Barcelona{Escape}");

  await userEvent.click(await screen.findByLabelText("expand Barcelona"));

  await expectTree(`
My Notes
  Holiday Destinations
    Spain
      Barcelona
        Sagrada Familia
        [C] Cities in Spain / Barcelona
Cities in Spain
  Barcelona
    [C] My Notes / Holiday Destinations / Spain / Barcelona
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
      [C] Cities in Spain / Barcelona
Cities in Spain
  Barcelona
    [C] My Notes / Spain / Barcelona
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

test("Bottom-half drop on last child of nested parent stays within that parent", () => {
  const [alice] = setup([ALICE]);
  const { publicKey: alicePK } = alice().user;

  const root = newNode("Holiday Destinations");
  const barcelona = newNode("Barcelona");
  const spain = newNode("Spain");
  const sevilla = newNode("Sevilla");
  const otherItem = newNode("Other Item");

  const spainRelations = addRelationToRelations(
    newRelations(spain.id, List([root.id]), alicePK),
    sevilla.id
  );
  const rootRelations = addRelationToRelations(
    addRelationToRelations(
      addRelationToRelations(
        newRelations(root.id, List(), alicePK),
        barcelona.id
      ),
      spain.id
    ),
    otherItem.id
  );

  const rootPath = [
    0,
    {
      nodeID: root.id,
      nodeIndex: 0 as NodeIndex,
      relationsID: rootRelations.id,
    },
  ] as const;

  const spainPath = [
    ...rootPath,
    {
      nodeID: spain.id,
      nodeIndex: 0 as NodeIndex,
      relationsID: spainRelations.id,
    },
  ] as const;

  const views = Map<string, View>()
    .set(viewPathToString(rootPath), {
      expanded: true,
    })
    .set(viewPathToString(spainPath), {
      expanded: true,
    });

  const panes = [{ id: "pane-0", stack: [root.id], author: alicePK }];
  const knowledgeDBs = Map<PublicKey, KnowledgeData>().set(alicePK, newDB());

  const plan = planUpdateViews(
    planUpsertRelations(
      planUpsertRelations(
        planBulkUpsertNodes(
          createPlan({ ...alice(), knowledgeDBs, panes, views }),
          [root, barcelona, spain, sevilla, otherItem]
        ),
        rootRelations
      ),
      spainRelations
    ),
    views
  );

  // Flat tree (excluding root):
  //   0: Barcelona
  //   1: Spain
  //   2: Sevilla (child of Spain)
  //   3: Other Item
  //
  // Bottom-half drop on Sevilla: destinationIndex = 3 (calcIndex(sevillaVisualIndex, -1))
  // Visual index 3 = Sevilla at flat index 2, so calcIndex(3, -1) = 4
  // In getDropDestinationFromTreeView, adjustedIndex = 4 - 1 = 3 = Other Item
  //
  // BUG: resolves to [rootPath, 2] (before Other Item in root),
  // should resolve to [spainPath, 1] (after Sevilla in Spain)

  const [toView, dropIndex] = getDropDestinationFromTreeView(
    plan,
    rootPath,
    [root.id],
    4,
    undefined,
    3
  );

  expect(viewPathToString(toView)).toBe(viewPathToString(spainPath));
  expect(dropIndex).toBe(1);
});

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setupDepthClampTree() {
  const [alice] = setup([ALICE]);
  const { publicKey: alicePK } = alice().user;

  const hd = newNode("Holiday Destinations");
  const sf = newNode("Sagrada Familia");
  const spain = newNode("Spain");
  const barcelona = newNode("Barcelona");
  const malaga = newNode("Malaga");
  const sevilla = newNode("Sevilla");

  const spainRelations = addRelationToRelations(
    addRelationToRelations(
      addRelationToRelations(
        newRelations(spain.id, List([hd.id]), alicePK),
        barcelona.id
      ),
      malaga.id
    ),
    sevilla.id
  );

  const hdRelations = addRelationToRelations(
    addRelationToRelations(newRelations(hd.id, List(), alicePK), sf.id),
    spain.id
  );

  const rootPath = [
    0,
    {
      nodeID: hd.id,
      nodeIndex: 0 as NodeIndex,
      relationsID: hdRelations.id,
    },
  ] as const;

  const sfPath = [
    ...rootPath,
    { nodeID: sf.id, nodeIndex: 0 as NodeIndex },
  ] as const;

  const spainPath = [
    ...rootPath,
    { nodeID: spain.id, nodeIndex: 0 as NodeIndex },
  ] as const;

  const spainPathWithRel = [
    ...rootPath,
    {
      nodeID: spain.id,
      nodeIndex: 0 as NodeIndex,
      relationsID: spainRelations.id,
    },
  ] as const;

  const barcelonaPath = [
    ...spainPathWithRel,
    { nodeID: barcelona.id, nodeIndex: 0 as NodeIndex },
  ] as const;

  const malagaPath = [
    ...spainPathWithRel,
    { nodeID: malaga.id, nodeIndex: 0 as NodeIndex },
  ] as const;

  const sevillaPath = [
    ...spainPathWithRel,
    { nodeID: sevilla.id, nodeIndex: 0 as NodeIndex },
  ] as const;

  const views = Map<string, View>()
    .set(viewPathToString(rootPath), {
      expanded: true,
    })
    .set(viewPathToString(spainPath), {
      expanded: true,
    });

  const panes = [{ id: "pane-0", stack: [hd.id], author: alicePK }];
  const knowledgeDBs = Map<PublicKey, KnowledgeData>().set(alicePK, newDB());

  const plan = planUpdateViews(
    planUpsertRelations(
      planUpsertRelations(
        planBulkUpsertNodes(
          createPlan({ ...alice(), knowledgeDBs, panes, views }),
          [hd, sf, spain, barcelona, malaga, sevilla]
        ),
        hdRelations
      ),
      spainRelations
    ),
    views
  );

  return {
    plan,
    rootPath,
    sfPath,
    spainPath,
    barcelonaPath,
    malagaPath,
    sevillaPath,
    hd,
  };
}

test("Depth clamp: HD bottom at depth 2 inserts before first child of HD", () => {
  const { plan, rootPath, hd } = setupDepthClampTree();
  const [toView, dropIndex] = getDropDestinationFromTreeView(
    plan,
    rootPath,
    [hd.id],
    1,
    undefined,
    2
  );
  expect(viewPathToString(toView)).toBe(viewPathToString(rootPath));
  expect(dropIndex).toBe(0);
});

test("Depth clamp: SF bottom at depth 2 inserts after SF in HD", () => {
  const { plan, rootPath, hd } = setupDepthClampTree();
  const [toView, dropIndex] = getDropDestinationFromTreeView(
    plan,
    rootPath,
    [hd.id],
    2,
    undefined,
    2
  );
  expect(viewPathToString(toView)).toBe(viewPathToString(rootPath));
  expect(dropIndex).toBe(1);
});

test("Depth clamp: SF bottom at depth 3 inserts as child of SF", () => {
  const { plan, rootPath, sfPath, hd } = setupDepthClampTree();
  const [toView, dropIndex] = getDropDestinationFromTreeView(
    plan,
    rootPath,
    [hd.id],
    2,
    undefined,
    3
  );
  expect(viewPathToString(toView)).toBe(viewPathToString(sfPath));
  expect(dropIndex).toBe(0);
});

test("Depth clamp: Spain bottom at depth 3 inserts as first child of Spain", () => {
  const { plan, rootPath, spainPath, hd } = setupDepthClampTree();
  const [toView, dropIndex] = getDropDestinationFromTreeView(
    plan,
    rootPath,
    [hd.id],
    3,
    undefined,
    3
  );
  expect(viewPathToString(toView)).toBe(viewPathToString(spainPath));
  expect(dropIndex).toBe(0);
});

test("Depth clamp: Barcelona bottom at depth 3 inserts after Barcelona in Spain", () => {
  const { plan, rootPath, spainPath, hd } = setupDepthClampTree();
  const [toView, dropIndex] = getDropDestinationFromTreeView(
    plan,
    rootPath,
    [hd.id],
    4,
    undefined,
    3
  );
  expect(viewPathToString(toView)).toBe(viewPathToString(spainPath));
  expect(dropIndex).toBe(1);
});

test("Depth clamp: Barcelona bottom at depth 4 inserts as child of Barcelona", () => {
  const { plan, rootPath, barcelonaPath, hd } = setupDepthClampTree();
  const [toView, dropIndex] = getDropDestinationFromTreeView(
    plan,
    rootPath,
    [hd.id],
    4,
    undefined,
    4
  );
  expect(viewPathToString(toView)).toBe(viewPathToString(barcelonaPath));
  expect(dropIndex).toBe(0);
});

test("Depth clamp: Malaga bottom at depth 3 inserts after Malaga in Spain", () => {
  const { plan, rootPath, spainPath, hd } = setupDepthClampTree();
  const [toView, dropIndex] = getDropDestinationFromTreeView(
    plan,
    rootPath,
    [hd.id],
    5,
    undefined,
    3
  );
  expect(viewPathToString(toView)).toBe(viewPathToString(spainPath));
  expect(dropIndex).toBe(2);
});

test("Depth clamp: Malaga bottom at depth 4 inserts as child of Malaga", () => {
  const { plan, rootPath, malagaPath, hd } = setupDepthClampTree();
  const [toView, dropIndex] = getDropDestinationFromTreeView(
    plan,
    rootPath,
    [hd.id],
    5,
    undefined,
    4
  );
  expect(viewPathToString(toView)).toBe(viewPathToString(malagaPath));
  expect(dropIndex).toBe(0);
});

test("Depth clamp: Sevilla bottom at depth 2 inserts after Spain in HD", () => {
  const { plan, rootPath, hd } = setupDepthClampTree();
  const [toView, dropIndex] = getDropDestinationFromTreeView(
    plan,
    rootPath,
    [hd.id],
    6,
    undefined,
    2
  );
  expect(viewPathToString(toView)).toBe(viewPathToString(rootPath));
  expect(dropIndex).toBe(2);
});

test("Depth clamp: Sevilla bottom at depth 3 inserts after Sevilla in Spain", () => {
  const { plan, rootPath, spainPath, hd } = setupDepthClampTree();
  const [toView, dropIndex] = getDropDestinationFromTreeView(
    plan,
    rootPath,
    [hd.id],
    6,
    undefined,
    3
  );
  expect(viewPathToString(toView)).toBe(viewPathToString(spainPath));
  expect(dropIndex).toBe(3);
});

test("Depth clamp: Sevilla bottom at depth 4 inserts as child of Sevilla", () => {
  const { plan, rootPath, sevillaPath, hd } = setupDepthClampTree();
  const [toView, dropIndex] = getDropDestinationFromTreeView(
    plan,
    rootPath,
    [hd.id],
    6,
    undefined,
    4
  );
  expect(viewPathToString(toView)).toBe(viewPathToString(sevillaPath));
  expect(dropIndex).toBe(0);
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
  [C] Root / Spain
  `);
});
