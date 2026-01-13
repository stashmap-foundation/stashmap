import React from "react";
import { List } from "immutable";
import { screen, fireEvent } from "@testing-library/react";
import { useSplitPanes } from "../SplitPanesContext";
import { ViewContext, ADD_TO_NODE, ViewPath, NodeIndex } from "../ViewContext";
import {
  OpenInSplitPaneButton,
  OpenInSplitPaneButtonWithStack,
} from "./OpenInSplitPaneButton";
import { ROOT } from "../types";
import { renderApis } from "../utils.test";
import { createRefId } from "../connections";

function PaneCountDisplay(): JSX.Element {
  const { panes } = useSplitPanes();
  return <div data-testid="pane-count">{panes.length}</div>;
}

function NewPaneStackDisplay(): JSX.Element {
  const { panes } = useSplitPanes();
  // Get the second pane's initial stack (if it exists)
  const newPaneStack = panes[1]?.initialStack || [];
  return <div data-testid="new-pane-stack">{JSON.stringify(newPaneStack)}</div>;
}

function renderWithContext(viewPath: ViewPath): void {
  renderApis(
    <ViewContext.Provider value={viewPath}>
      <OpenInSplitPaneButton />
      <PaneCountDisplay />
    </ViewContext.Provider>
  );
}

test("button renders on desktop", () => {
  const viewPath: ViewPath = [0, { nodeID: ROOT, nodeIndex: 0 as NodeIndex }];

  renderWithContext(viewPath);

  expect(screen.getByLabelText("open in split pane")).toBeTruthy();
});

test("clicking button calls addPaneAt and creates new pane", () => {
  const viewPath: ViewPath = [
    0,
    { nodeID: ROOT, nodeIndex: 0 as NodeIndex, relationsID: "" },
    { nodeID: "node1" as LongID, nodeIndex: 0 as NodeIndex },
  ];

  renderWithContext(viewPath);

  expect(screen.getByTestId("pane-count").textContent).toBe("1");

  fireEvent.click(screen.getByLabelText("open in split pane"));

  expect(screen.getByTestId("pane-count").textContent).toBe("2");
});

test("OpenInSplitPaneButtonWithStack passes provided stack to addPaneAt", () => {
  const stack = [ROOT, "node1" as LongID, "node2" as LongID];

  renderApis(
    <>
      <OpenInSplitPaneButtonWithStack stack={stack} />
      <PaneCountDisplay />
    </>
  );

  expect(screen.getByTestId("pane-count").textContent).toBe("1");

  fireEvent.click(screen.getByLabelText("open in split pane"));

  expect(screen.getByTestId("pane-count").textContent).toBe("2");
});

test("button is hidden for ADD_TO_NODE", () => {
  const viewPath: ViewPath = [
    0,
    { nodeID: ROOT, nodeIndex: 0 as NodeIndex, relationsID: "" },
    { nodeID: ADD_TO_NODE, nodeIndex: 0 as NodeIndex },
  ];

  renderWithContext(viewPath);

  expect(screen.queryByLabelText("open in split pane")).toBeNull();
});

test("Reference node opens with only reference path, not current pane stack", () => {
  // Create a ref ID: context is [contextNode], target is targetNode
  const contextNode = "context123" as ID;
  const targetNode = "target456" as ID;
  const refId = createRefId(List([contextNode]), targetNode);

  // ViewPath with the ref ID as the current node
  const viewPath: ViewPath = [
    0,
    { nodeID: ROOT, nodeIndex: 0 as NodeIndex, relationsID: "" },
    {
      nodeID: "someParent" as LongID,
      nodeIndex: 0 as NodeIndex,
      relationsID: "",
    },
    { nodeID: refId, nodeIndex: 0 as NodeIndex },
  ];

  renderApis(
    <ViewContext.Provider value={viewPath}>
      <OpenInSplitPaneButton />
      <PaneCountDisplay />
      <NewPaneStackDisplay />
    </ViewContext.Provider>
  );

  fireEvent.click(screen.getByLabelText("open in split pane"));

  // The new pane should only have the reference path [contextNode, targetNode]
  // NOT the current pane's stack
  const newPaneStack = JSON.parse(
    screen.getByTestId("new-pane-stack").textContent || "[]"
  );
  expect(newPaneStack).toEqual([contextNode, targetNode]);
});
