import { List, Map } from "immutable";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import {
  createPlan,
  Plan,
  planAddToParent,
  planUpsertNode,
  planUpsertRelations,
  planUpdateViews,
} from "../planner";
import { addRelationToRelations, hashText, newNode } from "../connections";
import {
  getRelationsForContext,
  newRelations,
  NodeIndex,
  ViewPath,
  viewPathToString,
} from "../ViewContext";
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
  const [plan, topNodeIDs] = planCreateNodesFromMarkdownTrees(basePlan, trees);
  const parentID = topNodeIDs[0];
  const childID = hashText("Child") as ID;

  const standaloneParentRelation = getRelationsForContext(
    plan.knowledgeDBs,
    plan.user.publicKey,
    parentID,
    List<ID>(),
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

  expect(standaloneParentRelation?.items.first()?.nodeID).toEqual(childID);
  expect(standaloneChildRelation?.items.first()?.nodeID).toEqual(
    hashText("Grandchild")
  );
});

function setupRootPlan(aliceState: () => Parameters<typeof createPlan>[0]): {
  plan: Plan;
  parentPath: ViewPath;
  stack: ID[];
} {
  const pk = aliceState().user.publicKey;
  const root = newNode("Root");
  const rootRelations = newRelations(root.id, List(), pk);
  const planWithRoot = planUpsertRelations(
    planUpsertNode(createPlan(aliceState()), root),
    rootRelations
  );
  const parentPath: ViewPath = [
    0,
    { nodeID: root.id, nodeIndex: 0 as NodeIndex },
  ];
  const views = Map<string, View>().set(viewPathToString(parentPath), {
    expanded: true,
  });
  const plan = planUpdateViews(
    {
      ...planWithRoot,
      panes: [{ id: "pane-0", stack: [root.id], author: pk }],
    },
    views
  );
  return { plan, parentPath, stack: [root.id] };
}

test("planPasteMarkdownTrees moves children to parent context", () => {
  const [alice] = setup([ALICE]);
  const { plan: basePlan, parentPath, stack } = setupRootPlan(alice);

  const trees = parseMarkdownImportFiles([
    { name: "t.md", markdown: "# City\n\n## Vienna" },
  ]);
  const plan = planPasteMarkdownTrees(basePlan, trees, parentPath, stack, 0);

  const cityID = hashText("City") as ID;
  const rootID = hashText("Root") as ID;

  const cityRelation = getRelationsForContext(
    plan.knowledgeDBs,
    plan.user.publicKey,
    cityID,
    List<ID>([rootID]),
    undefined,
    false
  );
  expect(cityRelation?.items.first()?.nodeID).toEqual(hashText("Vienna"));
});

test("planPasteMarkdownTrees: collision does not shadow existing children", () => {
  const [alice] = setup([ALICE]);
  const { plan: basePlan, parentPath, stack } = setupRootPlan(alice);

  const existingCity = newNode("City");
  const existingVienna = newNode("Vienna");
  const rootID = hashText("Root") as ID;
  const cityRelations = addRelationToRelations(
    newRelations(existingCity.id, List<ID>([rootID]), basePlan.user.publicKey),
    existingVienna.id
  );
  const withExisting = planUpsertRelations(
    planUpsertNode(planUpsertNode(basePlan, existingCity), existingVienna),
    cityRelations
  );
  const [withCityAdded] = planAddToParent(
    withExisting,
    existingCity.id,
    parentPath,
    stack,
    0
  );

  const trees = parseMarkdownImportFiles([
    { name: "p.md", markdown: "# City\n\n## Paris" },
  ]);
  const plan = planPasteMarkdownTrees(
    withCityAdded,
    trees,
    parentPath,
    stack,
    0
  );

  const existingCityRel = getRelationsForContext(
    plan.knowledgeDBs,
    plan.user.publicKey,
    hashText("City") as ID,
    List<ID>([rootID]),
    undefined,
    false
  );
  expect(
    existingCityRel?.items.some((i) => i.nodeID === hashText("Vienna"))
  ).toBe(true);
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
