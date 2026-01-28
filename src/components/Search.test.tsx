import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { List } from "immutable";
import {
  ALICE,
  expectTree,
  findNewNodeEditor,
  renderTree,
  setup,
} from "../utils.test";
import { newNode, addRelationToRelations } from "../connections";
import { newRelations } from "../ViewContext";
import { createPlan, planUpsertNode, planUpsertRelations } from "../planner";
import { execute } from "../executor";

describe("Search", () => {
  test("Search finds nodes that are children of other nodes", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create a node under My Notes
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(await screen.findByLabelText("add to My Notes"));
    await userEvent.type(await findNewNodeEditor(), "Findable Child{Escape}");

    await expectTree(`
My Notes
  Findable Child
    `);

    // Search for the node
    await userEvent.click(
      await screen.findByLabelText("Search to change pane 0 content")
    );
    await userEvent.type(
      await screen.findByLabelText("search input"),
      "Findable Child{Enter}"
    );

    // Should find the node as a reference showing where it's referenced from
    await expectTree(`
Search: Findable Child
  My Notes (1) → Findable Child
    `);
  });

  test("Search finds nodes that are list heads (have children but no parent)", async () => {
    const [alice] = setup([ALICE]);
    const { publicKey: alicePK } = alice().user;

    // Create a node that is a list head (has children but isn't in any other list)
    const parentNode = newNode("Orphan Parent");
    const childNode = newNode("Child of Orphan");

    const relations = addRelationToRelations(
      newRelations(parentNode.id, List(), alicePK),
      childNode.id
    );

    const plan = planUpsertRelations(
      planUpsertNode(
        planUpsertNode(createPlan(alice()), parentNode),
        childNode
      ),
      relations
    );
    await execute({ ...alice(), plan });

    renderTree(alice);

    // Search for the parent node
    await userEvent.click(
      await screen.findByLabelText("Search to change pane 0 content")
    );
    await userEvent.type(
      await screen.findByLabelText("search input"),
      "Orphan Parent{Enter}"
    );

    // Should find the node - shown with item count since it's a list head
    await expectTree(`
Search: Orphan Parent
  Orphan Parent (1)
    `);
  });
});
