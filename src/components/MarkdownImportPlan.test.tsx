import { List } from "immutable";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { createPlan, buildDocumentEvents } from "../planner";
import { getChildNodes, getNode, getSemanticID } from "../connections";
import { isStandaloneRoot } from "../systemRoots";
import {
  ALICE,
  expectTree,
  navigateToNodeViaSearch,
  renderApp,
  renderTree,
  setup,
} from "../utils.test";
import { execute } from "../executor";
import { processEvents } from "../eventProcessing";
import {
  buildRootTreeForEmptyRootDrop,
  dropLeadingYamlEchoRoots,
  parseMarkdownHierarchy,
  parseMarkdownImportFiles,
  parseTextToTrees,
  planCreateNodesFromMarkdown,
  planCreateNodesFromMarkdownFiles,
  planCreateNodesFromMarkdownTrees,
} from "./FileDropZone";

function flattenTexts(
  nodes: { text: string; children: unknown[] }[]
): string[] {
  return nodes.reduce((acc: string[], node) => {
    // eslint-disable-next-line testing-library/no-node-access
    const children = node.children as { text: string; children: unknown[] }[];
    return [...acc, node.text, ...flattenTexts(children)];
  }, []);
}

function nodeChildren(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode | undefined,
  myself: PublicKey
): List<GraphNode> {
  return node ? getChildNodes(knowledgeDBs, node, myself) : List<GraphNode>();
}

test("Single file with multiple top-level roots is wrapped by filename", () => {
  const trees = parseMarkdownImportFiles([
    {
      name: "roadmap.md",
      markdown: "# Phase 1\n\n# Phase 2",
    },
  ]);

  expect(trees).toEqual([
    {
      text: "roadmap",
      children: [
        {
          text: "Phase 1",
          children: [],
          blockKind: "heading",
          headingLevel: 1,
        },
        {
          text: "Phase 2",
          children: [],
          blockKind: "heading",
          headingLevel: 1,
        },
      ],
    },
  ]);
});

test("Front matter is not rendered and title can supply the import root", () => {
  const trees = parseMarkdownImportFiles([
    {
      name: "problem.md",
      markdown: `---
title: "Imported Title"
source_id: "src_problem"
---

- first
- second
`,
    },
  ]);

  expect(trees).toEqual([
    {
      text: "Imported Title",
      frontMatter: `---
title: "Imported Title"
source_id: "src_problem"
---
`,
      children: [
        {
          text: "first",
          children: [],
          blockKind: "list_item",
        },
        {
          text: "second",
          children: [],
          blockKind: "list_item",
        },
      ],
    },
  ]);
});

test("Imported front matter stays out of the rendered tree after document-event roundtrip", () => {
  const [alice] = setup([ALICE]);
  const basePlan = createPlan(alice());
  const [plan] = planCreateNodesFromMarkdownFiles(basePlan, [
    {
      name: "problem.md",
      markdown: `---
title: "Alice and Bob Huddle"
authors:
  - "Alice"
  - "Bob"
tags:
  - transcript
  - meeting
---

- First point
- Second point
`,
    },
  ]);

  const events = buildDocumentEvents(plan);
  const processed = processEvents(events);
  const knowledgeDB = processed.get(alice().user.publicKey)?.knowledgeDB;
  const texts = knowledgeDB?.nodes
    .valueSeq()
    .map((node) => node.text)
    .toArray();

  expect(texts).toContain("Alice and Bob Huddle");
  expect(texts).toContain("First point");
  expect(texts).toContain("Second point");
  expect(texts).not.toContain('title: "Alice and Bob Huddle"');
  expect(texts).not.toContain("authors:");
  expect(texts).not.toContain("Alice");
  expect(texts).not.toContain("Bob");
  expect(texts).not.toContain("tags:");
  expect(texts).not.toContain("transcript");
  expect(texts).not.toContain("meeting");
});

test("Leading YAML-like roots are dropped when front matter exists", () => {
  const cleaned = dropLeadingYamlEchoRoots(
    [
      { text: 'source_id: "src_1"', children: [], blockKind: "paragraph" },
      { text: "authors:", children: [{ text: "Alice", children: [] }] },
      { text: "First point", children: [], blockKind: "list_item" },
    ],
    '---\ntitle: "Doc"\n---\n'
  );

  expect(cleaned).toEqual([
    { text: "First point", children: [], blockKind: "list_item" },
  ]);
});

test("Multiple markdown files preserve file order", () => {
  const trees = parseMarkdownImportFiles([
    { name: "a.md", markdown: "# Alpha" },
    { name: "b.md", markdown: "# Beta" },
  ]);

  expect(trees.map((tree) => tree.text)).toEqual(["Alpha", "Beta"]);
});

test("Parser strips leading list markers and keeps nesting", () => {
  const trees = parseMarkdownHierarchy(`
- Parent
  - Child
  1. Numbered Child
`);

  expect(trees).toEqual([
    {
      text: "Parent",
      blockKind: "list_item",
      children: [
        { text: "Child", children: [], blockKind: "list_item" },
        {
          text: "Numbered Child",
          children: [],
          blockKind: "list_item",
          listOrdered: true,
          listStart: 1,
        },
      ],
    },
  ]);

  const allTexts = flattenTexts(trees);
  expect(allTexts.every((text) => !/^[-+*]|\d+\./u.test(text))).toBe(true);
});

test("Parser turns hard-wrapped list item breaks into spaces", () => {
  const trees = parseMarkdownHierarchy(`
- The Endogenous personality is the 'inner' Man; a person whose outlook on life
is 'inward.' He is inner-directed, inner-driven, inner-motivated; one who uses
inner modes of thinking, inner evaluations, intuition; one who is to a high
degree autonomous, self-sufficient; one who is relatively indifferent to
social pressures, influences and inducements. He stands in stark contrast
`);

  expect(trees).toEqual([
    {
      text: [
        "The Endogenous personality is the 'inner' Man; a person whose outlook on life",
        "is 'inward.' He is inner-directed, inner-driven, inner-motivated; one who uses",
        "inner modes of thinking, inner evaluations, intuition; one who is to a high",
        "degree autonomous, self-sufficient; one who is relatively indifferent to",
        "social pressures, influences and inducements. He stands in stark contrast",
      ].join(" "),
      blockKind: "list_item",
      children: [],
    },
  ]);
});

test("Empty-root drop wrapper is only used for multiple imported trees", () => {
  const singleTree = [{ text: "Only", children: [] }];
  expect(buildRootTreeForEmptyRootDrop(singleTree)).toEqual(singleTree[0]);

  const multipleTrees = [
    { text: "One", children: [] },
    { text: "Two", children: [] },
  ];
  expect(buildRootTreeForEmptyRootDrop(multipleTrees)).toEqual({
    text: "Imported Markdown Files",
    children: multipleTrees,
  });
});

test("planCreateNodesFromMarkdownTrees creates only standalone nodes", () => {
  const [alice] = setup([ALICE]);
  const basePlan = createPlan(alice());

  const trees = parseMarkdownImportFiles([
    {
      name: "topic.md",
      markdown: "# Parent\n\n## Child\n\n### Grandchild",
    },
  ]);
  const [plan, topItemIDs, topNodeIDs] = planCreateNodesFromMarkdownTrees(
    basePlan,
    trees
  );
  const parentItemID = topItemIDs[0];
  const parentNodeID = topNodeIDs[0];
  const parentNode = getNode(
    plan.knowledgeDBs,
    parentNodeID,
    plan.user.publicKey
  );
  const childNodeID = nodeChildren(
    plan.knowledgeDBs,
    parentNode,
    plan.user.publicKey
  ).first()?.id as LongID | undefined;
  const childNode = childNodeID
    ? getNode(plan.knowledgeDBs, childNodeID, plan.user.publicKey)
    : undefined;
  const grandchildNodeID = nodeChildren(
    plan.knowledgeDBs,
    childNode,
    plan.user.publicKey
  ).first()?.id as LongID | undefined;
  const grandchildNode = grandchildNodeID
    ? getNode(plan.knowledgeDBs, grandchildNodeID, plan.user.publicKey)
    : undefined;

  expect(parentNode).toBeDefined();
  expect(childNode?.text).toBe("Child");
  expect(grandchildNode?.text).toBe("Grandchild");

  expect(parentItemID).toEqual(getSemanticID(plan.knowledgeDBs, parentNode!));
  expect(
    nodeChildren(plan.knowledgeDBs, parentNode, plan.user.publicKey).first()?.id
  ).toEqual(childNode?.id);
  expect(childNode?.text).toBe("Child");
  expect(
    nodeChildren(plan.knowledgeDBs, childNode, plan.user.publicKey).first()?.id
  ).toEqual(grandchildNode?.id);
  expect(grandchildNode?.text).toBe("Grandchild");
});

test("Planning multiple markdown files returns top nodes in import order", () => {
  const [alice] = setup([ALICE]);
  const basePlan = createPlan(alice());

  const [plan, topNodeIDs] = planCreateNodesFromMarkdownFiles(basePlan, [
    { name: "one.md", markdown: "# One" },
    { name: "two.md", markdown: "# Two" },
  ]);

  const topTexts = topNodeIDs.map((semanticID) => {
    return plan.knowledgeDBs
      .get(plan.user.publicKey)
      ?.nodes.valueSeq()
      .find(
        (node) =>
          isStandaloneRoot(node) &&
          getSemanticID(plan.knowledgeDBs, node) === semanticID
      )?.text;
  });

  expect(topTexts).toEqual(["One", "Two"]);
});

test("same-named siblings and grandchildren get independent children", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  const markdown = [
    "# Money",
    "## Bitcoin",
    "### Is Orange",
    "because it's good",
    "### Is Orange",
    "because it's wild",
    "## Bitcoin",
    "### Is Awesome",
    "## Bitcoin",
    "### Is Cool",
  ].join("\n");

  const [plan] = planCreateNodesFromMarkdown(createPlan(alice()), markdown);
  await execute({
    ...alice(),
    plan,
  });

  cleanup();
  renderTree(alice);
  await navigateToNodeViaSearch(0, "Money");

  fireEvent.click((await screen.findAllByLabelText(/^expand Bitcoin/))[0]);
  fireEvent.click((await screen.findAllByLabelText(/^expand Bitcoin/))[0]);
  fireEvent.click((await screen.findAllByLabelText(/^expand Bitcoin/))[0]);

  fireEvent.click((await screen.findAllByLabelText(/^expand Is Orange/))[0]);
  fireEvent.click((await screen.findAllByLabelText(/^expand Is Orange/))[0]);

  await expectTree(`
Money
  Bitcoin
    Is Orange
      because it's good
    Is Orange
      because it's wild
  Bitcoin
    Is Awesome
  Bitcoin
    Is Cool
  `);
});

test("parseTextToTrees detects markdown headers", () => {
  const headerTrees = parseTextToTrees("# Root\n## Child");
  expect(headerTrees).toEqual([
    {
      text: "Root",
      children: [
        {
          text: "Child",
          children: [],
          blockKind: "heading",
          headingLevel: 2,
        },
      ],
      blockKind: "heading",
      headingLevel: 1,
    },
  ]);
});

test("parseTextToTrees falls back to indentation parser", () => {
  const indentTrees = parseTextToTrees("Root\n\tChild\n\t\tGrandchild");
  expect(indentTrees).toEqual([
    {
      text: "Root",
      children: [
        {
          text: "Child",
          children: [{ text: "Grandchild", children: [] }],
        },
      ],
    },
  ]);
});
