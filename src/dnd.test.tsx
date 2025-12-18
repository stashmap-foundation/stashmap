import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { Map, OrderedSet } from "immutable";
import {
  ALICE,
  BOB,
  extractNodes,
  findNodeByText,
  renderWithTestData,
  setup,
  setupTestDB,
} from "./utils.test";
import { WorkspaceView } from "./components/Workspace";
import { RootViewOrWorkspaceIsLoading } from "./components/Dashboard";
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

test("Dragging Source not available at Destination", async () => {
  const [alice] = setup([ALICE]);
  // Cryptocurrencies => Bitcoin
  // Money
  const executedPlan = await setupTestDB(alice(), [
    ["Cryptocurrencies", ["Bitcoin"]],
    ["Money"],
  ]);
  const btc = findNodeByText(executedPlan, "Bitcoin");
  const money = findNodeByText(executedPlan, "Money");
  const planWithWs = await setupTestDB(
    alice(),
    [["My Workspace", [btc as KnowNode, money as KnowNode]]],

    { activeWorkspace: "My Workspace" }
  );
  renderWithTestData(
    <RootViewOrWorkspaceIsLoading>
      <WorkspaceView />
    </RootViewOrWorkspaceIsLoading>,
    {
      ...alice(),
      initialRoute: `/w/${planWithWs.activeWorkspace}`,
    }
  );

  await screen.findByText("Bitcoin");
  fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
  screen.getByLabelText("hide references to Bitcoin");
  const crypto = await screen.findByText("Cryptocurrencies");
  const addToMoney = await screen.findByLabelText("add to Money");

  fireEvent.dragStart(crypto);
  fireEvent.drop(addToMoney);

  expect(extractNodes(screen.getAllByTestId("ws-col")[1])).toEqual([
    "Cryptocurrencies",
  ]);

  fireEvent.click(screen.getByText("Money"));
});

test("Diff items are always added, never moved", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const parent = newNode("Parent", alicePK);
  const aliceChild = newNode("Alice's Child", alicePK);
  const bobChild = newNode("Bob's Child", bobPK);

  const aliceRelations = addRelationToRelations(
    newRelations(parent.id, "", alicePK),
    aliceChild.id
  );
  const bobRelations = addRelationToRelations(
    newRelations(parent.id, "", bobPK),
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
  expect(updatedRelations?.items.toArray()).toContain(bobChild.id);
  expect(updatedRelations?.items.toArray()).toContain(aliceChild.id);
});
