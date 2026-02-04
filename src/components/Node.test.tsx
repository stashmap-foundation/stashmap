import React from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { List, Map } from "immutable";
import userEvent from "@testing-library/user-event";
import {
  addRelationToRelations,
  newNode,
  shortID,
  isConcreteRefId,
  parseConcreteRefId,
} from "../connections";
import { DND } from "../dnd";
import {
  ALICE,
  BOB,
  renderApp,
  renderWithTestData,
  setup,
  expectTree,
  renderTree,
  findNewNodeEditor,
  type,
} from "../utils.test";
import {
  NodeIndex,
  RootViewContextProvider,
  newRelations,
  viewPathToString,
  getDiffItemsForNode,
  getLast,
} from "../ViewContext";
import { TreeView } from "./TreeView";
import { DraggableNote } from "./Draggable";
import { TemporaryViewProvider } from "./TemporaryViewContext";
import { createPlan, planUpsertNode, planUpsertRelations } from "../planner";
import { execute } from "../executor";
import { getNodesInTree } from "./Node";
import { LoadData } from "../dataQuery";
import { newDB } from "../knowledge";

test("Render non existing Node", async () => {
  const [alice] = setup([ALICE]);
  const { publicKey } = alice().user;
  const pl = newNode("Programming Languages");
  const relations = addRelationToRelations(
    newRelations(pl.id, List(), publicKey),
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
    <LoadData nodeIDs={[pl.id]} descendants referencedBy lists>
      <RootViewContextProvider root={pl.id}>
        <TemporaryViewProvider>
          <DND>
            <TreeView />
          </DND>
        </TemporaryViewProvider>
      </RootViewContextProvider>
    </LoadData>,
    alice()
  );
  await screen.findByText("Programming Languages");

  // Expand the node to see the child that points to a non-existent node
  await userEvent.click(
    await screen.findByLabelText("expand Programming Languages")
  );

  await screen.findByText("Error: Node not found");
});

async function expectNode(text: string, editable: boolean): Promise<void> {
  const elements = await screen.findAllByText(text);
  // Pick the first element for checking
  const element = elements[0];
  // With inline editing, editable nodes have role="textbox" or are inside one
  // Check if element or its parent has contenteditable
  const isContentEditable =
    element.getAttribute("contenteditable") === "true" ||
    element.getAttribute("role") === "textbox";
  if (editable) {
    expect(isContentEditable).toBe(true);
  } else {
    expect(isContentEditable).toBe(false);
  }
}

test("Edit node inline", async () => {
  const [alice] = setup([ALICE]);
  const note = newNode("My Note");
  await execute({
    ...alice(),
    plan: planUpsertNode(createPlan(alice()), note),
  });
  renderWithTestData(
    <LoadData nodeIDs={[note.id]} descendants referencedBy lists>
      <RootViewContextProvider root={note.id}>
        <TemporaryViewProvider>
          <DND>
            <>
              <DraggableNote />
              <TreeView />
            </>
          </DND>
        </TemporaryViewProvider>
      </RootViewContextProvider>
    </LoadData>,
    alice()
  );
  await expectNode("My Note", true);
  // With inline editing, click the text to focus and edit directly
  const textElements = await screen.findAllByText("My Note");
  const textElement = textElements[0];
  await userEvent.click(textElement);
  // Clear and type new text
  await userEvent.clear(textElement);
  await userEvent.type(textElement, "My edited Note");
  // Blur to save (inline editing saves on blur)
  fireEvent.blur(textElement);
  const editedElements = await screen.findAllByText("My edited Note");
  expect(editedElements.length).toBeGreaterThan(0);
});

test("Load Note from other User which is not a contact", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  // Create Bob's note directly without setupTestDB
  const bobsNote = newNode("Bobs Note");
  await execute({
    ...bob(),
    plan: planUpsertNode(createPlan(bob()), bobsNote),
  });

  renderWithTestData(
    <LoadData nodeIDs={[bobsNote.id]} descendants referencedBy lists>
      <RootViewContextProvider root={bobsNote.id}>
        <TemporaryViewProvider>
          <DND>
            <>
              <DraggableNote />
              <TreeView />
            </>
          </DND>
        </TemporaryViewProvider>
      </RootViewContextProvider>
    </LoadData>,
    alice()
  );
  // May have multiple elements
  const elements = await screen.findAllByText("Bobs Note");
  expect(elements.length).toBeGreaterThan(0);
});

test("Edit nested node inline", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);

  await type("My Notes{Enter}{Tab}Parent{Enter}{Tab}Nested Node{Escape}");

  await expectTree(`
My Notes
  Parent
    Nested Node
  `);

  const nestedEditor = await screen.findByLabelText("edit Nested Node");
  await userEvent.click(nestedEditor);
  await userEvent.clear(nestedEditor);
  await userEvent.type(nestedEditor, "My edited Note{Escape}");

  await screen.findByLabelText("edit My edited Note");
});

test("Edited node is shown in Tree View", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);

  await type("My Notes{Enter}{Tab}OOP Languages{Enter}{Tab}Java{Escape}");

  const javaEditor = await screen.findByLabelText("edit Java");
  await userEvent.clear(javaEditor);
  await userEvent.type(javaEditor, "C++{Escape}");

  await expectTree(`
My Notes
  OOP Languages
    C++
  `);

  cleanup();
  renderTree(alice);

  await expectTree(`
My Notes
  OOP Languages
    C++
  `);
});

test.skip("Delete node", async () => {
  const [alice] = setup([ALICE]);
  const note = newNode("My Note");
  await execute({
    ...alice(),
    plan: planUpsertNode(createPlan(alice()), note),
  });
  renderWithTestData(
    <LoadData nodeIDs={[note.id]} descendants referencedBy lists>
      <RootViewContextProvider root={note.id}>
        <TemporaryViewProvider>
          <DND>
            <>
              <DraggableNote />
              <TreeView />
            </>
          </DND>
        </TemporaryViewProvider>
      </RootViewContextProvider>
    </LoadData>,
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

  const parent = newNode("Parent");
  const child = newNode("Child");
  const aliceGrandchild = newNode("Alice's Grandchild");
  const bobGrandchild = newNode("Bob's Grandchild");
  const parentRelations = addRelationToRelations(
    newRelations(parent.id, List(), alicePK),
    child.id
  );
  // child's relations have context=[parent] since child is under parent
  const childContext = List([shortID(parent.id)]);
  const childRelations = addRelationToRelations(
    newRelations(child.id, childContext, alicePK),
    aliceGrandchild.id
  );
  const bobChildRelations = addRelationToRelations(
    newRelations(child.id, childContext, bobPK),
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
      viewingMode: undefined,
      expanded: true,
    })
    .set(viewPathToString(childPath), {
      viewingMode: undefined,
      expanded: true,
    });

  const data: Data = {
    ...alice(),
    knowledgeDBs,
    views,
    panes: [{ id: "pane-0", stack: [parent.id], author: alicePK }],
  };

  const nodes = getNodesInTree(
    data,
    parentPath,
    [parent.id],
    List(),
    undefined
  );
  const nodeIDs = nodes.map((path) => getLast(path).nodeID).toArray();

  expect(nodeIDs).toContain(child.id);
  expect(nodeIDs).toContain(aliceGrandchild.id);
  expect(nodeIDs).toContain(bobGrandchild.id);
});

test("getDiffItemsForNode returns items from other users not in current user's list", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const parent = newNode("Parent");
  const aliceChild = newNode("Alice's Child");
  const bobChild = newNode("Bob's Child");

  const aliceRelations = addRelationToRelations(
    newRelations(parent.id, List(), alicePK),
    aliceChild.id
  );
  const bobRelations = addRelationToRelations(
    newRelations(parent.id, List(), bobPK),
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
    ["", "suggestions"],
    aliceRelations.id
  );

  expect(diffItems.size).toBe(1);
  expect(diffItems.get(0)).toBe(bobChild.id);
});

test("getDiffItemsForNode excludes items already in user's list", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const parent = newNode("Parent");
  const sharedChild = newNode("Shared Child");

  const aliceRelations = addRelationToRelations(
    newRelations(parent.id, List(), alicePK),
    sharedChild.id
  );
  const bobRelations = addRelationToRelations(
    newRelations(parent.id, List(), bobPK),
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
    ["", "suggestions"],
    aliceRelations.id
  );

  expect(diffItems.size).toBe(0);
});

test("Diff item paths are correctly identified as diff items", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const root = newNode("Root");
  const parent = newNode("Parent");
  const aliceChild = newNode("Alice's Child");
  const bobChild = newNode("Bob's Child");

  const rootRelations = addRelationToRelations(
    newRelations(root.id, List(), alicePK),
    parent.id
  );
  // parent's relations have context=[root] since parent is under root
  const parentContext = List([shortID(root.id)]);
  const parentRelations = addRelationToRelations(
    newRelations(parent.id, parentContext, alicePK),
    aliceChild.id
  );
  const bobParentRelations = addRelationToRelations(
    newRelations(parent.id, parentContext, bobPK),
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
      viewingMode: undefined,
      expanded: true,
    })
    .set(viewPathToString(parentPath), {
      viewingMode: undefined,
      expanded: true,
    });

  const data: Data = {
    ...alice(),
    knowledgeDBs,
    views,
    panes: [{ id: "pane-0", stack: [root.id], author: alicePK }],
  };

  const nodes = getNodesInTree(data, rootPath, [root.id], List(), undefined);
  expect(nodes.size).toBeGreaterThanOrEqual(3);

  const diffItemPath = nodes.find(
    (path) => getLast(path).nodeID === bobChild.id
  );
  expect(diffItemPath).toBeDefined();

  const aliceChildPath = nodes.find(
    (path) => getLast(path).nodeID === aliceChild.id
  );
  expect(aliceChildPath).toBeDefined();
});

test("getDiffItemsForNode should return no diff items for not_relevant relation type", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const parent = newNode("Parent");
  const bobChild = newNode("Bob's Child");

  const aliceRelations = newRelations(parent.id, List(), alicePK);
  const bobRelations = addRelationToRelations(
    newRelations(parent.id, List(), bobPK),
    bobChild.id,
    "not_relevant"
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
    ["not_relevant", "suggestions"],
    aliceRelations.id
  );
  expect(diffItems.size).toBe(0);
});

test("getDiffItemsForNode returns plain nodeID for leaf suggestions (no children)", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const parent = newNode("Parent");
  const bobLeafChild = newNode("Bob's Leaf Child");

  const aliceRelations = newRelations(parent.id, List(), alicePK);
  const bobRelations = addRelationToRelations(
    newRelations(parent.id, List(), bobPK),
    bobLeafChild.id
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
      nodes: newDB().nodes.set(shortID(bobLeafChild.id), bobLeafChild),
      relations: newDB().relations.set(shortID(bobRelations.id), bobRelations),
    });

  const diffItems = getDiffItemsForNode(
    knowledgeDBs,
    alicePK,
    parent.id,
    ["", "suggestions"],
    aliceRelations.id,
    List()
  );

  expect(diffItems.size).toBe(1);
  const suggestion = diffItems.get(0);
  expect(isConcreteRefId(suggestion as string)).toBe(false);
  expect(suggestion).toBe(bobLeafChild.id);
});

test("getDiffItemsForNode returns concrete ref for expandable suggestions (has children)", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const parent = newNode("Parent");
  const bobFolder = newNode("Bob's Folder");
  const bobGrandchild = newNode("Bob's Grandchild");

  const aliceRelations = newRelations(parent.id, List(), alicePK);
  const bobParentRelations = addRelationToRelations(
    newRelations(parent.id, List(), bobPK),
    bobFolder.id
  );
  const bobFolderRelations = addRelationToRelations(
    newRelations(bobFolder.id, List<ID>([parent.id as ID]), bobPK),
    bobGrandchild.id
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
      nodes: newDB()
        .nodes.set(shortID(bobFolder.id), bobFolder)
        .set(shortID(bobGrandchild.id), bobGrandchild),
      relations: newDB()
        .relations.set(shortID(bobParentRelations.id), bobParentRelations)
        .set(shortID(bobFolderRelations.id), bobFolderRelations),
    });

  const diffItems = getDiffItemsForNode(
    knowledgeDBs,
    alicePK,
    parent.id,
    ["", "suggestions"],
    aliceRelations.id,
    List()
  );

  expect(diffItems.size).toBe(1);
  const suggestion = diffItems.get(0);
  expect(isConcreteRefId(suggestion as string)).toBe(true);
  const parsed = parseConcreteRefId(suggestion as LongID);
  expect(parsed).toBeDefined();
  expect(parsed?.relationID).toBe(bobFolderRelations.id);
});

test("getDiffItemsForNode only returns suggestions from matching context", () => {
  const [alice, bob] = setup([ALICE, BOB]);
  const { publicKey: alicePK } = alice().user;
  const { publicKey: bobPK } = bob().user;

  const parent = newNode("Parent");
  const bobChildSameContext = newNode("Bob's Child Same Context");
  const bobChildDiffContext = newNode("Bob's Child Different Context");

  const aliceRelations = newRelations(parent.id, List(), alicePK);
  const bobRelationsSameContext = addRelationToRelations(
    newRelations(parent.id, List(), bobPK),
    bobChildSameContext.id
  );
  const bobRelationsDiffContext = addRelationToRelations(
    newRelations(parent.id, List<ID>(["other-context" as ID]), bobPK),
    bobChildDiffContext.id
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
      nodes: newDB()
        .nodes.set(shortID(bobChildSameContext.id), bobChildSameContext)
        .set(shortID(bobChildDiffContext.id), bobChildDiffContext),
      relations: newDB()
        .relations.set(
          shortID(bobRelationsSameContext.id),
          bobRelationsSameContext
        )
        .set(shortID(bobRelationsDiffContext.id), bobRelationsDiffContext),
    });

  const diffItems = getDiffItemsForNode(
    knowledgeDBs,
    alicePK,
    parent.id,
    ["", "suggestions"],
    aliceRelations.id,
    List()
  );

  expect(diffItems.size).toBe(1);
  expect(diffItems.get(0)).toBe(bobChildSameContext.id);
});

// Tests for inline node creation via keyboard
describe("Inline Node Creation", () => {
  test("Create new sibling node by pressing Enter on existing node", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}First Child{Escape}");

    await expectTree(`
My Notes
  First Child
    `);

    // Click on First Child and press Enter to create sibling
    const childEditor = await screen.findByLabelText("edit First Child");
    await userEvent.click(childEditor);
    await userEvent.keyboard("{Enter}");

    // Verify empty editor appeared after First Child
    await expectTree(`
My Notes
  First Child
  [NEW NODE]
    `);

    // Type the new node text
    await userEvent.type(await findNewNodeEditor(), "Second Child");

    await expectTree(`
My Notes
  First Child
  [NEW NODE: Second Child]
    `);

    // Press Enter to save and create another sibling
    await userEvent.keyboard("{Enter}");

    await expectTree(`
My Notes
  First Child
  Second Child
  [NEW NODE]
    `);

    // Close the editor
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await expectTree(`
My Notes
  First Child
  Second Child
    `);
  });

  test("Create multiple sibling nodes by pressing Enter repeatedly", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}Node 1{Escape}");

    // Click on Node 1 and press Enter to start chaining
    const node1Editor = await screen.findByLabelText("edit Node 1");
    await userEvent.click(node1Editor);
    await userEvent.keyboard("{Enter}");

    // Create Node 2, 3, 4 by chaining Enter
    await userEvent.type(await findNewNodeEditor(), "Node 2{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Node 3{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Node 4{Escape}");

    await expectTree(`
My Notes
  Node 1
  Node 2
  Node 3
  Node 4
    `);
  });

  test("Empty editor closes without creating a node", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}Existing Child{Escape}");

    await expectTree(`
My Notes
  Existing Child
    `);

    // Click on Existing Child and press Enter to open editor
    const childEditor = await screen.findByLabelText("edit Existing Child");
    await userEvent.click(childEditor);
    await userEvent.keyboard("{Enter}");

    await expectTree(`
My Notes
  Existing Child
  [NEW NODE]
    `);

    // Press Enter without typing anything - should close
    await userEvent.type(await findNewNodeEditor(), "{Enter}");

    // Editor should be gone, only the original child should exist
    await expectTree(`
My Notes
  Existing Child
    `);
  });

  test("Creating node via UI sends correct Nostr events", async () => {
    const [alice] = setup([ALICE]);
    const utils = alice();

    // Reset relay pool to track only new events
    utils.relayPool.resetPublishedOnRelays();

    renderTree(alice);

    await type("My Notes{Enter}{Tab}Child{Escape}");

    // Reset again to only track sibling creation events
    utils.relayPool.resetPublishedOnRelays();

    // Click on Child and press Enter to create sibling
    const childEditor = await screen.findByLabelText("edit Child");
    await userEvent.click(childEditor);
    await userEvent.keyboard("{Enter}");

    // Type in the new editor and save with Escape
    await userEvent.type(await findNewNodeEditor(), "New Sibling{Escape}");

    // Wait for the new node to appear
    await screen.findByLabelText("edit New Sibling");

    // Verify a knowledge node event was sent
    const events = utils.relayPool.getEvents();
    const nodeEvents = events.filter((e) => e.kind === 34751); // KIND_KNOWLEDGE_NODE
    const newNodeEvent = nodeEvents.find((e) =>
      e.content.includes("New Sibling")
    );
    expect(newNodeEvent).toBeTruthy();

    // Verify a relations event was sent (kind 34760 = KIND_KNOWLEDGE_LIST)
    const relationsEvents = events.filter((e) => e.kind === 34760);
    expect(relationsEvents.length).toBeGreaterThan(0);
  });

  test("Enter on expanded parent inserts new child at BEGINNING of list", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "My Notes{Enter}{Tab}Parent{Enter}{Tab}Child 1{Enter}Child 2{Escape}"
    );

    await expectTree(`
My Notes
  Parent
    Child 1
    Child 2
    `);

    // Click on expanded Parent and press Enter - should open editor at BEGINNING
    const parentEditor = await screen.findByLabelText("edit Parent");
    await userEvent.click(parentEditor);
    await userEvent.keyboard("{Enter}");

    // Type and save
    await userEvent.type(await findNewNodeEditor(), "New First Child{Escape}");

    // Verify tree order: New First Child should be first among children
    await expectTree(`
My Notes
  Parent
    New First Child
    Child 1
    Child 2
    `);
  });

  test("Create sibling with renderApp (full app integration)", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("My Notes{Enter}{Tab}First Child{Escape}");

    await expectTree(`
My Notes
  First Child
    `);

    // Click on First Child and press Enter to create sibling
    const childEditor = await screen.findByLabelText("edit First Child");
    await userEvent.click(childEditor);
    await userEvent.keyboard("{Enter}");

    // Verify empty editor appeared after First Child
    await expectTree(`
My Notes
  First Child
  [NEW NODE]
    `);

    // Type the new node text and save
    await userEvent.type(await findNewNodeEditor(), "Second Child{Escape}");

    await expectTree(`
My Notes
  First Child
  Second Child
    `);
  });
});
