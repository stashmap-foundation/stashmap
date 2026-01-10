import React from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { List, Map } from "immutable";
import Data from "./Data";
import {
  newNode,
  addRelationToRelations,
  bulkAddRelations,
  shortID,
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
  extractNodes,
  BOB,
  follow,
  renderApp,
} from "./utils.test";
import {
  RootViewContextProvider,
  calculateIndexFromNodeIndex,
  calculateNodeIndex,
  newRelations,
  parseViewPath,
  updateViewPathsAfterDisconnect,
  NodeIndex,
  getDefaultRelationForNode,
  PushNode,
} from "./ViewContext";
import { WorkspaceView } from "./components/Workspace";
import { TreeView } from "./components/TreeView";
import { LoadNode } from "./dataQuery";
import { App } from "./App";
import { RootViewOrWorkspaceIsLoading } from "./components/Dashboard";
import { ROOT } from "./types";

test("Move View Settings on Delete", async () => {
  const [alice] = setup([ALICE]);
  const { publicKey } = alice().user;

  const c = newNode("C", publicKey);
  const cpp = newNode("C++", publicKey);
  const java = newNode("Java", publicKey);
  const pl = newNode("Programming Languages", publicKey);

  const planWithNodes = planBulkUpsertNodes(createPlan(alice()), [
    c,
    cpp,
    java,
    pl,
  ]);

  const wsRelations = addRelationToRelations(
    newRelations(ROOT, "", publicKey),
    pl.id
  );
  const planWithRelations = planUpsertRelations(
    planUpsertRelations(
      planUpsertRelations(
        planWithNodes,
        bulkAddRelations(newRelations(pl.id, "", publicKey), [c.id, java.id])
      ),
      wsRelations
    ),
    addRelationToRelations(newRelations(c.id, "", publicKey), cpp.id)
  );

  await execute({
    ...alice(),
    plan: planWithRelations,
  });

  renderWithTestData(
    <Data user={alice().user}>
      <RootViewContextProvider root={pl.id}>
        <LoadNode waitForEose>
          <TreeView />
        </LoadNode>
      </RootViewContextProvider>
    </Data>,
    {
      ...alice(),
    }
  );
  fireEvent.click(
    await screen.findByLabelText("show items relevant for C", undefined, {
      timeout: 5000,
    })
  );
  await screen.findByText("C++");
  // Remove JAVA Node
  await userEvent.click(screen.getByLabelText("disconnect node Java"));
  // Ensure C is still expanded
  await screen.findByText("C++");
  screen.getByLabelText("hide items relevant for C");

  await userEvent.click(screen.getByLabelText("hide items relevant for C"));
  screen.getByLabelText("show items relevant for C");
  expect(screen.queryByText("C++")).toBeNull();
});

test("Move Node Up", async () => {
  const [alice] = setup([ALICE]);
  const executedPlan = await setupTestDB(alice(), [
    [
      "My Workspace",
      [["Programming Languages", [["FPL"], ["OOP", ["C++", "Java"]]]]],
    ],
  ]);
  const root = (findNodeByText(executedPlan, "My Workspace") as KnowNode).id;
  const utils = renderWithTestData(
    <Data user={alice().user}>
      <RootViewContextProvider root={root}>
        <LoadNode waitForEose>
          <PushNode push={List([0])}>
            <LoadNode>
              <TreeView />
            </LoadNode>
          </PushNode>
        </LoadNode>
      </RootViewContextProvider>
    </Data>,
    alice()
  );
  await screen.findByText("FPL");
  expect(extractNodes(utils.container)).toEqual(["FPL", "OOP"]);
  await userEvent.click(screen.getByLabelText("show items relevant for OOP"));
  expect(extractNodes(utils.container)).toEqual(["FPL", "OOP", "C++", "Java"]);

  const oop = screen.getByText("OOP");
  const fpl = screen.getByText("FPL");

  fireEvent.dragStart(oop);
  fireEvent.drop(fpl);
  expect(extractNodes(utils.container)).toEqual(["OOP", "C++", "Java", "FPL"]);
  cleanup();

  const { container } = renderWithTestData(
    <Data user={alice().user}>
      <RootViewContextProvider root={root}>
        <LoadNode waitForEose>
          <PushNode push={List([0])}>
            <LoadNode>
              <TreeView />
            </LoadNode>
          </PushNode>
        </LoadNode>
      </RootViewContextProvider>
    </Data>,
    alice()
  );
  await screen.findByText("FPL");
  expect(extractNodes(container)).toEqual(["OOP", "C++", "Java", "FPL"]);
});

test("Contact reorders list", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);
  const bobsKnowledgeDB = await setupTestDB(
    bob(),
    [
      [
        "Bobs Workspace",
        [["Programming Languages", [["OOP", ["C++", "Java"]], ["FPL"]]]],
      ],
    ],
    { activeWorkspace: "Bobs Workspace" }
  );
  const pl = findNodeByText(
    bobsKnowledgeDB,
    "Programming Languages"
  ) as KnowNode;

  const aliceDB = await setupTestDB(alice(), [["My Workspace", [pl]]], {
    activeWorkspace: "My Workspace",
  });
  const myWorkspace = findNodeByText(aliceDB, "My Workspace") as KnowNode;

  const utils = renderWithTestData(
    <Data user={alice().user}>
      <RootViewOrWorkspaceIsLoading>
        <PushNode push={List([0])}>
          <LoadNode>
            <TreeView />
          </LoadNode>
        </PushNode>
      </RootViewOrWorkspaceIsLoading>
    </Data>,
    {
      ...alice(),
      initialRoute: `/w/${myWorkspace.id}`,
    }
  );
  await screen.findByText("FPL");
  expect(extractNodes(utils.container)).toEqual(["OOP", "FPL"]);
  await userEvent.click(screen.getByLabelText("show items relevant for OOP"));
  await screen.findByText("C++");
  expect(extractNodes(utils.container)).toEqual(["OOP", "C++", "Java", "FPL"]);
  cleanup();

  // let bob remove OOP
  const bobsWorkspace = findNodeByText(
    bobsKnowledgeDB,
    "Bobs Workspace"
  ) as KnowNode;
  renderWithTestData(
    <Data user={bob().user}>
      <RootViewOrWorkspaceIsLoading>
        <PushNode push={List([0])}>
          <LoadNode>
            <TreeView />
          </LoadNode>
        </PushNode>
      </RootViewOrWorkspaceIsLoading>
    </Data>,
    {
      ...bob(),
      initialRoute: `/w/${bobsWorkspace.id}`,
    }
  );
  await userEvent.click(await screen.findByLabelText("edit OOP"));
  await userEvent.click(screen.getByLabelText("delete node"));
  cleanup();

  const { container } = renderWithTestData(
    <Data user={alice().user}>
      <RootViewOrWorkspaceIsLoading>
        <PushNode push={List([0])}>
          <LoadNode>
            <TreeView />
          </LoadNode>
        </PushNode>
      </RootViewOrWorkspaceIsLoading>
    </Data>,
    {
      ...alice(),
      initialRoute: `/w/${myWorkspace.id}`,
    }
  );
  // OOP is gone, so are it's children
  await screen.findByText("FPL");
  expect(extractNodes(container)).toEqual(["FPL"]);
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
  const relations: Relations = {
    items: List(["pl", "oop", "pl", "pl", "java"]),
  } as Relations;
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
  expect(parseViewPath("p0:root:1")).toEqual([0, { nodeID: "root", nodeIndex: 1 }]);
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

test("Default Relations are deterministic", () => {
  const node = newNode("Node", ALICE.publicKey);
  const nodes = Map<KnowNode>({ [node.id]: node });

  const pro = {
    items: List<LongID>(),
    id: "confirms" as LongID,
    type: "confirms",
    head: shortID(node.id),
    updated: 0,
    author: ALICE.publicKey,
  };
  const contra = {
    items: List<LongID>(),
    id: "contra" as LongID,
    type: "contra",
    head: shortID(node.id),
    updated: 0,
    author: ALICE.publicKey,
  };
  const def = {
    items: List<LongID>(),
    id: "default" as LongID,
    type: "",
    head: shortID(node.id),
    updated: 0,
    author: ALICE.publicKey,
  };

  const relations = Map<ID, Relations>([
    ["pro", pro],
    ["default", def],
    ["contra", contra],
  ] as [string, Relations][]);

  const defaultRelation = getDefaultRelationForNode(
    node.id,
    Map<PublicKey, KnowledgeData>([[ALICE.publicKey, { relations, nodes }]] as [
      PublicKey,
      KnowledgeData
    ][]),
    ALICE.publicKey
  );
  expect(defaultRelation).toEqual("default");
});

test("View doesn't change if list is copied from contact", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);
  const bobsKnowledgeDB = await setupTestDB(
    bob(),
    [
      [
        "Bobs Workspace",
        [["Programming Languages", [["OOP", ["C++", "Java"]], ["FPL"]]]],
      ],
    ],
    { activeWorkspace: "Bobs Workspace" }
  );

  // Navigate directly to Programming Languages to see its children (OOP, FPL)
  const pl = findNodeByText(bobsKnowledgeDB, "Programming Languages") as KnowNode;
  const utils = renderApp({
    ...alice(),
    initialRoute: `/w/${pl.id}`,
  });

  await screen.findByText("Programming Languages");
  expect(extractNodes(utils.container)).toEqual(["OOP", "FPL"]);
  await userEvent.click(screen.getByLabelText("show items relevant for OOP"));
  expect(extractNodes(utils.container)).toEqual(["OOP", "C++", "Java", "FPL"]);

  // add node to Programming Languages and check if view stays the same
  await userEvent.click(
    await screen.findByLabelText("add to Programming Languages")
  );
  /* eslint-disable testing-library/no-container */
  /* eslint-disable testing-library/no-node-access */
  const input = utils.container.querySelector(
    '[data-placeholder="Create a Note"]'
  ) as Element;
  await userEvent.type(input, "added programming language");
  await userEvent.click((await screen.findAllByText("Add Note"))[1]);
  expect(extractNodes(utils.container)).toEqual([
    "OOP",
    "C++",
    "Java",
    "FPL",
    "\nadded programming language",
  ]);
  cleanup();
});

test("Disconnect Nodes", async () => {
  const [alice] = setup([ALICE]);
  const aliceDB = await setupTestDB(
    alice(),
    [
      [
        "My Workspace",
        [["Programming Languages", ["C", "C++", "Java", "Rust"]]],
      ],
    ],
    {
      activeWorkspace: "My Workspace",
    }
  );
  // Navigate directly to Programming Languages to see its children
  const pl = findNodeByText(aliceDB, "Programming Languages") as KnowNode;
  const { container } = renderWithTestData(<App />, {
    ...alice(),
    initialRoute: `/w/${pl.id}`,
  });
  await screen.findByText("Programming Languages");
  // Children are visible directly since we're at Programming Languages level

  // disconnect nodes from relevant moves nodes to not relevant
  fireEvent.click(await screen.findByLabelText("disconnect node Java"));
  expect(screen.queryByText("Java")).toBeNull();
  expect(extractNodes(container)).toEqual(["C", "C++", "Rust"]);
  fireEvent.click(await screen.findByLabelText("disconnect node C"));
  expect(screen.queryByText("C")).toBeNull();
  fireEvent.click(
    await screen.findByLabelText(
      "show items not relevant for Programming Languages"
    )
  );
  expect(extractNodes(container)).toEqual(["Java", "C"]);

  // disconnect node from not relevant removes node completely
  fireEvent.click(await screen.findByLabelText("disconnect node C"));
  expect(screen.queryByText("C")).toBeNull();

  cleanup();
});
