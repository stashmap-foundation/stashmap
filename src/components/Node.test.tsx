import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { List, Map } from "immutable";
import userEvent from "@testing-library/user-event";
import { addRelationToRelations, newNode, shortID } from "../connections";
import { DND } from "../dnd";
import {
  ALICE,
  BOB,
  createExampleProject,
  findNodeByText,
  follow,
  matchSplitText,
  planUpsertProjectNode,
  renderApp,
  renderWithTestData,
  setup,
  setupTestDB,
  typeNewNode,
} from "../utils.test";
import {
  NodeIndex,
  PushNode,
  RootViewContextProvider,
  newRelations,
  viewPathToString,
  getDiffItemsForNode,
  getLast,
} from "../ViewContext";
import { TreeView } from "./TreeView";
import { DraggableNote } from "./Draggable";
import { TemporaryViewProvider } from "./TemporaryViewContext";
import {
  createPlan,
  planBulkUpsertNodes,
  planUpdateViews,
  planUpsertNode,
  planUpsertRelations,
} from "../planner";
import { execute } from "../executor";
import { getNodesInTree } from "./Node";
import { LoadNode } from "../dataQuery";
import { ROOT } from "../types";
import { newDB } from "../knowledge";

test("Render non existing Node", async () => {
  const [alice] = setup([ALICE]);
  const { publicKey } = alice().user;
  const pl = newNode("Programming Languages", publicKey);
  const relations = addRelationToRelations(
    newRelations(pl.id, "", publicKey),
    "not-existing-id" as LongID
  );
  const plan = planUpsertRelations(
    planUpsertNode(createPlan(alice()), pl),
    relations
  );
  await execute({
    ...alice(),
    plan,
  });
  renderWithTestData(
    <RootViewContextProvider root={pl.id}>
      <TemporaryViewProvider>
        <DND>
          <LoadNode>
            <>
              <DraggableNote />
              <TreeView />
            </>
          </LoadNode>
        </DND>
      </TemporaryViewProvider>
    </RootViewContextProvider>,
    alice()
  );
  await screen.findByText("Programming Languages");
  await screen.findByText("Error: Node not found");
});

test("Render Project", async () => {
  const [alice] = setup([ALICE]);
  const project = createExampleProject(alice().user.publicKey);
  await execute({
    ...alice(),
    plan: planUpsertProjectNode(createPlan(alice()), project),
  });
  renderWithTestData(
    <RootViewContextProvider root={project.id}>
      <TemporaryViewProvider>
        <DND>
          <LoadNode>
            <>
              <DraggableNote />
              <TreeView />
            </>
          </LoadNode>
        </DND>
      </TemporaryViewProvider>
    </RootViewContextProvider>,
    alice()
  );
  await screen.findByText("Winchester Mystery House");
});

async function expectNode(text: string, editable: boolean): Promise<void> {
  await screen.findByText(text);
  const edit = `edit ${text}`;
  if (editable) {
    await screen.findByLabelText(edit);
  } else {
    expect(screen.queryByLabelText(edit)).toBeNull();
  }
}

test("Edit node via Column Menu", async () => {
  const [alice] = setup([ALICE]);
  const { publicKey } = alice().user;
  const note = newNode("My Note", publicKey);
  await execute({
    ...alice(),
    plan: planUpsertNode(createPlan(alice()), note),
  });
  renderWithTestData(
    <RootViewContextProvider root={note.id}>
      <LoadNode>
        <TemporaryViewProvider>
          <DND>
            <>
              <DraggableNote />
              <TreeView />
            </>
          </DND>
        </TemporaryViewProvider>
      </LoadNode>
    </RootViewContextProvider>,
    alice()
  );
  await expectNode("My Note", true);
  fireEvent.click(screen.getByLabelText("edit My Note"));
  await userEvent.keyboard(
    "{backspace}{backspace}{backspace}{backspace}edited Note{enter}"
  );
  fireEvent.click(screen.getByLabelText("save"));
  expect(screen.queryByText("Save")).toBeNull();
  await screen.findByText("My edited Note");
});

test("Can't edit Projects", async () => {
  const [alice] = setup([ALICE]);
  const project = createExampleProject(alice().user.publicKey);
  await execute({
    ...alice(),
    plan: planUpsertProjectNode(createPlan(alice()), project),
  });
  renderWithTestData(
    <RootViewContextProvider root={project.id}>
      <LoadNode>
        <TemporaryViewProvider>
          <DND>
            <>
              <DraggableNote />
              <TreeView />
            </>
          </DND>
        </TemporaryViewProvider>
      </LoadNode>
    </RootViewContextProvider>,
    alice()
  );
  await expectNode("Winchester Mystery House", false);
});

test("Load Note from other User which is not a contact", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const bobsDB = await setupTestDB(bob(), [["Bobs Note", []]]);
  const node = findNodeByText(bobsDB, "Bobs Note") as KnowNode;

  renderWithTestData(
    <RootViewContextProvider root={node.id}>
      <LoadNode>
        <TemporaryViewProvider>
          <DND>
            <>
              <DraggableNote />
              <TreeView />
            </>
          </DND>
        </TemporaryViewProvider>
      </LoadNode>
    </RootViewContextProvider>,
    alice()
  );
  await screen.findByText("Bobs Note");
});

test("Cannot edit remote Note", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);
  const bobsDB = await setupTestDB(bob(), [["My Note", []]]);
  const note = findNodeByText(bobsDB, "My Note") as KnowNode;
  renderWithTestData(
    <RootViewContextProvider root={note.id}>
      <LoadNode>
        <TemporaryViewProvider>
          <DND>
            <>
              <DraggableNote />
              <TreeView />
            </>
          </DND>
        </TemporaryViewProvider>
      </LoadNode>
    </RootViewContextProvider>,
    alice()
  );
  await expectNode("My Note", false);
});

test("Edit node inline", async () => {
  const [alice] = setup([ALICE]);
  const { publicKey } = alice().user;
  const note = newNode("My Note", publicKey);
  // Connect the note with itself so it's not the root note
  // Menu doesn't show on root notes
  const plan = planUpsertRelations(
    createPlan(alice()),
    addRelationToRelations(newRelations(note.id, "", publicKey), note.id)
  );
  await execute({
    ...alice(),
    plan: planUpsertNode(plan, note),
  });
  renderWithTestData(
    <RootViewContextProvider root={note.id}>
      <LoadNode waitForEose>
        <PushNode push={List([0])}>
          <LoadNode waitForEose>
            <PushNode push={List([0])}>
              <TemporaryViewProvider>
                <DND>
                  <LoadNode>
                    <DraggableNote />
                  </LoadNode>
                </DND>
              </TemporaryViewProvider>
            </PushNode>
          </LoadNode>
        </PushNode>
      </LoadNode>
    </RootViewContextProvider>,
    {
      ...alice(),
      initialRoute: `/d/${note.id}`,
    }
  );
  await screen.findByText("My Note");
  fireEvent.click(screen.getByLabelText("edit My Note"));
  await userEvent.keyboard(
    "{backspace}{backspace}{backspace}{backspace}edited Note{enter}"
  );
  fireEvent.click(screen.getByLabelText("save"));
  expect(screen.queryByText("Save")).toBeNull();
  await screen.findByText("My edited Note");
});

test("Edited node is shown in Tree View", async () => {
  const [alice] = setup([ALICE]);
  const { publicKey } = alice().user;
  const pl = newNode("Programming Languages", publicKey);
  const oop = newNode("Object Oriented Programming languages", publicKey);
  const java = newNode("Java", publicKey);

  const plan = planUpsertRelations(
    planUpsertRelations(
      planUpsertRelations(
        createPlan(alice()),
        addRelationToRelations(newRelations(pl.id, "", publicKey), oop.id)
      ),
      addRelationToRelations(newRelations(oop.id, "", publicKey), java.id)
    ),
    addRelationToRelations(newRelations(ROOT, "", publicKey), ROOT)
  );
  const planWithViews = planUpdateViews(
    plan,
    Map({
      [viewPathToString([
        0,
        { nodeID: pl.id, nodeIndex: 0 as NodeIndex, relationsID: "" as LongID },
        { nodeID: oop.id, nodeIndex: 0 as NodeIndex },
      ])]: {
        expanded: true,
        width: 1,
        relations: "" as LongID,
      },
    })
  );
  await execute({
    ...alice(),
    plan: planBulkUpsertNodes(planWithViews, [pl, oop, java]),
  });
  renderWithTestData(
    <RootViewContextProvider root={pl.id}>
      <LoadNode waitForEose>
        <PushNode push={List([0])}>
          <TemporaryViewProvider>
            <DND>
              <LoadNode>
                <TreeView />
              </LoadNode>
            </DND>
          </TemporaryViewProvider>
        </PushNode>
      </LoadNode>
    </RootViewContextProvider>,
    {
      ...alice(),
    }
  );
  fireEvent.click(await screen.findByLabelText("edit Java"));
  await userEvent.keyboard(
    "{backspace}{backspace}{backspace}{backspace}C++{enter}"
  );
  fireEvent.click(screen.getByLabelText("save"));
  expect(screen.queryByText("Save")).toBeNull();
  expect(screen.queryByText("Java")).toBeNull();
  await screen.findByText("C++");
});

test("Delete node", async () => {
  const [alice] = setup([ALICE]);
  const { publicKey } = alice().user;
  const note = newNode("My Note", publicKey);
  await execute({
    ...alice(),
    plan: planUpsertNode(createPlan(alice()), note),
  });
  renderWithTestData(
    <RootViewContextProvider root={note.id}>
      <TemporaryViewProvider>
        <DND>
          <LoadNode>
            <>
              <DraggableNote />
              <TreeView />
            </>
          </LoadNode>
        </DND>
      </TemporaryViewProvider>
    </RootViewContextProvider>,
    alice()
  );
  await screen.findByText("My Note");
  await userEvent.click(screen.getByLabelText("edit My Note"));
  await userEvent.click(screen.getByLabelText("delete node"));
  expect(screen.queryByText("My Note")).toBeNull();
});

test("getNodesInTree includes diff items for nested expanded nodes", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const parent = newNode("Parent", alicePK);
  const child = newNode("Child", alicePK);
  const aliceGrandchild = newNode("Alice's Grandchild", alicePK);
  const bobGrandchild = newNode("Bob's Grandchild", bobPK);
  const parentRelations = addRelationToRelations(
    newRelations(parent.id, "", alicePK),
    child.id
  );
  const childRelations = addRelationToRelations(
    newRelations(child.id, "", alicePK),
    aliceGrandchild.id
  );
  const bobChildRelations = addRelationToRelations(
    newRelations(child.id, "", bobPK),
    bobGrandchild.id
  );

  const knowledgeDBs = Map<PublicKey, KnowledgeData>()
    .set(alicePK, {
      nodes: newDB()
        .nodes.set(shortID(parent.id), parent)
        .set(shortID(child.id), child)
        .set(shortID(aliceGrandchild.id), aliceGrandchild),
      relations: newDB()
        .relations.set(shortID(parentRelations.id), parentRelations)
        .set(shortID(childRelations.id), childRelations),
    })
    .set(bobPK, {
      nodes: newDB().nodes.set(shortID(bobGrandchild.id), bobGrandchild),
      relations: newDB().relations.set(
        shortID(bobChildRelations.id),
        bobChildRelations
      ),
    });

  const parentPath = [
    0,
    { nodeID: parent.id, nodeIndex: 0 as NodeIndex },
  ] as const;
  const childPath = [
    0,
    {
      nodeID: parent.id,
      nodeIndex: 0 as NodeIndex,
      relationsID: parentRelations.id,
    },
    { nodeID: child.id, nodeIndex: 0 as NodeIndex },
  ] as const;

  const views = Map<string, View>()
    .set(viewPathToString(parentPath), {
      width: 1,
      relations: parentRelations.id,
      expanded: true,
    })
    .set(viewPathToString(childPath), {
      width: 1,
      relations: childRelations.id,
      expanded: true,
    });

  const data: Data = {
    ...alice(),
    knowledgeDBs,
    views,
  };

  const nodes = getNodesInTree(data, parentPath, List());
  const nodeIDs = nodes.map((path) => getLast(path).nodeID).toArray();

  expect(nodeIDs).toContain(child.id);
  expect(nodeIDs).toContain(aliceGrandchild.id);
  expect(nodeIDs).toContain(bobGrandchild.id);
});

test("getDiffItemsForNode returns items from other users not in current user's list", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const parent = newNode("Parent", alicePK);
  const aliceChild = newNode("Alice's Child", alicePK);
  const bobChild = newNode("Bob's Child", bobPK);

  const aliceRelations = addRelationToRelations(
    newRelations(parent.id, "", alicePK),
    aliceChild.id
  );
  const bobRelations = addRelationToRelations(
    newRelations(parent.id, "", bobPK),
    bobChild.id
  );

  const knowledgeDBs = Map<PublicKey, KnowledgeData>()
    .set(alicePK, {
      nodes: newDB()
        .nodes.set(shortID(parent.id), parent)
        .set(shortID(aliceChild.id), aliceChild),
      relations: newDB().relations.set(
        shortID(aliceRelations.id),
        aliceRelations
      ),
    })
    .set(bobPK, {
      nodes: newDB().nodes.set(shortID(bobChild.id), bobChild),
      relations: newDB().relations.set(shortID(bobRelations.id), bobRelations),
    });

  const diffItems = getDiffItemsForNode(
    knowledgeDBs,
    alicePK,
    parent.id,
    "",
    aliceRelations.id
  );

  expect(diffItems.size).toBe(1);
  expect(diffItems.get(0)?.nodeID).toBe(bobChild.id);
});

test("getDiffItemsForNode excludes items already in user's list", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const parent = newNode("Parent", alicePK);
  const sharedChild = newNode("Shared Child", alicePK);

  const aliceRelations = addRelationToRelations(
    newRelations(parent.id, "", alicePK),
    sharedChild.id
  );
  const bobRelations = addRelationToRelations(
    newRelations(parent.id, "", bobPK),
    sharedChild.id
  );

  const knowledgeDBs = Map<PublicKey, KnowledgeData>()
    .set(alicePK, {
      nodes: newDB()
        .nodes.set(shortID(parent.id), parent)
        .set(shortID(sharedChild.id), sharedChild),
      relations: newDB().relations.set(
        shortID(aliceRelations.id),
        aliceRelations
      ),
    })
    .set(bobPK, {
      nodes: newDB().nodes,
      relations: newDB().relations.set(shortID(bobRelations.id), bobRelations),
    });

  const diffItems = getDiffItemsForNode(
    knowledgeDBs,
    alicePK,
    parent.id,
    "",
    aliceRelations.id
  );

  expect(diffItems.size).toBe(0);
});

test("Diff item paths are correctly identified as diff items", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const root = newNode("Root", alicePK);
  const parent = newNode("Parent", alicePK);
  const aliceChild = newNode("Alice's Child", alicePK);
  const bobChild = newNode("Bob's Child", bobPK);

  const rootRelations = addRelationToRelations(
    newRelations(root.id, "", alicePK),
    parent.id
  );
  const parentRelations = addRelationToRelations(
    newRelations(parent.id, "", alicePK),
    aliceChild.id
  );
  const bobParentRelations = addRelationToRelations(
    newRelations(parent.id, "", bobPK),
    bobChild.id
  );

  const knowledgeDBs = Map<PublicKey, KnowledgeData>()
    .set(alicePK, {
      nodes: newDB()
        .nodes.set(shortID(root.id), root)
        .set(shortID(parent.id), parent)
        .set(shortID(aliceChild.id), aliceChild),
      relations: newDB()
        .relations.set(shortID(rootRelations.id), rootRelations)
        .set(shortID(parentRelations.id), parentRelations),
    })
    .set(bobPK, {
      nodes: newDB().nodes.set(shortID(bobChild.id), bobChild),
      relations: newDB().relations.set(
        shortID(bobParentRelations.id),
        bobParentRelations
      ),
    });

  const rootPath = [0, { nodeID: root.id, nodeIndex: 0 as NodeIndex }] as const;
  const parentPath = [
    0,
    {
      nodeID: root.id,
      nodeIndex: 0 as NodeIndex,
      relationsID: rootRelations.id,
    },
    { nodeID: parent.id, nodeIndex: 0 as NodeIndex },
  ] as const;

  const views = Map<string, View>()
    .set(viewPathToString(rootPath), {
      width: 1,
      relations: rootRelations.id,
      expanded: true,
    })
    .set(viewPathToString(parentPath), {
      width: 1,
      relations: parentRelations.id,
      expanded: true,
    });

  const data: Data = {
    ...alice(),
    knowledgeDBs,
    views,
  };

  const nodes = getNodesInTree(data, rootPath, List());
  expect(nodes.size).toBeGreaterThanOrEqual(3);

  const diffItemPath = nodes.find(
    (path) => getLast(path).nodeID === bobChild.id
  );
  expect(diffItemPath).toBeDefined();
  expect(diffItemPath ? getLast(diffItemPath).isDiffItem : undefined).toBe(
    true
  );

  const aliceChildPath = nodes.find(
    (path) => getLast(path).nodeID === aliceChild.id
  );
  expect(aliceChildPath).toBeDefined();
  expect(
    aliceChildPath ? getLast(aliceChildPath).isDiffItem : undefined
  ).toBeUndefined();
});

test("getDiffItemsForNode should return no diff items for not_relevant relation type", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const parent = newNode("Parent", alicePK);
  const bobChild = newNode("Bob's Child", bobPK);

  const aliceRelations = newRelations(parent.id, "not_relevant", alicePK);
  const bobRelations = addRelationToRelations(
    newRelations(parent.id, "not_relevant", bobPK),
    bobChild.id
  );

  const knowledgeDBs = Map<PublicKey, KnowledgeData>()
    .set(alicePK, {
      nodes: newDB().nodes.set(shortID(parent.id), parent),
      relations: newDB().relations.set(
        shortID(aliceRelations.id),
        aliceRelations
      ),
    })
    .set(bobPK, {
      nodes: newDB().nodes.set(shortID(bobChild.id), bobChild),
      relations: newDB().relations.set(shortID(bobRelations.id), bobRelations),
    });

  const diffItems = getDiffItemsForNode(
    knowledgeDBs,
    alicePK,
    parent.id,
    "not_relevant",
    aliceRelations.id
  );
  expect(diffItems.size).toBe(0);
});

test("Multiple connections to same node", async () => {
  const [alice] = setup([ALICE]);
  const java = newNode("Java", alice().user.publicKey);
  await execute({
    ...alice(),
    plan: planUpsertNode(createPlan(alice()), java),
  });

  const view = renderApp(alice());
  await typeNewNode(view, "Programming Languages");

  const expandButton = await screen.findByLabelText(
    "create relevant to for Programming Languages"
  );
  fireEvent.click(expandButton);

  const searchButton = await screen.findByLabelText(
    "search and attach to Programming Languages"
  );
  fireEvent.click(searchButton);

  const searchInput = await screen.findByLabelText("search input");
  await userEvent.type(searchInput, "Jav");
  await userEvent.click(await screen.findByText(matchSplitText("Java")));

  const searchButton2 = await screen.findByLabelText(
    "search and attach to Programming Languages"
  );
  fireEvent.click(searchButton2);
  const searchInput2 = await screen.findByLabelText("search input");
  await userEvent.type(searchInput2, "Jav");
  await waitFor(() => {
    expect(screen.getAllByText(matchSplitText("Java"))).toHaveLength(2);
  });
  await userEvent.click(screen.getAllByText(matchSplitText("Java"))[1]);

  const fullscreenButtons = await screen.findAllByLabelText("open fullscreen");
  fireEvent.click(fullscreenButtons[0]);

  expect(
    (await screen.findByLabelText("related to Programming Languages"))
      .textContent
  ).toMatch(/Java(.*)Java/);
});
