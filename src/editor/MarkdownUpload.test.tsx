import { List } from "immutable";
import { newNode, ViewPath } from "../ViewContext";
import { execute } from "../infra/nostr/executor";
import { createPlan, planUpsertNodes } from "../planner";
import { processEvents } from "../eventProcessing";
import { ALICE, setup, UpdateState } from "../utils.test";
import { planPasteMarkdownTrees } from "./FileDropZone";
import { parseMarkdownHierarchy } from "../core/markdownTree";
import { joinID, shortID } from "../core/connections";
import { linkSpan, nodeText, plainSpans } from "../core/nodeSpans";

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
  const workspacePath: ViewPath = [0, workspaceNode.id];
  const plan = planPasteMarkdownTrees(
    basePlan,
    parseMarkdownHierarchy(TEST_FILE),
    workspacePath,
    [nodeText(workspaceNode) as ID],
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
  const node = knowledgeDB.nodes.find(
    (candidate) => nodeText(candidate) === text
  );
  if (!node) {
    throw new Error(`Missing node: ${text}`);
  }
  return node;
}

function getChildTexts(knowledgeDB: KnowledgeData, node: GraphNode): string[] {
  return node.children
    .map((childID) => {
      const child = knowledgeDB.nodes.get(shortID(childID));
      return child ? nodeText(child) : "";
    })
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

test("Markdown parser extracts ref link whose text contains brackets", () => {
  const targetId = "abc123_def456";
  const linkedText = `Kant […] took the argument (p. 43)`;
  const parsed = parseMarkdownHierarchy(`- [${linkedText}](#${targetId})\n`);

  expect(parsed).toEqual([
    {
      spans: [linkSpan(targetId as LongID, linkedText)],
      blockKind: "list_item",
      children: [],
    },
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
      spans: plainSpans("Parent"),
      blockKind: "list_item",
      children: [
        { spans: plainSpans("Child"), children: [], blockKind: "list_item" },
        {
          spans: plainSpans("Numbered child"),
          children: [],
          blockKind: "list_item",
          listOrdered: true,
          listStart: 1,
        },
      ],
    },
  ]);
});
