import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
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
import { addRelationToRelations, joinID, shortID } from "../connections";
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
  const wsID = joinID(alice().user.publicKey, "my-first-workspace");
  // Pass context=[wsID] so relations are created for viewing under the workspace
  const [plan, topNodeID] = planCreateNodesFromMarkdown(
    createPlan(alice()),
    TEST_FILE,
    List([shortID(wsID)])
  );
  const addNodeToWS = planUpsertRelations(
    plan,
    addRelationToRelations(
      newRelations(wsID, List(), alice().user.publicKey),
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
                <TreeView />
              </DND>
            </TemporaryViewProvider>
          </LoadNode>
        </PushNode>
      </LoadNode>
    </RootViewContextProvider>,
    alice()
  );
  // Wait for node to be visible - it might be in edit mode
  // Find any textbox with "Programming Languages" in its accessible name
  const textboxes = await screen.findAllByRole("textbox");
  const plTextbox = textboxes.find(
    (tb) =>
      tb.getAttribute("aria-label")?.includes("Programming Languages") ?? false
  );
  expect(plTextbox).toBeDefined();
}

test("Markdown Upload", async () => {
  const [alice] = setup([ALICE]);
  await uploadAndRenderMarkdown(alice);
  // Expand Programming Languages to see children
  await userEvent.click(
    await screen.findByLabelText("expand Programming Languages")
  );
  // Verify the imported nodes exist by finding textboxes with their names
  const allTextboxes = await screen.findAllByRole("textbox");
  const javaTextbox = allTextboxes.find(
    (tb) => tb.getAttribute("aria-label")?.includes("Java") ?? false
  );
  const pythonTextbox = allTextboxes.find(
    (tb) => tb.getAttribute("aria-label")?.includes("Python") ?? false
  );
  expect(javaTextbox).toBeDefined();
  expect(pythonTextbox).toBeDefined();
});

test.skip("Delete Node uploaded from Markdown", async () => {
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

  // With inline editing, find the text and edit directly
  const textElement = screen.getByText("Programming Languages");
  await userEvent.click(textElement);
  // Type additional text at the end
  await userEvent.type(textElement, " OOP");
  // Blur to save
  fireEvent.blur(textElement);
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
