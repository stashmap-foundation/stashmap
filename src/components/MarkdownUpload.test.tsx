import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { List } from "immutable";
import { newRelations } from "../ViewContext";
import { execute } from "../executor";
import { createPlan, planUpsertRelations } from "../planner";
import { ALICE, renderTree, setup, UpdateState, expectTree } from "../utils.test";
import { planCreateNodesFromMarkdown } from "./FileDropZone";
import { addRelationToRelations, joinID, shortID } from "../connections";

const TEST_FILE = `# Programming Languages

## Java

Java is a programming language

## Python

Python is a programming language
`;

async function uploadMarkdown(alice: UpdateState): Promise<void> {
  const wsID = joinID(alice().user.publicKey, "my-first-workspace");
  const [plan, topNodeID] = planCreateNodesFromMarkdown(
    createPlan(alice()),
    TEST_FILE,
    List([shortID(wsID)])
  );
  const addNodeToWS = planUpsertRelations(
    plan,
    addRelationToRelations(
      newRelations(wsID, List(), alice().user.publicKey),
      topNodeID
    )
  );
  await execute({
    ...alice(),
    plan: addNodeToWS,
  });
}

async function navigateToProgrammingLanguages(): Promise<void> {
  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );
  await userEvent.type(
    await screen.findByLabelText("search input"),
    "Programming Languages"
  );
  await userEvent.click(
    await screen.findByLabelText("select Programming Languages")
  );
  await screen.findByLabelText(/expand Programming Languages|collapse Programming Languages/);
}

test("Markdown Upload creates correct tree structure", async () => {
  const [alice] = setup([ALICE]);
  await uploadMarkdown(alice);
  renderTree(alice);

  await navigateToProgrammingLanguages();
  await userEvent.click(
    await screen.findByLabelText("expand Programming Languages")
  );

  await expectTree(`
Programming Languages
  Java
  Java is a programming language
  Python
  Python is a programming language
  `);
});

test("Edit Node uploaded from Markdown", async () => {
  const [alice] = setup([ALICE]);
  await uploadMarkdown(alice);
  renderTree(alice);

  await navigateToProgrammingLanguages();

  const plEditor = await screen.findByLabelText("edit Programming Languages");
  await userEvent.click(plEditor);
  await userEvent.clear(plEditor);
  await userEvent.type(plEditor, "Programming Languages OOP{Escape}");

  await expectTree(`
Programming Languages OOP
  `);

  cleanup();
  renderTree(alice);

  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );
  await userEvent.type(
    await screen.findByLabelText("search input"),
    "Programming Languages OOP"
  );
  await userEvent.click(
    await screen.findByLabelText("select Programming Languages OOP")
  );

  await expectTree(`
Programming Languages OOP
  `);
});

test("Delete Node uploaded from Markdown", async () => {
  const [alice] = setup([ALICE]);
  await uploadMarkdown(alice);
  renderTree(alice);

  await navigateToProgrammingLanguages();
  await userEvent.click(
    await screen.findByLabelText("expand Programming Languages")
  );

  await expectTree(`
Programming Languages
  Java
  Java is a programming language
  Python
  Python is a programming language
  `);

  fireEvent.click(await screen.findByLabelText("mark Python as not relevant"));

  await expectTree(`
Programming Languages
  Java
  Java is a programming language
  Python is a programming language
  `);

  cleanup();
  renderTree(alice);

  await navigateToProgrammingLanguages();
  await userEvent.click(
    await screen.findByLabelText("expand Programming Languages")
  );

  await expectTree(`
Programming Languages
  Java
  Java is a programming language
  Python is a programming language
  `);
});
