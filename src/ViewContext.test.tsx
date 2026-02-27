import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { List, Map } from "immutable";
import {
  newNode,
  addRelationToRelations,
  bulkAddRelations,
  shortID,
  createConcreteRefId,
} from "./connections";
import { execute } from "./executor";
import {
  createPlan,
  planBulkUpsertNodes,
  planUpsertRelations,
} from "./planner";
import {
  renderWithTestData,
  ALICE,
  setup,
  setupTestDB,
  expectTree,
  findNewNodeEditor,
  BOB,
  follow,
  renderApp,
  renderTree,
  type,
} from "./utils.test";
import {
  RootViewContextProvider,
  calculateIndexFromNodeIndex,
  calculateNodeIndex,
  newRelations,
  parseViewPath,
  viewPathToString,
  updateViewPathsAfterDisconnect,
  updateViewPathsAfterPaneDelete,
  updateViewPathsAfterPaneInsert,
  updateViewPathsAfterMoveRelations,
  NodeIndex,
  ViewPath,
} from "./ViewContext";
import { TreeView } from "./components/TreeView";
import { LoadData } from "./dataQuery";

const TEST_ROOT = "testRoot" as LongID;

test("Move View Settings on Delete", async () => {
  const [alice] = setup([ALICE]);
  const { publicKey } = alice().user;

  const c = newNode("C");
  const cpp = newNode("C++");
  const java = newNode("Java");
  const pl = newNode("Programming Languages");

  const planWithNodes = planBulkUpsertNodes(createPlan(alice()), [
    c,
    cpp,
    java,
    pl,
  ]);

  const wsRelations = addRelationToRelations(
    newRelations(TEST_ROOT, List(), publicKey),
    pl.id
  );
  // When viewing with pl as root:
  // - pl's children (c, java) have empty context (stack=[pl], stackContext=[], viewPathContext=[])
  // - c's children (cpp) have context [shortID(pl)] (viewPath includes pl as ancestor)
  const plChildrenContext = List<ID>();
  const cChildrenContext = List<ID>([shortID(pl.id)]);
  const planWithRelations = planUpsertRelations(
    planUpsertRelations(
      planUpsertRelations(
        planWithNodes,
        bulkAddRelations(newRelations(pl.id, plChildrenContext, publicKey), [
          c.id,
          java.id,
        ])
      ),
      wsRelations
    ),
    addRelationToRelations(
      newRelations(c.id, cChildrenContext, publicKey),
      cpp.id
    )
  );

  await execute({
    ...alice(),
    plan: planWithRelations,
  });

  renderWithTestData(
    <LoadData nodeIDs={[pl.id]} descendants referencedBy lists>
      <RootViewContextProvider root={pl.id}>
        <TreeView />
      </RootViewContextProvider>
    </LoadData>,
    alice()
  );
  // Root is expanded by default, find and expand C
  await screen.findByText("C");
  await userEvent.click(screen.getByLabelText("expand C"));

  await screen.findByText("C++");
  // Remove JAVA Node
  await userEvent.click(screen.getByLabelText("mark Java as not relevant"));
  // Ensure C is still expanded
  await screen.findByText("C++");
  screen.getByLabelText("collapse C");

  // Collapse C
  await userEvent.click(screen.getByLabelText("collapse C"));
  screen.getByLabelText("expand C");
  expect(screen.queryByText("C++")).toBeNull();
});

test("Move Node Up", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);

  await type(
    "My Notes{Enter}{Tab}Programming Languages{Enter}{Tab}FPL{Enter}OOP{Enter}{Tab}C++{Enter}Java{Escape}"
  );

  await expectTree(`
My Notes
  Programming Languages
    FPL
    OOP
      C++
      Java
  `);

  const oop = screen.getByText("OOP");
  const pl = screen.getByLabelText("Programming Languages");

  fireEvent.dragStart(oop);
  fireEvent.drop(pl);
  await expectTree(`
My Notes
  Programming Languages
    OOP
      C++
      Java
    FPL
  `);
  cleanup();

  renderTree(alice);
  // View state should be preserved - OOP was moved before FPL and is still expanded
  await expectTree(`
My Notes
  Programming Languages
    OOP
      C++
      Java
    FPL
  `);
});

test("Contact views list via version and list remains unchanged", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(bob, alice().user.publicKey);

  renderTree(alice);
  await type(
    "My Notes{Enter}{Tab}Cities{Enter}{Tab}Paris{Enter}London{Escape}"
  );

  await expectTree(`
My Notes
  Cities
    Paris
    London
  `);
  cleanup();

  renderTree(bob);
  await type("My Notes{Enter}{Tab}Cities{Enter}{Tab}Madrid{Escape}");

  await expectTree(`
My Notes
  Cities
    Madrid
    [S] Paris
    [S] London
  `);
  cleanup();

  renderTree(alice);
  await expectTree(`
My Notes
  Cities
    Paris
    London
  `);
});

test("Alter View paths after disconnect", () => {
  const views = Map<string, { e: string }>({
    "p0:root:0:r:n:1": { e: "delete" },
    "p0:root:0:r:n:3": { e: "p0:root:0:r:n:2" },
    "p0:root:0:r:n:12": { e: "p0:root:0:r:n:11" },
    "p0:root2:0:r:n:2:r:n:3": { e: "p0:root2:0:r:n:1:r:n:2" },
    "p0:root2:0:r:n:2:r:n:1": { e: "delete" },
    "p0:root2:0:r:n:1:r:n:2": { e: "delete" },
    "p0:root:0:r:n:0": { e: "p0:root:0:r:n:0" },
    "p0:root:0:r:n:2:r2:a:0:r:n:45": {
      e: "p0:root:0:r:n:1:r2:a:0:r:n:44",
    },
  });
  const updatedViews = updateViewPathsAfterDisconnect(
    views as unknown as Views,
    "n" as LongID,
    "r" as LongID,
    1 as NodeIndex
  );

  const expectedResult = views
    .filter((v) => v.e !== "delete")
    .mapEntries((e) => [e[1].e, e[1]]);
  expect(updatedViews.keySeq().toJS()).toEqual(expectedResult.keySeq().toJS());
});

test("Alter View paths after disconnect with pane-prefixed paths", () => {
  const views = Map<string, { e: string }>({
    "p0:root:0:r:n:1": { e: "delete" },
    "p0:root:0:r:n:3": { e: "p0:root:0:r:n:2" },
    "p0:root:0:r:n:12": { e: "p0:root:0:r:n:11" },
    "p0:root2:0:r:n:2:r:n:3": { e: "p0:root2:0:r:n:1:r:n:2" },
    "p0:root2:0:r:n:2:r:n:1": { e: "delete" },
    "p0:root2:0:r:n:1:r:n:2": { e: "delete" },
    "p0:root:0:r:n:0": { e: "p0:root:0:r:n:0" },
    "p0:root:0:r:n:2:r2:a:0:r:n:45": {
      e: "p0:root:0:r:n:1:r2:a:0:r:n:44",
    },
  });
  const updatedViews = updateViewPathsAfterDisconnect(
    views as unknown as Views,
    "n" as LongID,
    "r" as LongID,
    1 as NodeIndex
  );

  const expectedResult = views
    .filter((v) => v.e !== "delete")
    .mapEntries((e) => [e[1].e, e[1]]);
  expect(updatedViews.keySeq().toJS()).toEqual(expectedResult.keySeq().toJS());
});

test("Calculate index from node index", () => {
  // Items are now RelationItem objects with nodeID, relevance, and optional argument
  const relations: Relations = {
    items: List([
      { nodeID: "pl" as LongID, relevance: undefined as Relevance },
      { nodeID: "oop" as LongID, relevance: undefined as Relevance },
      { nodeID: "pl" as LongID, relevance: undefined as Relevance },
      { nodeID: "pl" as LongID, relevance: undefined as Relevance },
      { nodeID: "java" as LongID, relevance: undefined as Relevance },
    ]),
    head: "test" as ID,
    context: List<ID>(),
    id: "test" as LongID,
    updated: 0,
    author: ALICE.publicKey,
    root: "test" as ID,
  };
  expect(calculateNodeIndex(relations, 0)).toBe(0);
  expect(calculateNodeIndex(relations, 1)).toBe(0);
  expect(calculateNodeIndex(relations, 2)).toBe(1);
  expect(calculateNodeIndex(relations, 3)).toBe(2);
  expect(calculateNodeIndex(relations, 4)).toBe(0);

  expect(
    calculateIndexFromNodeIndex(relations, "pl" as LongID, 0 as NodeIndex)
  ).toBe(0);
  expect(
    calculateIndexFromNodeIndex(relations, "oop" as LongID, 0 as NodeIndex)
  ).toBe(1);
  expect(
    calculateIndexFromNodeIndex(relations, "pl" as LongID, 1 as NodeIndex)
  ).toBe(2);
  expect(
    calculateIndexFromNodeIndex(relations, "pl" as LongID, 2 as NodeIndex)
  ).toBe(3);
  expect(
    calculateIndexFromNodeIndex(relations, "java" as LongID, 0 as NodeIndex)
  ).toBe(4);
});

test("Parse View path", () => {
  expect(parseViewPath("p0:root:1")).toEqual([
    0,
    { nodeID: "root", nodeIndex: 1 },
  ]);
  expect(parseViewPath("p0:root:0:rl:pl:0")).toEqual([
    0,
    { nodeID: "root", nodeIndex: 0, relationsID: "rl" },
    { nodeID: "pl", nodeIndex: 0 },
  ]);
  expect(parseViewPath("p1:root:0:rl:pl:0:rl:oop:1")).toEqual([
    1,
    { nodeID: "root", nodeIndex: 0, relationsID: "rl" },
    { nodeID: "pl", nodeIndex: 0, relationsID: "rl" },
    { nodeID: "oop", nodeIndex: 1 },
  ]);
});

test("View path roundtrip preserves concrete ref IDs with colons", () => {
  const refId = createConcreteRefId("rel1" as LongID, "target" as ID);
  expect(refId).toBe("cref:rel1:target");

  const viewPath: ViewPath = [
    0,
    {
      nodeID: "parent" as LongID,
      nodeIndex: 0 as NodeIndex,
      relationsID: "rel1",
    },
    { nodeID: refId, nodeIndex: 0 as NodeIndex },
  ];

  const serialized = viewPathToString(viewPath);
  const parsed = parseViewPath(serialized);

  expect(parsed).toEqual(viewPath);
  expect((parsed[2] as { nodeID: string }).nodeID).toBe("cref:rel1:target");
});

test("View path roundtrip preserves concrete ref IDs in middle of path", () => {
  const refId = createConcreteRefId("someRelation" as LongID);

  const viewPath: ViewPath = [
    1,
    { nodeID: refId, nodeIndex: 2 as NodeIndex, relationsID: "someRelation" },
    { nodeID: "child" as LongID, nodeIndex: 0 as NodeIndex },
  ];

  const serialized = viewPathToString(viewPath);
  const parsed = parseViewPath(serialized);

  expect(parsed).toEqual(viewPath);
  expect((parsed[1] as { nodeID: string }).nodeID).toBe("cref:someRelation");
});

test("View doesn't change if list is forked from contact", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);

  renderTree(bob);
  await type(
    "My Notes{Enter}{Tab}Programming Languages{Enter}{Tab}OOP{Enter}{Tab}C++{Enter}Java{Enter}{Enter}FP{Enter}Logic{Enter}Scripting{Escape}"
  );
  await expectTree(`
My Notes
  Programming Languages
    OOP
      C++
      Java
    FP
    Logic
    Scripting
  `);
  cleanup();

  renderTree(alice);
  await type("My Notes{Enter}{Tab}Programming Languages{Escape}");
  await userEvent.click(
    await screen.findByLabelText("expand Programming Languages")
  );
  await expectTree(`
My Notes
  Programming Languages
    [S] OOP
    [S] FP
    [S] Logic
    [VO] +4
  `);

  await userEvent.click(
    await screen.findByLabelText(/open .* \+4 in fullscreen/)
  );

  await waitFor(() => {
    expect(window.location.pathname).toMatch(/^\/r\//);
  });

  await screen.findByText("READONLY");

  await userEvent.click(await screen.findByLabelText("expand OOP"));
  await expectTree(`
[O] Programming Languages
  [O] OOP
    [O] C++
    [O] Java
  [O] FP
  [O] Logic
  [O] Scripting
  `);

  await userEvent.click(
    await screen.findByLabelText("fork to make your own copy")
  );

  await userEvent.click(
    await screen.findByLabelText("edit Programming Languages")
  );
  await userEvent.keyboard("{Enter}");
  await userEvent.type(
    await findNewNodeEditor(),
    "added programming language{Escape}"
  );
  await expectTree(`
Programming Languages
  added programming language
  OOP
    C++
    Java
  FP
  Logic
  Scripting
  `);
  cleanup();
});

test("Disconnect Nodes", async () => {
  const [alice] = setup([ALICE]);
  // Create PL at root level so children have empty context
  await setupTestDB(
    alice(),
    [["Programming Languages", ["C", "C++", "Java", "Rust"]]],
    {
      root: "Programming Languages",
    }
  );
  renderApp({
    ...alice(),
    initialRoute: `/n/${encodeURIComponent("Programming Languages")}`,
  });
  // Root is expanded by default
  await expectTree(`
Programming Languages
  C
  C++
  Java
  Rust
  `);

  // marking nodes as not relevant removes them from the view
  fireEvent.click(await screen.findByLabelText("mark Java as not relevant"));
  await expectTree(`
Programming Languages
  C
  C++
  Rust
  `);

  fireEvent.click(await screen.findByLabelText("mark C as not relevant"));
  await expectTree(`
Programming Languages
  C++
  Rust
  `);

  cleanup();
});

test("updateViewPathsAfterPaneDelete removes views for deleted pane and shifts indices", () => {
  const views = Map<string, View>({
    "p0:root:0": { expanded: false },
    "p0:root:0:r:node1:0": { expanded: true },
    "p1:root:0": { expanded: false },
    "p1:root:0:r:node2:0": { expanded: true },
    "p2:root:0": { expanded: true },
    "p2:root:0:r:node3:0": { expanded: true },
    "p3:root:0": { expanded: true },
  });

  const updatedViews = updateViewPathsAfterPaneDelete(views, 1);

  expect(updatedViews.has("p0:root:0")).toBe(true);
  expect(updatedViews.has("p0:root:0:r:node1:0")).toBe(true);
  expect(updatedViews.has("p1:root:0:r:node2:0")).toBe(false);
  expect(updatedViews.get("p1:root:0")?.expanded).toBe(true);
  expect(updatedViews.get("p1:root:0:r:node3:0")?.expanded).toBe(true);
  expect(updatedViews.get("p2:root:0")?.expanded).toBe(true);
  expect(updatedViews.has("p3:root:0")).toBe(false);
});

test("updateViewPathsAfterPaneInsert shifts pane indices at and after insertion point", () => {
  const views = Map<string, View>({
    "p0:root:0": { expanded: false },
    "p0:root:0:r:node1:0": { expanded: true },
    "p1:root:0": { expanded: true },
    "p1:root:0:r:node2:0": { expanded: true },
    "p2:root:0": { expanded: true },
  });

  const updatedViews = updateViewPathsAfterPaneInsert(views, 1);

  expect(updatedViews.has("p0:root:0")).toBe(true);
  expect(updatedViews.get("p0:root:0")?.expanded).toBe(false);
  expect(updatedViews.has("p0:root:0:r:node1:0")).toBe(true);

  expect(updatedViews.has("p1:root:0")).toBe(false);
  expect(updatedViews.has("p2:root:0")).toBe(true);
  expect(updatedViews.get("p2:root:0")?.expanded).toBe(true);
  expect(updatedViews.has("p2:root:0:r:node2:0")).toBe(true);

  expect(updatedViews.has("p3:root:0")).toBe(true);
  expect(updatedViews.get("p3:root:0")?.expanded).toBe(true);
});

test("updateViewPathsAfterMoveRelations preserves paths when relationsID starts with digit", () => {
  const relID = "3abc_uuid" as LongID;
  const childAPath = `p0:root:0:${relID}:childA:0`;
  const childADeepPath = `p0:root:0:${relID}:childA:0:innerRel:grand:0`;
  const childBPath = `p0:root:0:${relID}:childB:0`;

  const views = Map<string, View>({
    "p0:root:0": { expanded: true },
    [childAPath]: { expanded: true },
    [childADeepPath]: { expanded: true },
    [childBPath]: { expanded: false },
  });

  const data = { views } as unknown as Data;

  const oldItems = List([
    { nodeID: "childA" as LongID, relevance: undefined },
    { nodeID: "childB" as LongID, relevance: undefined },
  ] as RelationItem[]);

  const updatedViews = updateViewPathsAfterMoveRelations(
    data,
    relID,
    oldItems,
    [0],
    4
  );

  expect(updatedViews.has(childAPath)).toBe(true);
  expect(updatedViews.get(childAPath)?.expanded).toBe(true);
  expect(updatedViews.has(childADeepPath)).toBe(true);
  expect(updatedViews.get(childADeepPath)?.expanded).toBe(true);
  expect(updatedViews.has(childBPath)).toBe(true);

  expect(updatedViews.has("p0:root:0:2abc_uuid:childA:0")).toBe(false);
});
