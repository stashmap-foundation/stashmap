import { List } from "immutable";
import { newNode } from "../../graph/nodeFactory";
import { type RowPath } from "../../rows/rowPaths";
import { execute } from "../../executor";
import { createPlan, planUpsertNodes } from "../../planner";
import { processEvents } from "../../eventProcessing";
import { ALICE, setup, UpdateState } from "../../tests/testutils";
import { parseMarkdownHierarchy, planPasteMarkdownTrees } from "./FileDropZone";
import { joinID, shortID } from "../../graph/context";

const TEST_FILE = `# Programming Languages

## Java

Java is a programming language

## Python

Python is a programming language
`;

async function uploadMarkdown(alice: UpdateState): Promise<KnowledgeData> {
  const wsID = joinID(alice().user.publicKey, "my-first-workspace");
  const workspaceText = "my-first-workspace";
  const workspaceNode: GraphNode = {
    ...newNode(
      workspaceText,
      List(),
      alice().user.publicKey,
      shortID(wsID) as ID
    ),
    id: wsID,
    root: shortID(wsID) as ID,
  };
  const basePlan = planUpsertNodes(createPlan(alice()), workspaceNode);
  const workspacePath: RowPath = [0, workspaceNode.id];
  const plan = planPasteMarkdownTrees(
    basePlan,
    parseMarkdownHierarchy(TEST_FILE),
    workspacePath,
    [workspaceNode.text as ID],
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

function getRequiredNode(knowledgeDB: KnowledgeData, text: string): GraphNode {
  const node = knowledgeDB.nodes.find((candidate) => candidate.text === text);
  if (!node) {
    throw new Error(`Missing node: ${text}`);
  }
  return node;
}

function getChildTexts(knowledgeDB: KnowledgeData, node: GraphNode): string[] {
  return node.children
    .map((childID) => knowledgeDB.nodes.get(shortID(childID))?.text || "")
    .toArray();
}

test("Markdown upload persists imported tree structure", async () => {
  const [alice] = setup([ALICE]);
  const knowledgeDB = await uploadMarkdown(alice);

  const programmingLanguages = getRequiredNode(
    knowledgeDB,
    "Programming Languages"
  );
  const java = getRequiredNode(knowledgeDB, "Java");
  const python = getRequiredNode(knowledgeDB, "Python");

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
      blockKind: "list_item",
      children: [
        { text: "Child", children: [], blockKind: "list_item" },
        { text: "Numbered child", children: [], blockKind: "list_item" },
      ],
    },
  ]);
});
