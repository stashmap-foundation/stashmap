import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { List, Map } from "immutable";
import userEvent from "@testing-library/user-event";
import { addRelationToRelations, newNode } from "../connections";
import { DND } from "../dnd";
import {
  ALICE,
  BOB,
  createExampleProject,
  findNodeByText,
  follow,
  planUpsertProjectNode,
  renderWithTestData,
  setup,
  setupTestDB,
} from "../utils.test";
import {
  NodeIndex,
  PushNode,
  RootViewContextProvider,
  newRelations,
  viewPathToString,
} from "../ViewContext";
import { Column } from "./Column";
import { TemporaryViewProvider } from "./TemporaryViewContext";
import {
  createPlan,
  planBulkUpsertNodes,
  planUpdateViews,
  planUpsertNode,
  planUpsertRelations,
} from "../planner";
import { execute } from "../executor";
import { DraggableNote } from "./Draggable";
import { TreeView } from "./TreeView";
import { LoadNode } from "../dataQuery";
import { ROOT } from "../types";

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
            <Column />
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
            <Column />
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
            <Column />
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
            <Column />
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
            <Column />
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
            <Column />
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
            <Column />
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
