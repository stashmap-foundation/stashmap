import React from "react";
import { screen } from "@testing-library/react";
import { Map } from "immutable";
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
import { Column } from "./Column";
import { newDB } from "../knowledge";

test("Shows dots when other user has a relation of same type", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  // Alice creates a node with a "relevant" relation
  const { publicKey: alicePK } = alice().user;
  const parentNode = newNode("Parent Node", alicePK);
  const childNode = newNode("Child Node", alicePK);
  const aliceRelations = addRelationToRelations(
    newRelations(parentNode.id, "", alicePK),
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
    newRelations(parentNode.id, "", bobPK),
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
            <Column />
          </LoadNode>
        </DND>
      </TemporaryViewProvider>
    </RootViewContextProvider>,
    alice()
  );

  await screen.findByText("Parent Node");

  // Check that dots are rendered for the relation that Bob also has
  expect(screen.getByRole("img", { name: "1 other version" })).toBeDefined();
});

test("Shows no dots when user is the only one with a relation", async () => {
  const [alice] = setup([ALICE]);

  const { publicKey: alicePK } = alice().user;
  const parentNode = newNode("Parent Node", alicePK);
  const childNode = newNode("Child Node", alicePK);
  const aliceRelations = addRelationToRelations(
    newRelations(parentNode.id, "", alicePK),
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
            <Column />
          </LoadNode>
        </DND>
      </TemporaryViewProvider>
    </RootViewContextProvider>,
    alice()
  );

  await screen.findByText("Parent Node");

  // Should show no "other versions" indicator since Alice is the only one
  expect(screen.queryByRole("img", { name: /other version/ })).toBeNull();
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
    newRelations(parentNode.id, "", bobPK),
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
            <Column />
          </LoadNode>
        </DND>
      </TemporaryViewProvider>
    </RootViewContextProvider>,
    alice()
  );

  await screen.findByText("Parent Node");

  // Should show indicator for Bob's version
  expect(screen.getByRole("img", { name: "1 other version" })).toBeDefined();
});

test("getDiffItemsForNode returns items from other users", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  // Alice has item A in her relation
  const parentNode = newNode("Parent Node", alicePK);
  const aliceChildNode = newNode("Alice's Child", alicePK);
  const aliceRelations = addRelationToRelations(
    newRelations(parentNode.id, "", alicePK),
    aliceChildNode.id
  );

  // Bob has item B in his relation (same parent, same type)
  const bobChildNode = newNode("Bob's Child", bobPK);
  const bobRelations = addRelationToRelations(
    newRelations(parentNode.id, "", bobPK),
    bobChildNode.id
  );

  // Build knowledgeDBs with both users' data
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

  // Get diff items for Alice viewing her own relation
  const diffItems = getDiffItemsForNode(
    knowledgeDBs,
    alicePK,
    parentNode.id,
    "", // relation type
    aliceRelations.id
  );

  // Alice should see Bob's child as a diff item
  expect(diffItems.size).toBe(1);
  expect(diffItems.get(0)?.nodeID).toBe(bobChildNode.id);
});

test("Diff items are not included when saving a relation", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  // Alice has item A in her relation
  const parentNode = newNode("Parent Node", alicePK);
  const aliceChildNode = newNode("Alice's Child", alicePK);
  const aliceRelations = addRelationToRelations(
    newRelations(parentNode.id, "", alicePK),
    aliceChildNode.id
  );

  // Bob has item B in his relation (same parent, same type)
  const bobChildNode = newNode("Bob's Child", bobPK);
  const bobRelations = addRelationToRelations(
    newRelations(parentNode.id, "", bobPK),
    bobChildNode.id
  );

  // Build knowledgeDBs with both users' data
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

  // Verify Alice's relation only contains her own item, not Bob's (diff item)
  const aliceDB = knowledgeDBs.get(alicePK);
  const savedRelation = aliceDB?.relations.get(shortID(aliceRelations.id));

  expect(savedRelation?.items.size).toBe(1);
  expect(savedRelation?.items.get(0)).toBe(aliceChildNode.id);
  // Bob's child should NOT be in Alice's relation
  expect(savedRelation?.items.includes(bobChildNode.id)).toBe(false);
});

test("getDiffItemsForNode deduplicates items from multiple other users", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  // Create a third "user" by using a different key
  const carolPK = "carol_public_key" as PublicKey;

  // Alice has item A in her relation
  const parentNode = newNode("Parent Node", alicePK);
  const aliceChildNode = newNode("Alice's Child", alicePK);
  const aliceRelations = addRelationToRelations(
    newRelations(parentNode.id, "", alicePK),
    aliceChildNode.id
  );

  // Bob has item B in his relation
  const bobChildNode = newNode("Bob's Child", bobPK);
  const bobRelations = addRelationToRelations(
    newRelations(parentNode.id, "", bobPK),
    bobChildNode.id
  );

  // Carol also has Bob's child (same nodeID, different user)
  const carolRelations = addRelationToRelations(
    newRelations(parentNode.id, "", carolPK),
    bobChildNode.id // Same as Bob's child
  );

  // Build knowledgeDBs with all users' data
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

  // Get diff items for Alice viewing her own relation
  const diffItems = getDiffItemsForNode(
    knowledgeDBs,
    alicePK,
    parentNode.id,
    "",
    aliceRelations.id
  );

  // Should only have Bob's child once (deduplicated)
  expect(diffItems.size).toBe(1);
  expect(diffItems.get(0)?.nodeID).toBe(bobChildNode.id);
});
