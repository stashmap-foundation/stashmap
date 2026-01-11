import React from "react";
import { List } from "immutable";
import { fireEvent, screen } from "@testing-library/react";
import {
  ALICE,
  findNodeByText,
  renderWithTestData,
  setup,
  setupTestDB,
} from "../utils.test";
import Data from "../Data";
import { LoadNode } from "../dataQuery";
import { PushNode, RootViewContextProvider } from "../ViewContext";
import { TreeView } from "./TreeView";
import { DraggableNote } from "./Draggable";
import { RootViewOrWorkspaceIsLoading } from "./Dashboard";
import { TemporaryViewProvider } from "./TemporaryViewContext";
import { DND } from "../dnd";

test("Load Referenced By Nodes", async () => {
  const [alice] = setup([ALICE]);
  const aliceDB = await setupTestDB(
    alice(),
    [["Alice Workspace", [["Money", ["Bitcoin"]]]]],
    { activeWorkspace: "Alice Workspace" }
  );
  const bitcoin = findNodeByText(aliceDB, "Bitcoin") as KnowNode;

  await setupTestDB(alice(), [
    ["Cryptocurrencies", [bitcoin]],
    ["P2P Apps", [bitcoin]],
  ]);
  renderWithTestData(
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
      initialRoute: `/w/${aliceDB.activeWorkspace}`,
    }
  );
  await screen.findByText("Bitcoin");
  fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
  screen.getByText("Referenced By (3)");
  await screen.findByText("Cryptocurrencies");
  await screen.findByText("P2P Apps");
});

test("Show Referenced By with content details", async () => {
  const [alice] = setup([ALICE]);
  const aliceKnowledgeDB = await setupTestDB(alice(), [["Money", ["Bitcoin"]]]);
  const btc = findNodeByText(aliceKnowledgeDB, "Bitcoin") as KnowNode;
  const db = await setupTestDB(
    alice(),
    [["Alice Workspace", [[btc], ["P2P Apps", [btc]]]]],
    { activeWorkspace: "Alice Workspace" }
  );
  renderWithTestData(
    <Data user={alice().user}>
      <RootViewOrWorkspaceIsLoading>
        <PushNode push={List([0])}>
          <LoadNode referencedBy>
            <>
              <DraggableNote />
              <TreeView />
            </>
          </LoadNode>
        </PushNode>
      </RootViewOrWorkspaceIsLoading>
    </Data>,
    {
      ...alice(),
      initialRoute: `/w/${db.activeWorkspace}`,
    }
  );
  await screen.findByText("Bitcoin");
  fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
  screen.getByLabelText("hide references to Bitcoin");
  expect(
    (await screen.findByLabelText("related to Bitcoin")).textContent
  ).toMatch(/Money1(.*)Alice Workspace2(.*)P2P Apps1/);
});

test("Root node shows references when there are more than 0", async () => {
  const [alice] = setup([ALICE]);
  const db = await setupTestDB(alice(), [["Money", ["Bitcoin"]]]);
  const bitcoin = findNodeByText(db, "Bitcoin") as KnowNode;
  renderWithTestData(
    <Data user={alice().user}>
      <RootViewContextProvider root={bitcoin.id}>
        <TemporaryViewProvider>
          <DND>
            <LoadNode referencedBy>
              <>
                <DraggableNote />
                <TreeView />
              </>
            </LoadNode>
          </DND>
        </TemporaryViewProvider>
      </RootViewContextProvider>
    </Data>,
    {
      ...alice(),
      initialRoute: `/d/${bitcoin.id}`,
    }
  );
  await screen.findByText("Bitcoin");
  fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
  screen.getByLabelText("hide references to Bitcoin");
  expect(
    (await screen.findByLabelText("related to Bitcoin")).textContent
  ).toMatch(/Money(.*)/);
  screen.getByText("Referenced By (1)");
});
