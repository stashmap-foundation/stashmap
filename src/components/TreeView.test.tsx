import React from "react";
import { List } from "immutable";
import { fireEvent, screen } from "@testing-library/react";
import {
  ALICE,
  BOB,
  findNodeByText,
  follow,
  renderWithTestData,
  setup,
  setupTestDB,
  RootViewOrWorkspaceIsLoading,
} from "../utils.test";
import { newNode, addRelationToRelations } from "../connections";
import { createPlan, planUpsertNode, planUpsertRelations } from "../planner";
import { execute } from "../executor";
import Data from "../Data";
import { LoadNode } from "../dataQuery";
import {
  PushNode,
  RootViewContextProvider,
  newRelations,
} from "../ViewContext";
import { TreeView } from "./TreeView";
import { DraggableNote } from "./Draggable";
import { TemporaryViewProvider } from "./TemporaryViewContext";
import { DND } from "../dnd";

test("Load Referenced By Nodes", async () => {
  const [alice] = setup([ALICE]);
  const aliceDB = await setupTestDB(
    alice(),
    [["Alice Workspace", [["Money", ["Bitcoin"]]]]],
    { activeWorkspace: "Alice Workspace" }
  );
  const bitcoin = findNodeByText(aliceDB, "Bitcoin") as KnowNode;

  await setupTestDB(alice(), [
    ["Cryptocurrencies", [bitcoin]],
    ["P2P Apps", [bitcoin]],
  ]);
  renderWithTestData(
    <Data user={alice().user}>
      <RootViewOrWorkspaceIsLoading>
        <PushNode push={List([0])}>
          <LoadNode referencedBy>
            <TreeView />
          </LoadNode>
        </PushNode>
      </RootViewOrWorkspaceIsLoading>
    </Data>,
    {
      ...alice(),
      initialRoute: `/w/${aliceDB.activeWorkspace}`,
    }
  );
  await screen.findByText("Bitcoin");
  fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
  screen.getByText("Referenced By (3)");
  // Reference nodes display as "Parent → Bitcoin" paths
  await screen.findByText(/Cryptocurrencies/);
  await screen.findByText(/P2P Apps/);
});

test("Show Referenced By with content details", async () => {
  const [alice] = setup([ALICE]);
  const aliceKnowledgeDB = await setupTestDB(alice(), [["Money", ["Bitcoin"]]]);
  const btc = findNodeByText(aliceKnowledgeDB, "Bitcoin") as KnowNode;
  const db = await setupTestDB(
    alice(),
    [["Alice Workspace", [[btc], ["P2P Apps", [btc]]]]],
    { activeWorkspace: "Alice Workspace" }
  );
  renderWithTestData(
    <Data user={alice().user}>
      <RootViewOrWorkspaceIsLoading>
        <PushNode push={List([0])}>
          <LoadNode referencedBy>
            <>
              <DraggableNote />
              <TreeView />
            </>
          </LoadNode>
        </PushNode>
      </RootViewOrWorkspaceIsLoading>
    </Data>,
    {
      ...alice(),
      initialRoute: `/w/${db.activeWorkspace}`,
    }
  );
  await screen.findByText("Bitcoin");
  fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
  screen.getByLabelText("hide references to Bitcoin");
  // Reference nodes show full paths: "Context → Head"
  // P2P Apps is nested under Alice Workspace, so shows "Alice Workspace → P2P Apps"
  const content = (await screen.findByLabelText("related to Bitcoin"))
    .textContent;
  expect(content).toMatch(/Alice Workspace → P2P Apps/);
  expect(content).toMatch(/Alice Workspace/);
  expect(content).toMatch(/Money/);
});

test("Root node shows references when there are more than 0", async () => {
  const [alice] = setup([ALICE]);
  const db = await setupTestDB(alice(), [["Money", ["Bitcoin"]]]);
  const bitcoin = findNodeByText(db, "Bitcoin") as KnowNode;
  renderWithTestData(
    <Data user={alice().user}>
      <RootViewContextProvider root={bitcoin.id}>
        <TemporaryViewProvider>
          <DND>
            <LoadNode referencedBy>
              <>
                <DraggableNote />
                <TreeView />
              </>
            </LoadNode>
          </DND>
        </TemporaryViewProvider>
      </RootViewContextProvider>
    </Data>,
    {
      ...alice(),
      initialRoute: `/d/${bitcoin.id}`,
    }
  );
  await screen.findByText("Bitcoin");
  fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
  screen.getByLabelText("hide references to Bitcoin");
  expect(
    (await screen.findByLabelText("related to Bitcoin")).textContent
  ).toMatch(/Money(.*)/);
  screen.getByText("Referenced By (1)");
});

test("Referenced By items do not show relation selector", async () => {
  const [alice] = setup([ALICE]);
  const db = await setupTestDB(alice(), [["Money", ["Bitcoin"]]]);
  const bitcoin = findNodeByText(db, "Bitcoin") as KnowNode;
  renderWithTestData(
    <Data user={alice().user}>
      <RootViewContextProvider root={bitcoin.id}>
        <TemporaryViewProvider>
          <DND>
            <LoadNode referencedBy>
              <>
                <DraggableNote />
                <TreeView />
              </>
            </LoadNode>
          </DND>
        </TemporaryViewProvider>
      </RootViewContextProvider>
    </Data>,
    {
      ...alice(),
      initialRoute: `/d/${bitcoin.id}`,
    }
  );
  await screen.findByText("Bitcoin");

  // The root node (Bitcoin) should have a relation selector
  expect(screen.getByLabelText("show references to Bitcoin")).toBeDefined();

  // Open Referenced By view
  fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
  await screen.findByText("Referenced By (1)");

  // Wait for the reference item to appear
  await screen.findByText(/Money/);

  // The Referenced By items should NOT have relation selectors
  // Only the root node (Bitcoin) should have one
  const allRelationSelectors = screen.getAllByRole("button", {
    name: /show references|hide references/,
  });
  // Should only find one - for the root Bitcoin node
  expect(allRelationSelectors).toHaveLength(1);
});

test("Referenced By items still show navigation buttons", async () => {
  const [alice] = setup([ALICE]);
  const db = await setupTestDB(alice(), [["Money", ["Bitcoin"]]]);
  const bitcoin = findNodeByText(db, "Bitcoin") as KnowNode;
  renderWithTestData(
    <Data user={alice().user}>
      <RootViewContextProvider root={bitcoin.id}>
        <TemporaryViewProvider>
          <DND>
            <LoadNode referencedBy>
              <>
                <DraggableNote />
                <TreeView />
              </>
            </LoadNode>
          </DND>
        </TemporaryViewProvider>
      </RootViewContextProvider>
    </Data>,
    {
      ...alice(),
      initialRoute: `/d/${bitcoin.id}`,
    }
  );
  await screen.findByText("Bitcoin");

  // Open Referenced By view
  fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
  await screen.findByText("Referenced By (1)");

  // Wait for the reference item to appear
  await screen.findByText(/Money/);

  // Navigation buttons should still be available for Referenced By items
  // The fullscreen button should be present
  const fullscreenButtons = screen.getAllByLabelText("open fullscreen");
  expect(fullscreenButtons.length).toBeGreaterThanOrEqual(1);
});

test("Referenced By shows node with list and empty context", async () => {
  const [alice] = setup([ALICE]);
  // Create "Money" with a child "Bitcoin" - Money has a list with empty context
  const db = await setupTestDB(alice(), [["Money", ["Bitcoin"]]]);
  const money = findNodeByText(db, "Money") as KnowNode;
  renderWithTestData(
    <Data user={alice().user}>
      <RootViewContextProvider root={money.id}>
        <TemporaryViewProvider>
          <DND>
            <LoadNode referencedBy>
              <>
                <DraggableNote />
                <TreeView />
              </>
            </LoadNode>
          </DND>
        </TemporaryViewProvider>
      </RootViewContextProvider>
    </Data>,
    {
      ...alice(),
      initialRoute: `/d/${money.id}`,
    }
  );
  await screen.findByText("Money");

  // Open Referenced By view
  fireEvent.click(screen.getByLabelText("show references to Money"));
  await screen.findByText("Referenced By (1)");

  // The node with a list should appear in its own Referenced By
  // It should display just "Money" (the node name), not "Loading..."
  const content = (await screen.findByLabelText("related to Money"))
    .textContent;
  expect(content).toMatch(/Money/);
  expect(content).not.toMatch(/Loading/);
});

test("Referenced By deduplicates paths from multiple users", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  // Alice creates "My Notes" and "Bitcoin" nodes
  const myNotes = newNode("My Notes", alicePK);
  const bitcoin = newNode("Bitcoin", alicePK);

  // Alice creates a relation: My Notes -> Bitcoin
  const aliceRelations = addRelationToRelations(
    newRelations(myNotes.id, List(), alicePK),
    bitcoin.id
  );

  const alicePlan = planUpsertRelations(
    planUpsertNode(planUpsertNode(createPlan(alice()), myNotes), bitcoin),
    aliceRelations
  );
  await execute({ ...alice(), plan: alicePlan });

  // Bob creates a relation using the SAME head (Alice's My Notes) -> Bitcoin
  // This simulates Bob also organizing Bitcoin under the same "My Notes" node
  const bobRelations = addRelationToRelations(
    newRelations(myNotes.id, List(), bobPK),
    bitcoin.id
  );

  const bobPlan = planUpsertRelations(createPlan(bob()), bobRelations);
  await execute({ ...bob(), plan: bobPlan });

  // Alice follows Bob to see his data
  await follow(alice, bob().user.publicKey);

  renderWithTestData(
    <Data user={alice().user}>
      <RootViewContextProvider root={bitcoin.id}>
        <TemporaryViewProvider>
          <DND>
            <LoadNode referencedBy>
              <>
                <DraggableNote />
                <TreeView />
              </>
            </LoadNode>
          </DND>
        </TemporaryViewProvider>
      </RootViewContextProvider>
    </Data>,
    {
      ...alice(),
      initialRoute: `/d/${bitcoin.id}`,
    }
  );

  await screen.findByText("Bitcoin");
  fireEvent.click(screen.getByLabelText("show references to Bitcoin"));

  // Wait for Referenced By to load
  await screen.findByLabelText("related to Bitcoin");

  // Should only show ONE reference path, not two (deduplication works)
  // Both Alice and Bob have relations with head=My Notes containing Bitcoin
  const referenceButtons = screen.getAllByLabelText(/Navigate to/);
  expect(referenceButtons).toHaveLength(1);
});

test("Reference indicators show item count", async () => {
  const [alice] = setup([ALICE]);
  const { publicKey: alicePK } = alice().user;

  // Create hierarchy: Parent -> Child, and Child has its own children
  const parent = newNode("Parent", alicePK);
  const child = newNode("Child", alicePK);
  const grandchild1 = newNode("Grandchild 1", alicePK);
  const grandchild2 = newNode("Grandchild 2", alicePK);

  // Parent -> Child
  const parentRelations = addRelationToRelations(
    newRelations(parent.id, List(), alicePK),
    child.id
  );

  // Child -> Grandchild1, Grandchild2
  const childRelations = addRelationToRelations(
    addRelationToRelations(
      newRelations(child.id, List(), alicePK),
      grandchild1.id
    ),
    grandchild2.id
  );

  const plan = planUpsertRelations(
    planUpsertRelations(
      planUpsertNode(
        planUpsertNode(
          planUpsertNode(planUpsertNode(createPlan(alice()), parent), child),
          grandchild1
        ),
        grandchild2
      ),
      parentRelations
    ),
    childRelations
  );
  await execute({ ...alice(), plan });

  renderWithTestData(
    <Data user={alice().user}>
      <RootViewContextProvider root={child.id}>
        <TemporaryViewProvider>
          <DND>
            <LoadNode referencedBy>
              <>
                <DraggableNote />
                <TreeView />
              </>
            </LoadNode>
          </DND>
        </TemporaryViewProvider>
      </RootViewContextProvider>
    </Data>,
    {
      ...alice(),
      initialRoute: `/d/${child.id}`,
    }
  );

  await screen.findByText("Child");
  fireEvent.click(screen.getByLabelText("show references to Child"));
  await screen.findByText("Referenced By (2)");

  // The reference "Parent" should show [2] because Child has 2 grandchildren
  // when viewed from the Parent context
  const indicators = await screen.findByText("[2]");
  expect(indicators).toBeDefined();
});

test("Reference indicators show other users icon", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  // Alice creates Parent -> Child
  const parent = newNode("Parent", alicePK);
  const child = newNode("Child", alicePK);
  const aliceGrandchild = newNode("Alice Grandchild", alicePK);

  const parentRelations = addRelationToRelations(
    newRelations(parent.id, List(), alicePK),
    child.id
  );

  // Alice's version of Child's children
  const aliceChildRelations = addRelationToRelations(
    newRelations(child.id, List(), alicePK),
    aliceGrandchild.id
  );

  const alicePlan = planUpsertRelations(
    planUpsertRelations(
      planUpsertNode(
        planUpsertNode(planUpsertNode(createPlan(alice()), parent), child),
        aliceGrandchild
      ),
      parentRelations
    ),
    aliceChildRelations
  );
  await execute({ ...alice(), plan: alicePlan });

  // Bob creates his own version of Child's children
  const bobGrandchild = newNode("Bob Grandchild", bobPK);
  const bobChildRelations = addRelationToRelations(
    newRelations(child.id, List(), bobPK),
    bobGrandchild.id
  );

  const bobPlan = planUpsertRelations(
    planUpsertNode(createPlan(bob()), bobGrandchild),
    bobChildRelations
  );
  await execute({ ...bob(), plan: bobPlan });

  // Alice follows Bob
  await follow(alice, bob().user.publicKey);

  renderWithTestData(
    <Data user={alice().user}>
      <RootViewContextProvider root={child.id}>
        <TemporaryViewProvider>
          <DND>
            <LoadNode referencedBy>
              <>
                <DraggableNote />
                <TreeView />
              </>
            </LoadNode>
          </DND>
        </TemporaryViewProvider>
      </RootViewContextProvider>
    </Data>,
    {
      ...alice(),
      initialRoute: `/d/${child.id}`,
    }
  );

  await screen.findByText("Child");
  fireEvent.click(screen.getByLabelText("show references to Child"));
  await screen.findByText("Referenced By (2)");

  // Should show the business-man icon for 1 other user (Bob)
  // The icon has a title attribute we can query
  const otherUserIcon = await screen.findByTitle("1 other version");
  expect(otherUserIcon).toBeDefined();
});

test("Disconnect button shows when view.relations is not explicitly set", async () => {
  // This tests the fix for when a node is opened in split screen
  // without view.relations being set - the disconnect button should still appear
  const [alice] = setup([ALICE]);
  const db = await setupTestDB(alice(), [["Parent", ["Child1", "Child2"]]]);
  const parent = findNodeByText(db, "Parent") as KnowNode;

  // RootViewContextProvider creates a view without relations explicitly set
  // The component should find relations by context using getRelationForView
  renderWithTestData(
    <Data user={alice().user}>
      <RootViewContextProvider root={parent.id}>
        <TemporaryViewProvider>
          <DND>
            <LoadNode>
              <>
                <DraggableNote />
                <TreeView />
              </>
            </LoadNode>
          </DND>
        </TemporaryViewProvider>
      </RootViewContextProvider>
    </Data>,
    {
      ...alice(),
      initialRoute: `/d/${parent.id}`,
    }
  );

  await screen.findByText("Parent");
  // Root node is always expanded, children should already be visible
  await screen.findByText("Child1");
  await screen.findByText("Child2");

  // The disconnect buttons should appear for the children
  // even though view.relations was not explicitly set on the root
  const disconnectButtons = screen.getAllByLabelText(/disconnect node/);
  expect(disconnectButtons.length).toBe(2);
});
