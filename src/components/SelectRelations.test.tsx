import React from "react";
import { screen } from "@testing-library/react";
import { addRelationToRelations, newNode } from "../connections";
import { DND } from "../dnd";
import { ALICE, BOB, renderWithTestData, setup, follow } from "../utils.test";
import { RootViewContextProvider, newRelations } from "../ViewContext";
import { TemporaryViewProvider } from "./TemporaryViewContext";
import { createPlan, planUpsertNode, planUpsertRelations } from "../planner";
import { execute } from "../executor";
import { LoadNode } from "../dataQuery";
import { Column } from "./Column";

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
