import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { List } from "immutable";
import {
  PushNode,
  RootViewContextProvider,
  newRelations,
} from "../ViewContext";
import { execute } from "../executor";
import { createPlan, planUpsertRelations } from "../planner";
import { ALICE, renderWithTestData, setup, UpdateState } from "../utils.test";
import { planCreateNodesFromMarkdown } from "./FileDropZone";
import { TreeView } from "./TreeView";
import { DraggableNote } from "./Draggable";
import { addRelationToRelations, joinID } from "../connections";
import { DND } from "../dnd";
import { TemporaryViewProvider } from "./TemporaryViewContext";
import { LoadNode } from "../dataQuery";

const TEST_FILE = `# Programming Languages

## Java

Java is a programming language

## Python

Python is a programming language
`;

async function uploadAndRenderMarkdown(alice: UpdateState): Promise<void> {
  const [plan, topNodeID] = planCreateNodesFromMarkdown(
    createPlan(alice()),
    TEST_FILE
  );
  const wsID = joinID(alice().user.publicKey, "my-first-workspace");
  const addNodeToWS = planUpsertRelations(
    plan,
    addRelationToRelations(
      newRelations(wsID, "", alice().user.publicKey),
      topNodeID
    )
  );
  await execute({
    ...alice(),
    plan: addNodeToWS,
  });

  renderWithTestData(
    <RootViewContextProvider root={wsID}>
      <LoadNode waitForEose>
        <PushNode push={List([0])}>
          <LoadNode>
            <TemporaryViewProvider>
              <DND>
                <DraggableNote />
                <TreeView />
              </DND>
            </TemporaryViewProvider>
          </LoadNode>
        </PushNode>
      </LoadNode>
    </RootViewContextProvider>,
    alice()
  );
  await screen.findByText("Programming Languages");
}

test("Markdown Upload", async () => {
  const [alice] = setup([ALICE]);
  await uploadAndRenderMarkdown(alice);
  screen.getByText("Java");
  screen.getByText("Java is a programming language");
  screen.getByText("Python");
  screen.getByText("Python is a programming language");
});

test("Delete Node uploaded from Markdown", async () => {
  const [alice] = setup([ALICE]);
  await uploadAndRenderMarkdown(alice);
  await userEvent.click(screen.getByLabelText("edit Python"));
  await userEvent.click(screen.getByLabelText("delete node"));

  expect(screen.queryByText("Python")).toBeNull();
  screen.getByText("Java");

  cleanup();

  const wsID = joinID(alice().user.publicKey, "my-first-workspace");
  // Test after rerender
  renderWithTestData(
    <RootViewContextProvider root={wsID}>
      <LoadNode waitForEose>
        <PushNode push={List([0])}>
          <LoadNode>
            <TemporaryViewProvider>
              <DND>
                <DraggableNote />
                <TreeView />
              </DND>
            </TemporaryViewProvider>
          </LoadNode>
        </PushNode>
      </LoadNode>
    </RootViewContextProvider>,
    alice()
  );
  await screen.findByText("Java");
  expect(screen.queryByText("Python")).toBeNull();
});

test("Edit Node uploaded from Markdown", async () => {
  const [alice] = setup([ALICE]);
  await uploadAndRenderMarkdown(alice);

  await userEvent.click(screen.getByLabelText("edit Programming Languages"));
  await userEvent.keyboard(" OOP{enter}");
  await userEvent.click(screen.getByText("Save"));
  await waitFor(() => {
    expect(screen.queryByText("Programming Languages")).toBeNull();
  });
  await screen.findByText("Programming Languages OOP");
});

const originalRange = document.createRange;

// Quill autofocus feature crashes if createRange doesn't return values
beforeAll(() => {
  // eslint-disable-next-line functional/immutable-data
  document.createRange = () => {
    const range = new Range();

    // eslint-disable-next-line functional/immutable-data
    range.getBoundingClientRect = () =>
      ({
        height: 100,
        width: 100,
        x: 0,
        y: 0,
      } as DOMRect);

    // eslint-disable-next-line functional/immutable-data
    range.getClientRects = () => {
      return {
        item: () => null,
        length: 0,
        [Symbol.iterator]: jest.fn(),
      };
    };

    return range;
  };
});

afterAll(() => {
  // eslint-disable-next-line functional/immutable-data
  document.createRange = originalRange;
});
/* eslint-enable no-console */
