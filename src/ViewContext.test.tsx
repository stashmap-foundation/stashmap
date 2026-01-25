import React from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { List, Map } from "immutable";
import {
  newNode,
  addRelationToRelations,
  bulkAddRelations,
  shortID,
  createAbstractRefId,
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
  findNodeByText,
  expectTree,
  findNewNodeEditor,
  BOB,
  follow,
  renderApp,
  renderTree,
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
  NodeIndex,
  getDefaultRelationForNode,
  ViewPath,
} from "./ViewContext";
import { TreeView } from "./components/TreeView";
import { LoadData } from "./dataQuery";
import { ROOT } from "./types";

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
    newRelations(ROOT, List(), publicKey),
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
  // Expand Programming Languages to see children
  await screen.findByText("Programming Languages");
  await userEvent.click(screen.getByLabelText("expand Programming Languages"));
  // Find and expand C
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

  // Create: My Notes → Programming Languages → FPL, OOP → C++, Java
  const myNotesEditor = await screen.findByLabelText("edit My Notes");
  await userEvent.click(myNotesEditor);
  await userEvent.keyboard("{Enter}");
  await userEvent.type(
    await findNewNodeEditor(),
    "Programming Languages{Enter}{Tab}FPL{Enter}OOP{Enter}{Tab}C++{Enter}Java{Escape}"
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
  const fpl = screen.getByText("FPL");

  fireEvent.dragStart(oop);
  fireEvent.drop(fpl);
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

test("Contact reorders list", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);
  // Bob creates PL at root level so it has empty context
  const bobsKnowledgeDB = await setupTestDB(
    bob(),
    [["Programming Languages", [["OOP", ["C++", "Java"]], ["FPL"]]]],
    { activeWorkspace: "Programming Languages" }
  );
  const pl = findNodeByText(
    bobsKnowledgeDB,
    "Programming Languages"
  ) as KnowNode;

  // Alice views PL directly (same empty context as Bob used)
  renderApp({
    ...alice(),
    initialRoute: `/w/${pl.id}`,
  });
  await screen.findByText("Programming Languages");

  // Expand Programming Languages to see its children
  await userEvent.click(screen.getByLabelText("expand Programming Languages"));
  await expectTree(`
Programming Languages
  OOP
  FPL
  `);

  // Expand OOP
  await userEvent.click(screen.getByLabelText("expand OOP"));
  await expectTree(`
Programming Languages
  OOP
    C++
    Java
  FPL
  `);
  cleanup();

  // let bob remove OOP (also at root level)
  renderApp({
    ...bob(),
    initialRoute: `/w/${pl.id}`,
  });
  await screen.findByText("Programming Languages");
  // Expand to see children
  await userEvent.click(screen.getByLabelText("expand Programming Languages"));
  // Step 1: Mark OOP as not relevant (hides it)
  fireEvent.click(await screen.findByLabelText("mark OOP as not relevant"));

  // Step 2: Enable not_relevant filter to see hidden items
  await userEvent.click(screen.getByLabelText("filter Programming Languages"));
  await userEvent.click(await screen.findByText("Not Relevant"));

  // Step 3: Click "remove from list" to actually remove OOP
  fireEvent.click(await screen.findByLabelText("remove OOP from list"));
  cleanup();

  renderApp({
    ...alice(),
    initialRoute: `/w/${pl.id}`,
  });
  await screen.findByText("Programming Languages");
  // OOP is gone, so are it's children
  await expectTree(`
Programming Languages
  FPL
  `);
});

test("Alter View paths after disconnect", () => {
  // Assume I'm deleting r:n:1 (first occurance of n in r)
  const views = Map<string, { e: string }>({
    "root:0:r:n:1": { e: "delete" },
    "root:0:r:n:3": { e: "root:0:r:n:2" },
    "root:0:r:n:12": { e: "root:0:r:n:11" },
    "root2:0:r:n:2:r:n:3": { e: "root2:0:r:n:1:r:n:2" },
    "root2:0:r:n:2:r:n:1": { e: "delete" },
    "root2:0:r:n:1:r:n:2": { e: "delete" },
    "root:0:r:n:0": { e: "root:0:r:n:0" },
    "root:0:r:n:2:r2:a:0:r:n:45": { e: "root:0:r:n:1:r2:a:0:r:n:44" },
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
      { nodeID: "pl" as LongID, relevance: "" as Relevance },
      { nodeID: "oop" as LongID, relevance: "" as Relevance },
      { nodeID: "pl" as LongID, relevance: "" as Relevance },
      { nodeID: "pl" as LongID, relevance: "" as Relevance },
      { nodeID: "java" as LongID, relevance: "" as Relevance },
    ]),
    head: "test" as ID,
    context: List<ID>(),
    id: "test" as LongID,
    updated: 0,
    author: ALICE.publicKey,
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

test("View path roundtrip preserves ref IDs with colons", () => {
  // Create a ref ID that contains colons: ref:context1:context2:target
  const refId = createAbstractRefId(List(["ctx1" as ID, "ctx2" as ID]), "target" as ID);
  expect(refId).toBe("ref:ctx1:ctx2:target");

  // Create a view path with the ref ID as the last node
  const viewPath: ViewPath = [
    0,
    {
      nodeID: "parent" as LongID,
      nodeIndex: 0 as NodeIndex,
      relationsID: "rel1",
    },
    { nodeID: refId, nodeIndex: 0 as NodeIndex },
  ];

  // Serialize to string and parse back
  const serialized = viewPathToString(viewPath);
  const parsed = parseViewPath(serialized);

  // The ref ID should be preserved exactly
  expect(parsed).toEqual(viewPath);
  expect((parsed[2] as { nodeID: string }).nodeID).toBe("ref:ctx1:ctx2:target");
});

test("View path roundtrip preserves ref IDs in middle of path", () => {
  // Ref ID in the middle of the path (with relationsID)
  const refId = createAbstractRefId(List(["money" as ID]), "bitcoin" as ID);

  const viewPath: ViewPath = [
    1,
    { nodeID: refId, nodeIndex: 2 as NodeIndex, relationsID: "someRelation" },
    { nodeID: "child" as LongID, nodeIndex: 0 as NodeIndex },
  ];

  const serialized = viewPathToString(viewPath);
  const parsed = parseViewPath(serialized);

  expect(parsed).toEqual(viewPath);
  expect((parsed[1] as { nodeID: string }).nodeID).toBe("ref:money:bitcoin");
});

test("Default Relations returns most recently updated relation", () => {
  const node = newNode("Node");
  const nodes = Map<KnowNode>({ [node.id]: node });

  // With per-item types, relations are sorted by date (most recent first)
  const older: Relations = {
    items: List<RelationItem>(),
    id: "older" as LongID,
    context: List<ID>(),
    head: shortID(node.id),
    updated: 100,
    author: ALICE.publicKey,
  };
  const newest: Relations = {
    items: List<RelationItem>(),
    id: "newest" as LongID,
    context: List<ID>(),
    head: shortID(node.id),
    updated: 300, // Most recent
    author: ALICE.publicKey,
  };
  const middle: Relations = {
    items: List<RelationItem>(),
    id: "middle" as LongID,
    context: List<ID>(),
    head: shortID(node.id),
    updated: 200,
    author: ALICE.publicKey,
  };

  const relations = Map<ID, Relations>([
    ["older", older],
    ["newest", newest],
    ["middle", middle],
  ]);

  const defaultRelation = getDefaultRelationForNode(
    node.id,
    Map<PublicKey, KnowledgeData>([[ALICE.publicKey, { relations, nodes }]] as [
      PublicKey,
      KnowledgeData
    ][]),
    ALICE.publicKey
  );
  // Most recently updated relation should be returned
  expect(defaultRelation).toEqual("newest");
});

test("View doesn't change if list is copied from contact", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);
  // Create Programming Languages at root level so it has empty context
  const bobsKnowledgeDB = await setupTestDB(
    bob(),
    [["Programming Languages", [["OOP", ["C++", "Java"]], ["FPL"]]]],
    { activeWorkspace: "Programming Languages" }
  );

  // Navigate directly to Programming Languages to see its children (OOP, FPL)
  const pl = findNodeByText(
    bobsKnowledgeDB,
    "Programming Languages"
  ) as KnowNode;
  renderApp({
    ...alice(),
    initialRoute: `/w/${pl.id}`,
  });

  await screen.findByText("Programming Languages");
  // Expand Programming Languages to see children
  await userEvent.click(screen.getByLabelText("expand Programming Languages"));
  await expectTree(`
Programming Languages
  OOP
  FPL
  `);
  // Expand OOP
  await userEvent.click(screen.getByLabelText("expand OOP"));
  await expectTree(`
Programming Languages
  OOP
    C++
    Java
  FPL
  `);

  // add node to Programming Languages and check if view stays the same
  await userEvent.click(
    await screen.findByLabelText("add to Programming Languages")
  );
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
  FPL
  `);
  cleanup();
});

test("Disconnect Nodes", async () => {
  const [alice] = setup([ALICE]);
  // Create PL at root level so children have empty context
  const aliceDB = await setupTestDB(
    alice(),
    [["Programming Languages", ["C", "C++", "Java", "Rust"]]],
    {
      activeWorkspace: "Programming Languages",
    }
  );
  // Navigate directly to Programming Languages (root level, empty context)
  const pl = findNodeByText(aliceDB, "Programming Languages") as KnowNode;
  renderApp({
    ...alice(),
    initialRoute: `/w/${pl.id}`,
  });
  await screen.findByText("Programming Languages");
  // Expand Programming Languages to see children
  await userEvent.click(screen.getByLabelText("expand Programming Languages"));
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
    "p0:root:0": { expanded: false, width: 1 },
    "p0:root:0:r:node1:0": { expanded: true, width: 1 },
    "p1:root:0": { expanded: false, width: 1 },
    "p1:root:0:r:node2:0": { expanded: true, width: 1 },
    "p2:root:0": { expanded: false, width: 2 },
    "p2:root:0:r:node3:0": { expanded: true, width: 1 },
    "p3:root:0": { expanded: true, width: 3 },
  });

  const updatedViews = updateViewPathsAfterPaneDelete(views, 1);

  expect(updatedViews.has("p0:root:0")).toBe(true);
  expect(updatedViews.has("p0:root:0:r:node1:0")).toBe(true);
  expect(updatedViews.has("p1:root:0:r:node2:0")).toBe(false);
  expect(updatedViews.get("p1:root:0")?.width).toBe(2);
  expect(updatedViews.get("p1:root:0:r:node3:0")?.expanded).toBe(true);
  expect(updatedViews.get("p2:root:0")?.width).toBe(3);
  expect(updatedViews.has("p3:root:0")).toBe(false);
});

test("updateViewPathsAfterPaneInsert shifts pane indices at and after insertion point", () => {
  const views = Map<string, View>({
    "p0:root:0": { expanded: false, width: 1 },
    "p0:root:0:r:node1:0": { expanded: true, width: 1 },
    "p1:root:0": { expanded: false, width: 2 },
    "p1:root:0:r:node2:0": { expanded: true, width: 1 },
    "p2:root:0": { expanded: true, width: 3 },
  });

  // Insert a pane at index 1, so pane 1 becomes pane 2, pane 2 becomes pane 3
  const updatedViews = updateViewPathsAfterPaneInsert(views, 1);

  // Pane 0 stays the same
  expect(updatedViews.has("p0:root:0")).toBe(true);
  expect(updatedViews.get("p0:root:0")?.width).toBe(1);
  expect(updatedViews.has("p0:root:0:r:node1:0")).toBe(true);

  // Old pane 1 is now pane 2
  expect(updatedViews.has("p1:root:0")).toBe(false);
  expect(updatedViews.has("p2:root:0")).toBe(true);
  expect(updatedViews.get("p2:root:0")?.width).toBe(2);
  expect(updatedViews.has("p2:root:0:r:node2:0")).toBe(true);

  // Old pane 2 is now pane 3
  expect(updatedViews.has("p3:root:0")).toBe(true);
  expect(updatedViews.get("p3:root:0")?.width).toBe(3);
});
