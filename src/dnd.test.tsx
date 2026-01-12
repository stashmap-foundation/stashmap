import { fireEvent, screen } from "@testing-library/react";
import { List, Map, OrderedSet } from "immutable";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  extractNodes,
  findNodeByText,
  renderApp,
  setup,
  setupTestDB,
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
  const db = await setupTestDB(alice(), [
    ["My Workspace", ["Item A", "Item B", "Item C"]],
  ]);

  const ws = findNodeByText(db, "My Workspace") as KnowNode;
  renderApp({
    ...alice(),
    initialRoute: `/w/${ws.id}`,
  });

  await screen.findByText("Item A");
  await screen.findByText("Item B");
  await screen.findByText("Item C");

  expect(extractNodes(document.body)).toEqual(["Item A", "Item B", "Item C"]);

  // Drag Item C to before Item A
  const itemC = screen.getByText("Item C");
  const itemA = screen.getByText("Item A");

  fireEvent.dragStart(itemC);
  fireEvent.drop(itemA);

  // Item C should now be first
  expect(extractNodes(document.body)).toEqual(["Item C", "Item A", "Item B"]);
});

test("Drag between split panes", async () => {
  const [alice] = setup([ALICE]);
  const db = await setupTestDB(alice(), [
    ["My Workspace", ["Item A", "Item B", "Draggable Item"]],
  ]);

  const workspace = findNodeByText(db, "My Workspace") as KnowNode;

  renderApp({
    ...alice(),
    initialRoute: `/w/${workspace.id}`,
  });

  await screen.findByText("My Workspace");
  await screen.findByText("Draggable Item");

  // Click the first "open in split pane" button (on the workspace header)
  const splitPaneButtons = screen.getAllByLabelText("open in split pane");
  await userEvent.click(splitPaneButtons[0]);

  // eslint-disable-next-line testing-library/no-node-access
  expect(document.querySelectorAll(".split-pane").length).toBe(2);

  // Navigate pane 1 to ROOT (My Notes) using search
  await userEvent.click(
    screen.getByLabelText("Search to change pane 1 content")
  );
  await userEvent.type(screen.getByPlaceholderText("Search"), "My Notes");
  await userEvent.click(await screen.findByText("My Notes"));

  const addToMyNotes = await screen.findByLabelText("add to My Notes");

  // Drag Draggable Item from pane 1 to ROOT in pane 2
  const draggableItem = screen.getByText("Draggable Item");
  fireEvent.dragStart(draggableItem);
  fireEvent.drop(addToMyNotes);

  // Verify the item was added to My Notes (ROOT)
  // It should now appear twice - once in My Workspace and once in My Notes
  const allDraggableItems = screen.getAllByText("Draggable Item");
  expect(allDraggableItems.length).toBe(2);
});

test("Diff items are always added, never moved", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const parent = newNode("Parent", alicePK);
  const aliceChild = newNode("Alice's Child", alicePK);
  const bobChild = newNode("Bob's Child", bobPK);

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
    width: 1,
    relations: aliceRelations.id,
    expanded: true,
  });

  const plan = planUpdateViews(
    planUpsertRelations(
      planBulkUpsertNodes(createPlan({ ...alice(), knowledgeDBs, views }), [
        parent,
        aliceChild,
      ]),
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
    0,
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
