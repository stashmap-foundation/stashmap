import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { List } from "immutable";
import { addRelationToRelations, newNode } from "../connections";
import {
  setup,
  ALICE,
  renderApp,
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

test("Add note via keyboard on empty tree", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  // Wait for My Notes to appear (ROOT node)
  await screen.findByLabelText("collapse My Notes");

  // Click the editor and press Enter to create a new node
  await userEvent.click(await screen.findByLabelText("edit My Notes"));
  await userEvent.keyboard("{Enter}");

  // Type a note and press Enter to save
  await userEvent.type(await findNewNodeEditor(), "My First Note{Enter}");

  // Verify the note appears
  await screen.findByText("My First Note");
});

