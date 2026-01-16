import { screen, fireEvent, waitFor } from "@testing-library/react";
import { List } from "immutable";
import { addRelationToRelations, newNode } from "../connections";
import {
  ALICE,
  BOB,
  matchSplitText,
  renderApp,
  setup,
  follow,
} from "../utils.test";
import { execute } from "../executor";
import { createPlan, planUpsertNode, planUpsertRelations } from "../planner";
import { newRelations } from "../ViewContext";

test("Bionic Reading", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);

  // Create a note owned by Bob (so it's read-only for Alice and shows bionic reading)
  const note = newNode("My first quote", bob().user.publicKey);
  // Add to Alice's ROOT relations so she can see it
  const rootRelations = addRelationToRelations(
    newRelations("ROOT", List(), alice().user.publicKey),
    note.id
  );
  // Execute Bob's node creation
  await execute({
    ...bob(),
    plan: planUpsertNode(createPlan(bob()), note),
  });
  // Execute Alice's relation to see the node
  await execute({
    ...alice(),
    plan: planUpsertRelations(createPlan(alice()), rootRelations),
  });

  renderApp(alice());

  await screen.findByText("My first quote");
  fireEvent.click(screen.getByLabelText("open menu"));
  fireEvent.click(await screen.findByLabelText("switch bionic reading on"));
  await waitFor(() => {
    expect(screen.queryByText("My first quote")).toBeNull();
  });
  expect(screen.getByText(matchSplitText("My first quote")).innerHTML).toEqual(
    "<b>M</b>y <b>fi</b>rst <b>qu</b>ote"
  );
});
