import { List } from "immutable";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { KIND_KNOWLEDGE_DOCUMENT } from "../nostr";
import {
  createPlan,
  Plan,
} from "../planner";
import {
  getTextForSemanticID,
  getRelationsNoReferencedBy,
  getRelationSemanticID,
} from "../connections";
import {
  ALICE,
  expectTree,
  navigateToNodeViaSearch,
  renderApp,
  renderTree,
  setup,
} from "../utils.test";
import { execute } from "../executor";
import {
  buildRootTreeForEmptyRootDrop,
  parseMarkdownHierarchy,
  parseMarkdownImportFiles,
  parseTextToTrees,
  planCreateNodesFromMarkdown,
  planCreateNodesFromMarkdownFiles,
  planCreateNodesFromMarkdownTrees,
  planPasteMarkdownTrees,
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
        { text: "Phase 1", children: [] },
        { text: "Phase 2", children: [] },
      ],
    },
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
      children: [
        { text: "Child", children: [] },
        { text: "Numbered Child", children: [] },
      ],
    },
  ]);

  const allTexts = flattenTexts(trees);
  expect(allTexts.every((text) => !/^[-+*]|\d+\./u.test(text))).toBe(true);
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

test("planCreateNodesFromMarkdownTrees creates only standalone relations", () => {
  const [alice] = setup([ALICE]);
  const basePlan = createPlan(alice());

  const trees = parseMarkdownImportFiles([
    {
      name: "topic.md",
      markdown: "# Parent\n\n## Child\n\n### Grandchild",
    },
  ]);
  const [plan, topNodeIDs, topRelationIDs] = planCreateNodesFromMarkdownTrees(
    basePlan,
    trees
  );
  const parentID = topNodeIDs[0];
  const parentRelation = getRelationsNoReferencedBy(
    plan.knowledgeDBs,
    topRelationIDs[0],
    plan.user.publicKey
  );
  const childRelationID = parentRelation?.items.first()?.id as LongID | undefined;
  const childRelation = childRelationID
    ? getRelationsNoReferencedBy(
        plan.knowledgeDBs,
        childRelationID,
        plan.user.publicKey
      )
    : undefined;
  const grandchildRelationID = childRelation?.items.first()?.id as
    | LongID
    | undefined;
  const grandchildRelation = grandchildRelationID
    ? getRelationsNoReferencedBy(
        plan.knowledgeDBs,
        grandchildRelationID,
        plan.user.publicKey
      )
    : undefined;

  expect(parentRelation).toBeDefined();
  expect(childRelation?.text).toBe("Child");
  expect(grandchildRelation?.text).toBe("Grandchild");

  expect(parentID).toEqual(getRelationSemanticID(parentRelation!));
  expect(parentRelation?.items.first()?.id).toEqual(childRelation?.id);
  expect(
    getTextForSemanticID(
      plan.knowledgeDBs,
      getRelationSemanticID(childRelation!),
      plan.user.publicKey
    )
  ).toBe("Child");
  expect(childRelation?.items.first()?.id).toEqual(grandchildRelation?.id);
  expect(
    getTextForSemanticID(
      plan.knowledgeDBs,
      getRelationSemanticID(grandchildRelation!),
      plan.user.publicKey
    )
  ).toBe("Grandchild");
});

test("Planning multiple markdown files returns top nodes in import order", () => {
  const [alice] = setup([ALICE]);
  const basePlan = createPlan(alice());

  const [plan, topNodeIDs] = planCreateNodesFromMarkdownFiles(basePlan, [
    { name: "one.md", markdown: "# One" },
    { name: "two.md", markdown: "# Two" },
  ]);

  const topTexts = topNodeIDs.map(
    (id) => getTextForSemanticID(plan.knowledgeDBs, id, plan.user.publicKey)
  );

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
      children: [{ text: "Child", children: [] }],
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
