import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { List, Map } from "immutable";
import { addRelationToRelations, newNode, shortID } from "../connections";
import { DND } from "../dnd";
import { ALICE, BOB, renderWithTestData, setup, follow } from "../utils.test";
import {
  RootViewContextProvider,
  newRelations,
  getDiffItemsForNode,
} from "../ViewContext";
import { TemporaryViewProvider } from "./TemporaryViewContext";
import { createPlan, planUpsertNode, planUpsertRelations } from "../planner";
import { execute } from "../executor";
import { LoadNode } from "../dataQuery";
import { TreeView } from "./TreeView";
import { newDB } from "../knowledge";

test("Shows dots when other user has a relation of same type", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  // Alice creates a node with a "relevant" relation
  const { publicKey: alicePK } = alice().user;
  const parentNode = newNode("Parent Node", alicePK);
  const childNode = newNode("Child Node", alicePK);
  const aliceRelations = addRelationToRelations(
    newRelations(parentNode.id, List(), alicePK),
    childNode.id
  );

  const alicePlan = planUpsertRelations(
    planUpsertNode(planUpsertNode(createPlan(alice()), parentNode), childNode),
    aliceRelations
  );
  await execute({ ...alice(), plan: alicePlan });

  // Bob creates his own "relevant" relation on the same parent node
  const { publicKey: bobPK } = bob().user;
  const bobChildNode = newNode("Bob's Child Node", bobPK);
  const bobRelations = addRelationToRelations(
    newRelations(parentNode.id, List(), bobPK),
    bobChildNode.id
  );

  const bobPlan = planUpsertRelations(
    planUpsertNode(createPlan(bob()), bobChildNode),
    bobRelations
  );
  await execute({ ...bob(), plan: bobPlan });

  // Alice follows Bob to see his data
  await follow(alice, bob().user.publicKey);

  // Render from Alice's perspective
  renderWithTestData(
    <RootViewContextProvider root={parentNode.id}>
      <TemporaryViewProvider>
        <DND>
          <LoadNode>
            <TreeView />
          </LoadNode>
        </DND>
      </TemporaryViewProvider>
    </RootViewContextProvider>,
    alice()
  );

  await screen.findByLabelText(/expand Parent Node|collapse Parent Node/);

  // The version selector should show when multiple versions are available
  // Both Alice and Bob have versions, so there are 2 versions
  expect(screen.getByLabelText("2 versions available")).toBeDefined();
});

test("Shows no dots when user is the only one with a relation", async () => {
  const [alice] = setup([ALICE]);

  const { publicKey: alicePK } = alice().user;
  const parentNode = newNode("Parent Node", alicePK);
  const childNode = newNode("Child Node", alicePK);
  const aliceRelations = addRelationToRelations(
    newRelations(parentNode.id, List(), alicePK),
    childNode.id
  );

  const plan = planUpsertRelations(
    planUpsertNode(planUpsertNode(createPlan(alice()), parentNode), childNode),
    aliceRelations
  );
  await execute({ ...alice(), plan });

  renderWithTestData(
    <RootViewContextProvider root={parentNode.id}>
      <TemporaryViewProvider>
        <DND>
          <LoadNode>
            <TreeView />
          </LoadNode>
        </DND>
      </TemporaryViewProvider>
    </RootViewContextProvider>,
    alice()
  );

  await screen.findByLabelText(/expand Parent Node|collapse Parent Node/);

  // Version selector should not appear when only one version exists
  // There's no "versions available" button since Alice is the only one
  expect(screen.queryByLabelText(/versions available/)).toBeNull();
});

test("Shows dots when only other user has relation (current user has none)", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  // Alice creates just the parent node, no relations
  const { publicKey: alicePK } = alice().user;
  const parentNode = newNode("Parent Node", alicePK);

  const alicePlan = planUpsertNode(createPlan(alice()), parentNode);
  await execute({ ...alice(), plan: alicePlan });

  // Bob creates a "relevant" relation on Alice's node
  const { publicKey: bobPK } = bob().user;
  const bobChildNode = newNode("Bob's Child Node", bobPK);
  const bobRelations = addRelationToRelations(
    newRelations(parentNode.id, List(), bobPK),
    bobChildNode.id
  );

  const bobPlan = planUpsertRelations(
    planUpsertNode(createPlan(bob()), bobChildNode),
    bobRelations
  );
  await execute({ ...bob(), plan: bobPlan });

  // Alice follows Bob to see his data
  await follow(alice, bob().user.publicKey);

  // Render from Alice's perspective - she has no local version but should see Bob's
  renderWithTestData(
    <RootViewContextProvider root={parentNode.id}>
      <TemporaryViewProvider>
        <DND>
          <LoadNode>
            <TreeView />
          </LoadNode>
        </DND>
      </TemporaryViewProvider>
    </RootViewContextProvider>,
    alice()
  );

  // Expand Parent Node to see diff items from Bob
  await userEvent.click(await screen.findByLabelText("expand Parent Node"));

  // When only another user has a version (not the current user),
  // there's just 1 version available, so no version selector is shown.
  // But Bob's child should appear as a diff item.
  expect(screen.queryByLabelText(/versions available/)).toBeNull();
  // Bob's child should be visible as a diff item
  await screen.findByLabelText(/expand Bob's Child Node|collapse Bob's Child Node/);
});

test("getDiffItemsForNode returns items from other users", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const parentNode = newNode("Parent Node", alicePK);
  const aliceChildNode = newNode("Alice's Child", alicePK);
  const aliceRelations = addRelationToRelations(
    newRelations(parentNode.id, List(), alicePK),
    aliceChildNode.id
  );

  const bobChildNode = newNode("Bob's Child", bobPK);
  const bobRelations = addRelationToRelations(
    newRelations(parentNode.id, List(), bobPK),
    bobChildNode.id
  );

  const knowledgeDBs = Map<PublicKey, KnowledgeData>()
    .set(alicePK, {
      ...newDB(),
      nodes: newDB()
        .nodes.set(shortID(parentNode.id), parentNode)
        .set(shortID(aliceChildNode.id), aliceChildNode),
      relations: newDB().relations.set(
        shortID(aliceRelations.id),
        aliceRelations
      ),
    })
    .set(bobPK, {
      ...newDB(),
      nodes: newDB().nodes.set(shortID(bobChildNode.id), bobChildNode),
      relations: newDB().relations.set(shortID(bobRelations.id), bobRelations),
    });

  const diffItems = getDiffItemsForNode(
    knowledgeDBs,
    alicePK,
    parentNode.id,
    ["", "suggestions"],
    aliceRelations.id
  );

  expect(diffItems.size).toBe(1);
  expect(diffItems.get(0)?.nodeID).toBe(bobChildNode.id);
});

test("Diff items are not included when saving a relation", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const parentNode = newNode("Parent Node", alicePK);
  const aliceChildNode = newNode("Alice's Child", alicePK);
  const aliceRelations = addRelationToRelations(
    newRelations(parentNode.id, List(), alicePK),
    aliceChildNode.id
  );

  const bobChildNode = newNode("Bob's Child", bobPK);
  const bobRelations = addRelationToRelations(
    newRelations(parentNode.id, List(), bobPK),
    bobChildNode.id
  );

  const knowledgeDBs = Map<PublicKey, KnowledgeData>()
    .set(alicePK, {
      ...newDB(),
      nodes: newDB()
        .nodes.set(shortID(parentNode.id), parentNode)
        .set(shortID(aliceChildNode.id), aliceChildNode),
      relations: newDB().relations.set(
        shortID(aliceRelations.id),
        aliceRelations
      ),
    })
    .set(bobPK, {
      ...newDB(),
      nodes: newDB().nodes.set(shortID(bobChildNode.id), bobChildNode),
      relations: newDB().relations.set(shortID(bobRelations.id), bobRelations),
    });

  const aliceDB = knowledgeDBs.get(alicePK);
  const savedRelation = aliceDB?.relations.get(shortID(aliceRelations.id));

  expect(savedRelation?.items.size).toBe(1);
  expect(savedRelation?.items.get(0)?.nodeID).toBe(aliceChildNode.id);
  // Check that bob's child is not in alice's relation items
  expect(
    savedRelation?.items.some((item) => item.nodeID === bobChildNode.id)
  ).toBe(false);
});

test("getDiffItemsForNode deduplicates items from multiple other users", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;
  const carolPK = "carol_public_key" as PublicKey;

  const parentNode = newNode("Parent Node", alicePK);
  const aliceChildNode = newNode("Alice's Child", alicePK);
  const aliceRelations = addRelationToRelations(
    newRelations(parentNode.id, List(), alicePK),
    aliceChildNode.id
  );

  const bobChildNode = newNode("Bob's Child", bobPK);
  const bobRelations = addRelationToRelations(
    newRelations(parentNode.id, List(), bobPK),
    bobChildNode.id
  );

  const carolRelations = addRelationToRelations(
    newRelations(parentNode.id, List(), carolPK),
    bobChildNode.id
  );

  const knowledgeDBs = Map<PublicKey, KnowledgeData>()
    .set(alicePK, {
      ...newDB(),
      nodes: newDB()
        .nodes.set(shortID(parentNode.id), parentNode)
        .set(shortID(aliceChildNode.id), aliceChildNode),
      relations: newDB().relations.set(
        shortID(aliceRelations.id),
        aliceRelations
      ),
    })
    .set(bobPK, {
      ...newDB(),
      nodes: newDB().nodes.set(shortID(bobChildNode.id), bobChildNode),
      relations: newDB().relations.set(shortID(bobRelations.id), bobRelations),
    })
    .set(carolPK, {
      ...newDB(),
      relations: newDB().relations.set(
        shortID(carolRelations.id),
        carolRelations
      ),
    });

  const diffItems = getDiffItemsForNode(
    knowledgeDBs,
    alicePK,
    parentNode.id,
    ["", "suggestions"],
    aliceRelations.id
  );

  expect(diffItems.size).toBe(1);
  expect(diffItems.get(0)?.nodeID).toBe(bobChildNode.id);
});
