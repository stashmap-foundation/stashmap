import { screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  const oop = newNode("Object Oriented Languages", bob().user.publicKey);
  const java = newNode("Java", bob().user.publicKey);
  const relations = addRelationToRelations(
    newRelations(oop.id, "" as ID, bob().user.publicKey),
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
  const view = renderApp({ ...alice(), includeFocusContext: true });
  await typeNewNode(view, "Programming Languages");

  // Expand "Programming Languages" by clicking its relation button
  const expandButton = await screen.findByLabelText(
    "create relevant to for Programming Languages"
  );
  fireEvent.click(expandButton);

  const searchButton = await screen.findByLabelText(
    "search and attach to Programming Languages"
  );
  fireEvent.click(searchButton);
  const searchInput = await screen.findByLabelText("search input");
  await userEvent.type(searchInput, "Object");
  fireEvent.click(
    await screen.findByText(matchSplitText("Object Oriented Languages"))
  );
  // Open the relations
  fireEvent.click(
    await screen.findByLabelText(
      "show items relevant for Object Oriented Languages"
    )
  );
  await screen.findByText("Java");
});

test("Default Relations are shown when adding a node from other User via search", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);

  const oop = newNode("Object Oriented Languages", bob().user.publicKey);
  const java = newNode("Java", bob().user.publicKey);
  const relations = addRelationToRelations(
    newRelations(oop.id, "" as ID, bob().user.publicKey),
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

  // Click search button to open search
  const searchButton = await screen.findByLabelText(
    "search and attach to My Notes"
  );
  fireEvent.click(searchButton);
  const searchInput = await screen.findByLabelText("search input");
  await userEvent.type(searchInput, "Object");
  fireEvent.click(
    await screen.findByText(matchSplitText("Object Oriented Languages"))
  );

  // Open the added node in fullscreen to see its relations
  const fullscreenButtons = await screen.findAllByLabelText("open fullscreen");
  fireEvent.click(fullscreenButtons[0]);

  await screen.findByLabelText(
    "show items relevant for Object Oriented Languages"
  );
  screen.getByText("Java");
});
