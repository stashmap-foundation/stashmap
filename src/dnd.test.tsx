import { fireEvent, screen } from "@testing-library/react";
import { List, Map, OrderedSet } from "immutable";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  expectTree,
  findNewNodeEditor,
  navigateToNodeViaSearch,
  renderApp,
  renderTree,
  setup,
  type,
} from "./utils.test";
import { dnd } from "./dnd";
import { addRelationToRelations, newNode, shortID } from "./connections";
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
  const itemA = screen.getByText("Item A");

  fireEvent.dragStart(itemC);
  fireEvent.drop(itemA);

  await expectTree(`
Root
  Item C
  Item A
  Item B
  `);
});

test("Drag between split panes", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type("Root{Enter}Parent{Escape}");

  await userEvent.click(await screen.findByLabelText("expand Parent"));
  await userEvent.click(await screen.findByLabelText("edit Parent"));
  await userEvent.keyboard("{Enter}");
  await userEvent.type(await findNewNodeEditor(), "Child A{Enter}");
  await userEvent.type(await findNewNodeEditor(), "Draggable Item{Escape}");

  await expectTree(`
Root
  Parent
    Child A
    Draggable Item
  `);

  const splitPaneButtons = screen.getAllByLabelText("open in split pane");
  await userEvent.click(splitPaneButtons[0]);

  await navigateToNodeViaSearch(1, "Parent");

  await screen.findByLabelText("collapse Parent");

  const draggableItems = screen.getAllByText("Draggable Item");
  const rootToggle = screen.getAllByLabelText("collapse Root")[0];

  fireEvent.dragStart(draggableItems[0]);
  fireEvent.drop(rootToggle);

  const allDraggableItems = screen.getAllByText("Draggable Item");
  expect(allDraggableItems.length).toBeGreaterThanOrEqual(2);
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
