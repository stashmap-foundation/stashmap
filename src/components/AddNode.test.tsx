import { screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { List } from "immutable";
import { addRelationToRelations, newNode } from "../connections";
import {
  setup,
  ALICE,
  BOB,
  matchSplitText,
  renderApp,
  typeNewNode,
  follow,
  createExampleProject,
  planUpsertProjectNode,
  findEvent,
} from "../utils.test";
import { execute } from "../executor";
import { createPlan, planUpsertNode, planUpsertRelations } from "../planner";
import { newRelations } from "../ViewContext";
import { KIND_KNOWLEDGE_NODE } from "../nostr";

test("Add New Note", async () => {
  const [alice] = setup([ALICE]);
  const view = renderApp(alice());
  await typeNewNode(view, "Hello World");
});

test("Write Nodes & List on Project Relays only", async () => {
  const [alice] = setup([ALICE]);
  const project = createExampleProject(alice().user.publicKey);
  await execute({
    ...alice(),
    plan: planUpsertProjectNode(createPlan(alice()), project),
  });
  alice().relayPool.resetPublishedOnRelays();
  const view = renderApp({
    ...alice(),
    initialRoute: `/?project=${project.id}`,
  });
  await typeNewNode(view, "Hello World");
  const node = await findEvent(view.relayPool, {
    kinds: [KIND_KNOWLEDGE_NODE],
    authors: [alice().user.publicKey],
  });
  expect(node?.relays).toEqual(["wss://winchester.deedsats.com/"]);
});

test("Link Nodes from other Users", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);

  // Bob creates OOP with Java as child, using context ['ROOT']
  // This simulates Bob adding OOP to ROOT and then adding Java under it
  const oop = newNode("Object Oriented Languages", bob().user.publicKey);
  const java = newNode("Java", bob().user.publicKey);
  const rootContext = List(["ROOT"]);
  const relations = addRelationToRelations(
    newRelations(oop.id, rootContext, bob().user.publicKey),
    java.id
  );
  const plan = planUpsertRelations(
    planUpsertNode(planUpsertNode(createPlan(bob()), oop), java),
    relations
  );
  await execute({
    ...bob(),
    plan,
  });
  renderApp({ ...alice(), includeFocusContext: true });

  // Alice adds OOP to ROOT (My Notes) - same context as Bob used
  const searchButton = await screen.findByLabelText(
    "search and attach to My Notes"
  );
  fireEvent.click(searchButton);
  const searchInput = await screen.findByLabelText("search input");
  await userEvent.type(searchInput, "Object");
  fireEvent.click(
    await screen.findByText(matchSplitText("Object Oriented Languages"))
  );

  // OOP is now under ROOT with context ['ROOT'] - Bob's children should be visible
  // Click to expand OOP and see its children
  // The root node is already expanded, so OOP will have the "expand" button
  fireEvent.click(await screen.findByLabelText("expand"));
  await screen.findByText("Java");
});

test("Default Relations are shown when adding a node from other User via search", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);

  // Bob creates OOP with Java as child, using context ['ROOT']
  const oop = newNode("Object Oriented Languages", bob().user.publicKey);
  const java = newNode("Java", bob().user.publicKey);
  const rootContext = List(["ROOT"]);
  const relations = addRelationToRelations(
    newRelations(oop.id, rootContext, bob().user.publicKey),
    java.id
  );
  const plan = planUpsertRelations(
    planUpsertNode(planUpsertNode(createPlan(bob()), oop), java),
    relations
  );
  await execute({
    ...bob(),
    plan,
  });

  renderApp({ ...alice(), includeFocusContext: true });

  // Alice adds OOP to ROOT (My Notes) - same context as Bob used
  const searchButton = await screen.findByLabelText(
    "search and attach to My Notes"
  );
  fireEvent.click(searchButton);
  const searchInput = await screen.findByLabelText("search input");
  await userEvent.type(searchInput, "Object");
  fireEvent.click(
    await screen.findByText(matchSplitText("Object Oriented Languages"))
  );

  // Click to expand OOP and see Bob's children
  // The root node is already expanded, so OOP will have the "expand" button
  fireEvent.click(await screen.findByLabelText("expand"));
  await screen.findByText("Java");
});
