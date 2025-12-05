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
import { PushNode } from "../ViewContext";
import { TreeView } from "./TreeView";
import { RootViewOrWorkspaceIsLoading } from "./Dashboard";

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
