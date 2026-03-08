import React from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { List } from "immutable";
import { newRelations, ViewPath } from "../ViewContext";
import { execute } from "../executor";
import { createPlan, planUpsertRelations } from "../planner";
import { processEvents } from "../Data";
import {
  ALICE,
  RootViewOrPaneIsLoading,
  renderWithTestData,
  setup,
  UpdateState,
} from "../utils.test";
import { parseMarkdownHierarchy, planPasteMarkdownTrees } from "./FileDropZone";
import { joinID, shortID } from "../connections";
import { PaneView } from "./Workspace";
import { buildRelationUrl } from "../navigationUrl";

const TEST_FILE = `# Programming Languages

## Java

Java is a programming language

## Python

Python is a programming language
`;

async function uploadMarkdown(alice: UpdateState): Promise<LongID> {
  const wsID = joinID(alice().user.publicKey, "my-first-workspace");
  const basePlan = planUpsertRelations(
    createPlan(alice()),
    newRelations(wsID, List(), alice().user.publicKey)
  );
  const workspacePath: ViewPath = [0, wsID];
  const plan = planPasteMarkdownTrees(
    basePlan,
    parseMarkdownHierarchy(TEST_FILE),
    workspacePath,
    [shortID(wsID) as ID],
    0
  );
  const programmingLanguagesRelation = plan.knowledgeDBs
    .get(alice().user.publicKey)
    ?.relations.find(
      (relation) =>
        relation.text === "Programming Languages" &&
        relation.items.size === 2
    );
  if (!programmingLanguagesRelation) {
    throw new Error("Missing imported root relation");
  }
  await execute({
    ...alice(),
    plan,
  });
  return programmingLanguagesRelation.id;
}

function renderRelation(alice: UpdateState, relationID: LongID): void {
  const state = alice();
  const processed = processEvents(List(state.relayPool.getEvents()));
  renderWithTestData(
    <RootViewOrPaneIsLoading>
      <PaneView />
    </RootViewOrPaneIsLoading>,
    {
      ...state,
      knowledgeDBs: processed.map((result) => result.knowledgeDB),
      contacts: processed.map((result) => result.contacts).get(
        state.user.publicKey,
        state.contacts
      ),
      views: processed.map((result) => result.views).get(
        state.user.publicKey,
        state.views
      ),
      projectMembers: processed.map((result) => result.projectMembers).get(
        state.user.publicKey,
        state.projectMembers
      ),
      initialRoute: buildRelationUrl(relationID),
      panes: [
        {
          id: "pane-0",
          stack: [],
          author: state.user.publicKey,
          rootRelation: relationID,
        },
      ],
    }
  );
}

test("Markdown Upload creates correct tree structure", async () => {
  const [alice] = setup([ALICE]);
  const relationID = await uploadMarkdown(alice);
  renderRelation(alice, relationID);

  fireEvent.click(await screen.findByLabelText("expand Java"));
  fireEvent.click(await screen.findByLabelText("expand Python"));

  await screen.findByText("Java is a programming language");
  await screen.findByText("Python is a programming language");
});

test("Edit Node uploaded from Markdown", async () => {
  const [alice] = setup([ALICE]);
  const relationID = await uploadMarkdown(alice);
  renderRelation(alice, relationID);

  const plEditor = await screen.findByLabelText("edit Programming Languages");
  await userEvent.click(plEditor);
  await userEvent.clear(plEditor);
  await userEvent.type(plEditor, "Programming Languages OOP{Escape}");

  await screen.findByText("Java");
  await screen.findByText("Python");

  cleanup();
  renderRelation(alice, relationID);
  await screen.findByLabelText("edit Programming Languages OOP");
  await screen.findByText("Java");
  await screen.findByText("Python");
});

test("Delete Node uploaded from Markdown", async () => {
  const [alice] = setup([ALICE]);
  const relationID = await uploadMarkdown(alice);
  renderRelation(alice, relationID);
  fireEvent.click(await screen.findByLabelText("expand Python"));

  await screen.findByText("Python is a programming language");

  fireEvent.click(
    await screen.findByLabelText(
      "mark Python is a programming language as not relevant"
    )
  );
  await screen.findByText("Python");

  cleanup();
  renderRelation(alice, relationID);
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
