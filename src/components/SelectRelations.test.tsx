import React from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { List, Map } from "immutable";
import { addRelationToRelations, newNode, shortID } from "../connections";
import { DND } from "../dnd";
import {
  ALICE,
  BOB,
  renderWithTestData,
  setup,
  follow,
  renderTree,
  expectTree,
  type,
} from "../utils.test";
import {
  RootViewContextProvider,
  newRelations,
  getDiffItemsForNode,
} from "../ViewContext";
import { TemporaryViewProvider } from "./TemporaryViewContext";
import { createPlan, planUpsertNode, planUpsertRelations } from "../planner";
import { execute } from "../executor";
import { LoadData } from "../dataQuery";
import { TreeView } from "./TreeView";
import { newDB } from "../knowledge";

test("Shows no dots when user is the only one with a relation", async () => {
  const [alice] = setup([ALICE]);

  const { publicKey: alicePK } = alice().user;
  const parentNode = newNode("Parent Node");
  const childNode = newNode("Child Node");
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
    <LoadData nodeIDs={[parentNode.id]} descendants referencedBy lists>
      <RootViewContextProvider root={parentNode.id}>
        <TemporaryViewProvider>
          <DND>
            <TreeView />
          </DND>
        </TemporaryViewProvider>
      </RootViewContextProvider>
    </LoadData>,
    alice()
  );

  await screen.findByLabelText(/expand Parent Node|collapse Parent Node/);

  // Version selector should not appear when only one version exists
  // There's no "versions available" button since Alice is the only one
  expect(screen.queryByLabelText(/versions available/)).toBeNull();
});

test("Shows dots when only other user has relation (current user has none)", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);

  renderTree(bob);
  await type("Root{Enter}Parent Node{Enter}{Tab}Bob Child{Escape}");

  await expectTree(`
Root
  Parent Node
    Bob Child
  `);

  cleanup();

  renderTree(alice);
  await type("Root{Enter}Parent Node{Escape}");

  await expectTree(`
Root
  Parent Node
  `);

  await userEvent.click(await screen.findByLabelText("expand Parent Node"));

  await expectTree(`
Root
  Parent Node
    [S] Bob Child
    [VO] +1
  `);
});

test("getDiffItemsForNode returns items from other users", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const parentNode = newNode("Parent Node");
  const aliceChildNode = newNode("Alice's Child");
  const aliceRelations = addRelationToRelations(
    newRelations(parentNode.id, List(), alicePK),
    aliceChildNode.id
  );

  const bobChildNode = newNode("Bob's Child");
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
    ["contains", "suggestions"],
    aliceRelations.id
  );

  expect(diffItems.size).toBe(1);
  expect(diffItems.get(0)).toBe(bobChildNode.id);
});

test("Diff items are not included when saving a relation", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const parentNode = newNode("Parent Node");
  const aliceChildNode = newNode("Alice's Child");
  const aliceRelations = addRelationToRelations(
    newRelations(parentNode.id, List(), alicePK),
    aliceChildNode.id
  );

  const bobChildNode = newNode("Bob's Child");
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

  const parentNode = newNode("Parent Node");
  const aliceChildNode = newNode("Alice's Child");
  const aliceRelations = addRelationToRelations(
    newRelations(parentNode.id, List(), alicePK),
    aliceChildNode.id
  );

  const bobChildNode = newNode("Bob's Child");
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
    ["contains", "suggestions"],
    aliceRelations.id
  );

  expect(diffItems.size).toBe(1);
  expect(diffItems.get(0)).toBe(bobChildNode.id);
});
