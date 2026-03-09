import { List } from "immutable";
import { newRelations, ViewPath } from "../ViewContext";
import { execute } from "../executor";
import { createPlan, planUpsertRelations } from "../planner";
import { processEvents } from "../Data";
import { ALICE, setup, UpdateState } from "../utils.test";
import { parseMarkdownHierarchy, planPasteMarkdownTrees } from "./FileDropZone";
import { joinID, shortID } from "../connections";

const TEST_FILE = `# Programming Languages

## Java

Java is a programming language

## Python

Python is a programming language
`;

async function uploadMarkdown(alice: UpdateState): Promise<KnowledgeData> {
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

  await execute({
    ...alice(),
    plan,
  });

  const processed = processEvents(List(alice().relayPool.getEvents()));
  const knowledgeDB = processed.get(alice().user.publicKey)?.knowledgeDB;
  if (!knowledgeDB) {
    throw new Error("Missing uploaded knowledge DB");
  }
  return knowledgeDB;
}

function getRequiredRelation(
  knowledgeDB: KnowledgeData,
  text: string
): Relations {
  const relation = knowledgeDB.relations.find(
    (candidate) => candidate.text === text
  );
  if (!relation) {
    throw new Error(`Missing relation: ${text}`);
  }
  return relation;
}

function getChildTexts(
  knowledgeDB: KnowledgeData,
  relation: Relations
): string[] {
  return relation.items
    .map((item) => knowledgeDB.relations.get(shortID(item.id))?.text || "")
    .toArray();
}

test("Markdown upload persists imported tree structure", async () => {
  const [alice] = setup([ALICE]);
  const knowledgeDB = await uploadMarkdown(alice);

  const programmingLanguages = getRequiredRelation(
    knowledgeDB,
    "Programming Languages"
  );
  const java = getRequiredRelation(knowledgeDB, "Java");
  const python = getRequiredRelation(knowledgeDB, "Python");

  expect(getChildTexts(knowledgeDB, programmingLanguages)).toEqual([
    "Java",
    "Python",
  ]);
  expect(getChildTexts(knowledgeDB, java)).toEqual([
    "Java is a programming language",
  ]);
  expect(getChildTexts(knowledgeDB, python)).toEqual([
    "Python is a programming language",
  ]);
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
