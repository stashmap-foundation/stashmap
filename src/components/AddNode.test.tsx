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
  follow,
  findNewNodeEditor,
} from "../utils.test";
import { execute } from "../executor";
import { createPlan, planUpsertNode, planUpsertRelations } from "../planner";
import { newRelations } from "../ViewContext";

test("Add New Note", async () => {
  const [alice] = setup([ALICE]);
  // Create a note programmatically (inline editing requires existing nodes)
  const note = newNode("Hello World");
  const rootRelations = addRelationToRelations(
    newRelations("ROOT", List(), alice().user.publicKey),
    note.id
  );
  await execute({
    ...alice(),
    plan: planUpsertRelations(
      planUpsertNode(createPlan(alice()), note),
      rootRelations
    ),
  });
  renderApp(alice());
  // Verify the note appears
  await screen.findByText("Hello World");
});

test("Add note via + button on empty tree", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  // Wait for My Notes to appear (ROOT node)
  await screen.findByText("My Notes");

  // Click the + button to add a note (aria-label="add to My Notes")
  const addButton = await screen.findByLabelText("add to My Notes");
  await userEvent.click(addButton);

  // Type a note and press Enter to save
  await userEvent.type(await findNewNodeEditor(), "My First Note{Enter}");

  // Verify the note appears
  await screen.findByText("My First Note");
});

test("Link Nodes from other Users", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);

  // Bob creates OOP with Java as child, using context ['ROOT']
  // This simulates Bob adding OOP to ROOT and then adding Java under it
  const oop = newNode("Object Oriented Languages");
  const java = newNode("Java");
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
  fireEvent.click(
    await screen.findByLabelText("expand Object Oriented Languages")
  );
  await screen.findByText("Java");
});

test("Default Relations are shown when adding a node from other User via search", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);

  // Bob creates OOP with Java as child, using context ['ROOT']
  const oop = newNode("Object Oriented Languages");
  const java = newNode("Java");
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
  fireEvent.click(
    await screen.findByLabelText("expand Object Oriented Languages")
  );
  await screen.findByText("Java");
});
