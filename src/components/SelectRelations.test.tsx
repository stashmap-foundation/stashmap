import React from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { List, Map } from "immutable";
import { addRelationToRelations, newNode, shortID } from "../connections";
import {
  ALICE,
  BOB,
  CAROL,
  setup,
  follow,
  renderTree,
  expectTree,
  type,
} from "../utils.test";
import { newRelations, getSuggestionsForNode } from "../ViewContext";
import { newDB } from "../knowledge";

function createRelationTree(
  author: PublicKey,
  rootText: string,
  childText: string,
  sharedRootNode?: KnowNode,
  sharedChildNode?: KnowNode
): {
  rootNode: KnowNode;
  childNode: KnowNode;
  rootRelation: Relations;
  childRelation: Relations;
} {
  const rootNode = sharedRootNode ?? newNode(rootText);
  const childNode = sharedChildNode ?? newNode(childText);
  const rootRelation = newRelations(
    rootNode.id,
    List(),
    author,
    undefined,
    undefined,
    rootText
  );
  const childRelation = newRelations(
    childNode.id,
    List([rootNode.id]),
    author,
    rootRelation.root,
    rootRelation.id,
    childText
  );

  return {
    rootNode,
    childNode,
    rootRelation: addRelationToRelations(rootRelation, childRelation.id),
    childRelation,
  };
}

test("Shows no dots when user is the only one with a relation", async () => {
  const [alice] = setup([ALICE]);

  renderTree(alice);
  await type("Root{Enter}Parent Node{Enter}{Tab}Child Node{Escape}");

  await expectTree(`
Root
  Parent Node
    Child Node
  `);

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
  `);
});

test("getSuggestionsForNode returns items from other users", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const parentNode = newNode("Parent Node");
  const aliceTree = createRelationTree(
    alicePK,
    "Parent Node",
    "Alice's Child",
    parentNode
  );
  const bobTree = createRelationTree(
    bobPK,
    "Parent Node",
    "Bob's Child",
    parentNode
  );

  const knowledgeDBs = Map<PublicKey, KnowledgeData>()
    .set(alicePK, {
      ...newDB(),
      relations: newDB()
        .relations.set(shortID(aliceTree.rootRelation.id), aliceTree.rootRelation)
        .set(shortID(aliceTree.childRelation.id), aliceTree.childRelation),
    })
    .set(bobPK, {
      ...newDB(),
      relations: newDB()
        .relations.set(shortID(bobTree.rootRelation.id), bobTree.rootRelation)
        .set(shortID(bobTree.childRelation.id), bobTree.childRelation),
    });

  const { suggestions: diffItems } = getSuggestionsForNode(
    knowledgeDBs,
    alicePK,
    parentNode.id,
    ["contains", "suggestions"],
    aliceTree.rootRelation.id
  );

  expect(diffItems.size).toBe(1);
  expect(diffItems.get(0)).toBe(bobTree.childNode.id);
});

test("Diff items are not included when saving a relation", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const parentNode = newNode("Parent Node");
  const aliceTree = createRelationTree(
    alicePK,
    "Parent Node",
    "Alice's Child",
    parentNode
  );
  const bobTree = createRelationTree(
    bobPK,
    "Parent Node",
    "Bob's Child",
    parentNode
  );

  const knowledgeDBs = Map<PublicKey, KnowledgeData>()
    .set(alicePK, {
      ...newDB(),
      relations: newDB()
        .relations.set(shortID(aliceTree.rootRelation.id), aliceTree.rootRelation)
        .set(shortID(aliceTree.childRelation.id), aliceTree.childRelation),
    })
    .set(bobPK, {
      ...newDB(),
      relations: newDB()
        .relations.set(shortID(bobTree.rootRelation.id), bobTree.rootRelation)
        .set(shortID(bobTree.childRelation.id), bobTree.childRelation),
    });

  const aliceDB = knowledgeDBs.get(alicePK);
  const savedRelation = aliceDB?.relations.get(shortID(aliceTree.rootRelation.id));

  expect(savedRelation?.items.size).toBe(1);
  expect(savedRelation?.items.get(0)?.id).toBe(aliceTree.childRelation.id);
  expect(
    savedRelation?.items.some((item) => item.id === bobTree.childRelation.id)
  ).toBe(false);
});

test("getSuggestionsForNode deduplicates items from multiple other users", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;
  const carolPK = CAROL.publicKey;

  const parentNode = newNode("Parent Node");
  const bobChildNode = newNode("Bob's Child");
  const aliceTree = createRelationTree(
    alicePK,
    "Parent Node",
    "Alice's Child",
    parentNode
  );
  const bobTree = createRelationTree(
    bobPK,
    "Parent Node",
    "Bob's Child",
    parentNode,
    bobChildNode
  );
  const carolTree = createRelationTree(
    carolPK,
    "Parent Node",
    "Bob's Child",
    parentNode,
    bobChildNode
  );

  const knowledgeDBs = Map<PublicKey, KnowledgeData>()
    .set(alicePK, {
      ...newDB(),
      relations: newDB()
        .relations.set(shortID(aliceTree.rootRelation.id), aliceTree.rootRelation)
        .set(shortID(aliceTree.childRelation.id), aliceTree.childRelation),
    })
    .set(bobPK, {
      ...newDB(),
      relations: newDB()
        .relations.set(shortID(bobTree.rootRelation.id), bobTree.rootRelation)
        .set(shortID(bobTree.childRelation.id), bobTree.childRelation),
    })
    .set(carolPK, {
      ...newDB(),
      relations: newDB()
        .relations.set(shortID(carolTree.rootRelation.id), carolTree.rootRelation)
        .set(shortID(carolTree.childRelation.id), carolTree.childRelation),
    });

  const { suggestions: diffItems } = getSuggestionsForNode(
    knowledgeDBs,
    alicePK,
    parentNode.id,
    ["contains", "suggestions"],
    aliceTree.rootRelation.id
  );

  expect(diffItems.size).toBe(1);
  expect(diffItems.get(0)).toBe(bobChildNode.id);
});
