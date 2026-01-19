import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { List, Map } from "immutable";
import userEvent from "@testing-library/user-event";
import { addRelationToRelations, newNode, shortID } from "../connections";
import { DND } from "../dnd";
import {
  ALICE,
  BOB,
  follow,
  matchSplitText,
  renderApp,
  renderWithTestData,
  setup,
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
    <RootViewContextProvider root={pl.id}>
      <TemporaryViewProvider>
        <DND>
          <LoadNode>
            <TreeView />
          </LoadNode>
        </DND>
      </TemporaryViewProvider>
    </RootViewContextProvider>,
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
  const { publicKey } = alice().user;
  const note = newNode("My Note");
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
    <RootViewContextProvider root={bobsNote.id}>
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
  // May have multiple elements
  const elements = await screen.findAllByText("Bobs Note");
  expect(elements.length).toBeGreaterThan(0);
});

test("Cannot edit remote Note", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);
  // Create Bob's note directly without setupTestDB
  const bobsNote = newNode("Bobs Remote Note");
  await execute({
    ...bob(),
    plan: planUpsertNode(createPlan(bob()), bobsNote),
  });
  renderWithTestData(
    <RootViewContextProvider root={bobsNote.id}>
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
  await expectNode("Bobs Remote Note", false);
});

test("Edit nested node inline", async () => {
  const [alice] = setup([ALICE]);
  const { publicKey } = alice().user;
  const note = newNode("My Note");
  // Connect the note with itself so it's not the root note
  const plan = planUpsertRelations(
    createPlan(alice()),
    addRelationToRelations(newRelations(note.id, List(), publicKey), note.id)
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
  // With inline editing, find and click the text to edit directly
  const textElement = await screen.findByText("My Note");
  await userEvent.click(textElement);
  await userEvent.clear(textElement);
  await userEvent.type(textElement, "My edited Note");
  fireEvent.blur(textElement);
  await screen.findByText("My edited Note");
});

test.skip("Edited node is shown in Tree View", async () => {
  const [alice] = setup([ALICE]);
  const { publicKey } = alice().user;
  const pl = newNode("Programming Languages");
  const oop = newNode("Object Oriented Programming languages");
  const java = newNode("Java");

  const plan = planUpsertRelations(
    planUpsertRelations(
      planUpsertRelations(
        createPlan(alice()),
        // pl's relations have empty context (it's the root workspace)
        addRelationToRelations(newRelations(pl.id, List(), publicKey), oop.id)
      ),
      // oop's relations have context=[pl] since oop is under pl
      addRelationToRelations(
        newRelations(oop.id, List([shortID(pl.id)]), publicKey),
        java.id
      )
    ),
    addRelationToRelations(newRelations(ROOT, List(), publicKey), ROOT)
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
  // With inline editing, "Java" is already editable - find the contenteditable textbox
  const editors = await screen.findAllByRole("textbox", {
    name: "note editor",
  });
  const javaEditor = editors.find((e) => e.textContent === "Java");
  if (!javaEditor) {
    throw new Error("Java editor not found");
  }

  // Clear and type new content using userEvent (selection then type)
  // eslint-disable-next-line functional/immutable-data
  javaEditor.textContent = "";
  await userEvent.type(javaEditor, "C++");
  fireEvent.blur(javaEditor);

  // Verify the change was saved
  expect(screen.queryByText("Java")).toBeNull();
  await screen.findByText("C++");
});

test.skip("Delete node", async () => {
  const [alice] = setup([ALICE]);
  const { publicKey } = alice().user;
  const note = newNode("My Note");
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

  const nodes = getNodesInTree(data, parentPath, [parent.id], List());
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
  expect(diffItems.get(0)?.nodeID).toBe(bobChild.id);
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

  const nodes = getNodesInTree(data, rootPath, [root.id], List());
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

test.skip("Multiple connections to same node", async () => {
  const [alice] = setup([ALICE]);
  const java = newNode("Java");
  const pl = newNode("Programming Languages");
  const rootRelations = addRelationToRelations(
    newRelations("ROOT", List(), alice().user.publicKey),
    pl.id
  );
  await execute({
    ...alice(),
    plan: planUpsertRelations(
      planBulkUpsertNodes(createPlan(alice()), [java, pl]),
      rootRelations
    ),
  });

  renderApp(alice());
  await screen.findByText("Programming Languages");

  // Expand the node to show children area
  const expandButton = await screen.findByLabelText(
    "expand Programming Languages"
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

// Helper to find the empty CreateNodeEditor (the new editor without text)
async function findEmptyEditor(): Promise<HTMLElement> {
  const editors = await screen.findAllByRole("textbox", {
    name: "note editor",
  });
  const emptyEditor = editors.find((e) => e.textContent === "");
  if (!emptyEditor) {
    throw new Error("No empty editor found");
  }
  return emptyEditor;
}

// Tests for inline node creation via keyboard - covered by TreeEditor.test.tsx
describe.skip("Inline Node Creation", () => {
  test("Create new sibling node by pressing Enter on existing node", async () => {
    const [alice] = setup([ALICE]);
    const { publicKey } = alice().user;
    // Create an initial editable node
    const parent = newNode("Parent Node");
    const child = newNode("First Child");
    const relations = addRelationToRelations(
      newRelations(parent.id, List(), publicKey),
      child.id
    );
    await execute({
      ...alice(),
      plan: planUpsertRelations(
        planUpsertNode(planUpsertNode(createPlan(alice()), parent), child),
        relations
      ),
    });

    renderWithTestData(
      <RootViewContextProvider root={parent.id}>
        <LoadNode waitForEose>
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

    // Find the child node's editable text
    const childText = await screen.findByText("First Child");
    await userEvent.click(childText);

    // Press Enter to open the CreateNodeEditor for a new sibling
    await userEvent.type(childText, "{Enter}");

    // Find the new empty editor that opened
    const newEditor = await findEmptyEditor();
    expect(newEditor).toBeTruthy();

    // Type the new node text
    await userEvent.type(newEditor, "Second Child");

    // Press Enter to save and create
    await userEvent.type(newEditor, "{Enter}");

    // Verify both nodes appear
    await screen.findByText("First Child");
    await screen.findByText("Second Child");
  });

  test("Create multiple sibling nodes by pressing Enter repeatedly", async () => {
    const [alice] = setup([ALICE]);
    const { publicKey } = alice().user;
    // Create an initial editable node
    const parent = newNode("Parent Node");
    const child = newNode("Node 1");
    const relations = addRelationToRelations(
      newRelations(parent.id, List(), publicKey),
      child.id
    );
    await execute({
      ...alice(),
      plan: planUpsertRelations(
        planUpsertNode(planUpsertNode(createPlan(alice()), parent), child),
        relations
      ),
    });

    renderWithTestData(
      <RootViewContextProvider root={parent.id}>
        <LoadNode waitForEose>
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

    // Start from the first node
    const node1Text = await screen.findByText("Node 1");
    await userEvent.click(node1Text);
    await userEvent.type(node1Text, "{Enter}");

    // Create Node 2 - find the empty editor
    const editor1 = await findEmptyEditor();
    await userEvent.type(editor1, "Node 2{Enter}");

    // Editor should chain - create Node 3
    const editor2 = await findEmptyEditor();
    await userEvent.type(editor2, "Node 3{Enter}");

    // Create Node 4
    const editor3 = await findEmptyEditor();
    await userEvent.type(editor3, "Node 4");
    // Blur to close without chaining
    fireEvent.blur(editor3);

    // Verify all nodes appear
    await screen.findByText("Node 1");
    await screen.findByText("Node 2");
    await screen.findByText("Node 3");
    await screen.findByText("Node 4");
  });

  test("Empty editor closes without creating a node", async () => {
    const [alice] = setup([ALICE]);
    const { publicKey } = alice().user;
    const parent = newNode("Parent Node");
    const child = newNode("Existing Child");
    const relations = addRelationToRelations(
      newRelations(parent.id, List(), publicKey),
      child.id
    );
    await execute({
      ...alice(),
      plan: planUpsertRelations(
        planUpsertNode(planUpsertNode(createPlan(alice()), parent), child),
        relations
      ),
    });

    renderWithTestData(
      <RootViewContextProvider root={parent.id}>
        <LoadNode waitForEose>
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

    const childText = await screen.findByText("Existing Child");
    await userEvent.click(childText);
    await userEvent.type(childText, "{Enter}");

    // Find the empty editor that opened
    const editor = await findEmptyEditor();

    // Press Enter without typing anything - should close
    await userEvent.type(editor, "{Enter}");

    // Editor should be gone - wait for the empty editor to disappear
    await waitFor(() => {
      const editors = screen.queryAllByRole("textbox", { name: "note editor" });
      const emptyEditors = editors.filter((e) => e.textContent === "");
      expect(emptyEditors.length).toBe(0);
    });

    // Only the original child should exist
    expect(screen.getAllByText(/Child/).length).toBe(1);
  });

  test("Creating node via UI sends correct Nostr events", async () => {
    const [alice] = setup([ALICE]);
    const { publicKey } = alice().user;
    // Create an initial editable node
    const parent = newNode("Parent");
    const child = newNode("Child");
    const relations = addRelationToRelations(
      newRelations(parent.id, List(), publicKey),
      child.id
    );
    await execute({
      ...alice(),
      plan: planUpsertRelations(
        planUpsertNode(planUpsertNode(createPlan(alice()), parent), child),
        relations
      ),
    });

    // Reset relay pool to track only new events
    alice().relayPool.resetPublishedOnRelays();

    renderWithTestData(
      <RootViewContextProvider root={parent.id}>
        <LoadNode waitForEose>
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

    // Find child and press Enter to create sibling
    const childText = await screen.findByText("Child");
    await userEvent.click(childText);
    await userEvent.type(childText, "{Enter}");

    // Type in the new editor
    const newEditor = await findEmptyEditor();
    await userEvent.type(newEditor, "New Sibling");

    // Blur to save
    fireEvent.blur(newEditor);

    // Wait for the new node to appear
    await screen.findByText("New Sibling");

    // Verify a knowledge node event was sent
    const events = alice().relayPool.getEvents();
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
    const { publicKey } = alice().user;

    // Create parent with two existing children
    const parent = newNode("Parent");
    const child1 = newNode("Child 1");
    const child2 = newNode("Child 2");

    // Build relations with children in order: [child1, child2]
    let relations = newRelations(parent.id, List(), publicKey);
    relations = addRelationToRelations(relations, child1.id);
    relations = addRelationToRelations(relations, child2.id);

    await execute({
      ...alice(),
      plan: planUpsertRelations(
        planBulkUpsertNodes(createPlan(alice()), [parent, child1, child2]),
        relations
      ),
    });

    renderWithTestData(
      <RootViewContextProvider root={parent.id}>
        <LoadNode waitForEose>
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

    // Expand the parent to show children (may have multiple due to references)
    const expandButtons = await screen.findAllByLabelText("expand Parent");
    fireEvent.click(expandButtons[0]);

    // Wait for children to be visible
    await screen.findByText("Child 1");
    await screen.findByText("Child 2");

    // Find and click on the parent node editor (first one)
    const parentEditors = await screen.findAllByLabelText("edit Parent");
    await userEvent.click(parentEditors[0]);

    // Press Enter on the expanded parent - should open editor for first child position
    await userEvent.keyboard("{Enter}");

    // Find the new empty editor and type, then press Enter to save (not blur)
    const newEditor = await findEmptyEditor();
    await userEvent.type(newEditor, "New First Child{Enter}");

    // Wait for new node to appear and verify tree order
    await screen.findByText("New First Child");

    // Verify order using aria-label "related to Parent" which contains root + children
    const childrenContainer = await screen.findByLabelText("related to Parent");
    const allNodeTexts = Array.from(
      childrenContainer.querySelectorAll('[aria-label^="edit "]')
    ).map((el) => el.textContent);

    // First element is the root (Parent), rest are children
    // Expected order of children: New First Child, Child 1, Child 2
    const childTexts = allNodeTexts.slice(1); // Skip the root node
    expect(childTexts).toEqual(["New First Child", "Child 1", "Child 2"]);
  });
});
