import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { List } from "immutable";
import { newRelations } from "../ViewContext";
import { execute } from "../executor";
import { createPlan, planUpsertRelations } from "../planner";
import {
  ALICE,
  navigateToNodeViaSearch,
  renderTree,
  setup,
  UpdateState,
} from "../utils.test";
import {
  parseMarkdownHierarchy,
  planCreateNodesFromMarkdown,
} from "./FileDropZone";
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
  await navigateToNodeViaSearch(0, "Programming Languages");
  await screen.findByLabelText(
    /expand Programming Languages|collapse Programming Languages/
  );
}

test("Markdown Upload creates correct tree structure", async () => {
  const [alice] = setup([ALICE]);
  await uploadMarkdown(alice);
  renderTree(alice);

  await navigateToProgrammingLanguages();

  fireEvent.click(await screen.findByLabelText("expand Java"));
  fireEvent.click(await screen.findByLabelText("expand Python"));

  await screen.findByText("Java is a programming language");
  await screen.findByText("Python is a programming language");
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

  await screen.findByText("Programming Languages OOP");
  await screen.findByText("Java");
  await screen.findByText("Python");

  cleanup();
  renderTree(alice);

  await navigateToNodeViaSearch(0, "Programming Languages");
  await screen.findByText("Programming Languages OOP");
  await screen.findByText("Java");
  await screen.findByText("Python");
});

test("Delete Node uploaded from Markdown", async () => {
  const [alice] = setup([ALICE]);
  await uploadMarkdown(alice);
  renderTree(alice);

  await navigateToProgrammingLanguages();
  fireEvent.click(await screen.findByLabelText("expand Python"));

  await screen.findByText("Python is a programming language");

  fireEvent.click(
    await screen.findByLabelText(
      "mark Python is a programming language as not relevant"
    )
  );
  expect(screen.queryByText("Python is a programming language")).toBeNull();
  await screen.findByText("Python");

  cleanup();
  renderTree(alice);

  await navigateToProgrammingLanguages();
  await screen.findByText("Python");
  expect(screen.queryByText("Python is a programming language")).toBeNull();
});

test("Markdown parser preserves list nesting and strips list markers", () => {
  const parsed = parseMarkdownHierarchy(`
- Parent
  - Child
  1. Numbered child
  `);

  expect(parsed).toEqual([
    {
      text: "Parent",
      children: [
        { text: "Child", children: [] },
        { text: "Numbered child", children: [] },
      ],
    },
  ]);
});
