import { List } from "immutable";
import { createPlan } from "../planner";
import { hashText } from "../connections";
import { getRelationsForContext } from "../ViewContext";
import { ALICE, setup } from "../utils.test";
import {
  buildRootTreeForEmptyRootDrop,
  parseMarkdownHierarchy,
  parseMarkdownImportFiles,
  planCreateNodesFromMarkdownFiles,
  planCreateNodesFromMarkdownTrees,
} from "./FileDropZone";

function flattenTexts(
  nodes: { text: string; children: unknown[] }[]
): string[] {
  return nodes.reduce((acc: string[], node) => {
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

test("Planning markdown trees with context writes contextual and standalone relations", () => {
  const [alice] = setup([ALICE]);
  const basePlan = createPlan(alice());
  const context = List<ID>(["workspace-root" as ID]);

  const trees = parseMarkdownImportFiles([
    {
      name: "topic.md",
      markdown: "# Parent\n\n## Child\n\n### Grandchild",
    },
  ]);
  const [plan, topNodeIDs] = planCreateNodesFromMarkdownTrees(
    basePlan,
    trees,
    context
  );
  const parentID = topNodeIDs[0];
  const childID = hashText("Child") as ID;

  const contextualParentRelation = getRelationsForContext(
    plan.knowledgeDBs,
    plan.user.publicKey,
    parentID,
    context,
    undefined,
    false
  );
  const standaloneParentRelation = getRelationsForContext(
    plan.knowledgeDBs,
    plan.user.publicKey,
    parentID,
    List<ID>(),
    undefined,
    false
  );
  const contextualChildRelation = getRelationsForContext(
    plan.knowledgeDBs,
    plan.user.publicKey,
    childID,
    context.push(parentID),
    undefined,
    false
  );
  const standaloneChildRelation = getRelationsForContext(
    plan.knowledgeDBs,
    plan.user.publicKey,
    childID,
    List<ID>([parentID]),
    undefined,
    false
  );

  expect(contextualParentRelation?.items.first()?.nodeID).toEqual(childID);
  expect(standaloneParentRelation?.items.first()?.nodeID).toEqual(childID);
  expect(contextualChildRelation?.items.first()?.nodeID).toEqual(
    hashText("Grandchild")
  );
  expect(standaloneChildRelation?.items.first()?.nodeID).toEqual(
    hashText("Grandchild")
  );
});

test("Planning multiple markdown files returns top nodes in import order", () => {
  const [alice] = setup([ALICE]);
  const basePlan = createPlan(alice());

  const [plan, topNodeIDs] = planCreateNodesFromMarkdownFiles(basePlan, [
    { name: "one.md", markdown: "# One" },
    { name: "two.md", markdown: "# Two" },
  ]);

  expect(topNodeIDs).toEqual([hashText("One"), hashText("Two")]);
  expect(
    plan.knowledgeDBs.get(plan.user.publicKey)?.nodes.has(hashText("One"))
  ).toBe(true);
  expect(
    plan.knowledgeDBs.get(plan.user.publicKey)?.nodes.has(hashText("Two"))
  ).toBe(true);
});
