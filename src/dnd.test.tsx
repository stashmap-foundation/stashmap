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
} from "./utils.test";
import { dnd, getDropDestinationFromTreeView } from "./dnd";
import {
  addRelationToRelations,
  createAbstractRefId,
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
    viewingMode: undefined,
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
    viewingMode: undefined,
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
    viewingMode: undefined,
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

test("Alt-dragging a normal node creates a reference", () => {
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
    viewingMode: undefined,
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

  expect(nodeIDs).toEqual([
    sourceNode.id,
    target.id,
    createAbstractRefId(List([root.id]), sourceNode.id),
  ]);
});

test("Deep copy preserves all children when forked duplicate relations exist", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);

  renderTree(bob);
  await type(
    "Holiday Destinations{Enter}{Tab}Spain{Enter}{Tab}Sevilla{Enter}Barcelona{Enter}Madrid{Escape}"
  );
  await expectTree(`
Holiday Destinations
  Spain
    Sevilla
    Barcelona
    Madrid
  `);
  cleanup();

  renderTree(alice);
  await type(
    "Holiday Destinations{Enter}{Tab}Spain{Enter}{Tab}Valencia{Enter}Malaga{Escape}"
  );

  await userEvent.click(
    await screen.findByLabelText("show references to Spain")
  );

  await userEvent.click(
    await screen.findByLabelText("expand Holiday Destinations \u2192 Spain")
  );

  await expectTree(`
Holiday Destinations
  Spain
    Holiday Destinations \u2192 Spain
      Holiday Destinations \u2192 Spain (2)
      [O] Holiday Destinations \u2192 Spain (3)
  `);

  const fullscreenButtons = await screen.findAllByLabelText(
    /open Holiday Destinations . Spain \(\d+\) in fullscreen/
  );
  await userEvent.click(fullscreenButtons[1]);

  await expectTree(`
Spain
  Sevilla
  Barcelona
  Madrid
  `);

  await userEvent.click(
    await screen.findByLabelText("fork to make your own copy")
  );

  await expectTree(`
Spain
  Sevilla
  Barcelona
  Madrid
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
    await screen.findByLabelText("show references to Spain")
  );

  await userEvent.click(
    await screen.findByLabelText("expand Holiday Destinations \u2192 Spain")
  );

  await expectTree(`
Holiday Destinations
  Target
  Spain
    Holiday Destinations \u2192 Spain
      Holiday Destinations \u2192 Spain (3)
      Holiday Destinations \u2192 Spain (2)
      [O] Holiday Destinations \u2192 Spain (3)
  `);

  const openOldRef = await screen.findAllByLabelText(
    /open Holiday Destinations . Spain \(\d+\) in fullscreen/
  );
  await userEvent.click(openOldRef[1]);

  await expectTree(`
Spain
  Valencia
  Malaga
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
Target
  Spain
    Valencia
    Malaga
  `);
});

test("Same-pane move cleans up old descendant relations (no orphaned references)", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Root{Enter}{Tab}Source{Enter}{Tab}Parent{Enter}{Tab}GrandChild{Escape}"
  );

  await expectTree(`
Root
  Source
    Parent
      GrandChild
  `);

  await userEvent.click(
    await screen.findByLabelText("show references to GrandChild")
  );

  await expectTree(`
Root
  Source
    Parent
      GrandChild
        Root \u2192 Source \u2192 Parent (1) \u2192 GrandChild
  `);

  await userEvent.click(
    await screen.findByLabelText("hide references to GrandChild")
  );

  const splitPaneButtons = screen.getAllByLabelText("open in split pane");
  await userEvent.click(splitPaneButtons[0]);
  await navigateToNodeViaSearch(1, "Source");

  const parentItems = screen.getAllByRole("treeitem", { name: "Parent" });
  const rootToggle = screen.getAllByLabelText("collapse Root")[0];

  fireEvent.dragStart(parentItems[0]);
  fireEvent.drop(rootToggle);

  await expectTree(`
Root
  Parent
    GrandChild
  Source
Source
  `);

  await userEvent.click(
    screen.getAllByLabelText("show references to GrandChild")[0]
  );

  await expectTree(`
Root
  Parent
    GrandChild
      Root \u2192 Parent (1) \u2192 GrandChild
  Source
Source
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
      viewingMode: undefined,
      expanded: true,
    })
    .set(viewPathToString(spainPath), {
      viewingMode: undefined,
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
