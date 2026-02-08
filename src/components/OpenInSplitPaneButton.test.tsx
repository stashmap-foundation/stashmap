import React from "react";
import { List } from "immutable";
import { act, screen, fireEvent } from "@testing-library/react";
import { useSplitPanes } from "../SplitPanesContext";
import { ViewContext, ViewPath, NodeIndex } from "../ViewContext";
import {
  OpenInSplitPaneButton,
  OpenInSplitPaneButtonWithStack,
} from "./OpenInSplitPaneButton";
import { renderWithTestData } from "../utils.test";
import { createAbstractRefId } from "../connections";

const TEST_ROOT = "testRoot" as LongID;

function PaneCountDisplay(): JSX.Element {
  const { panes } = useSplitPanes();
  return <div data-testid="pane-count">{panes.length}</div>;
}

function NewPaneStackDisplay(): JSX.Element {
  const { panes } = useSplitPanes();
  const newPaneStack = panes[1]?.stack || [];
  return <div data-testid="new-pane-stack">{JSON.stringify(newPaneStack)}</div>;
}

function renderWithContext(viewPath: ViewPath): void {
  renderWithTestData(
    <ViewContext.Provider value={viewPath}>
      <OpenInSplitPaneButton />
      <PaneCountDisplay />
    </ViewContext.Provider>
  );
}

test("button renders on desktop", async () => {
  const viewPath: ViewPath = [
    0,
    { nodeID: TEST_ROOT, nodeIndex: 0 as NodeIndex },
  ];

  renderWithContext(viewPath);

  expect(await screen.findByLabelText("open in split pane")).toBeTruthy();
});

test("clicking button calls addPaneAt and creates new pane", async () => {
  const viewPath: ViewPath = [
    0,
    { nodeID: TEST_ROOT, nodeIndex: 0 as NodeIndex, relationsID: "" },
    { nodeID: "node1" as LongID, nodeIndex: 0 as NodeIndex },
  ];

  renderWithContext(viewPath);

  await screen.findByTestId("pane-count");
  expect(screen.getByTestId("pane-count").textContent).toBe("1");

  await act(async () =>
    fireEvent.click(screen.getByLabelText("open in split pane"))
  );

  expect(screen.getByTestId("pane-count").textContent).toBe("2");
});

test("OpenInSplitPaneButtonWithStack passes provided stack to addPaneAt", async () => {
  const stack = [TEST_ROOT, "node1" as LongID, "node2" as LongID];

  renderWithTestData(
    <>
      <OpenInSplitPaneButtonWithStack stack={stack} />
      <PaneCountDisplay />
    </>
  );

  await screen.findByTestId("pane-count");
  expect(screen.getByTestId("pane-count").textContent).toBe("1");

  await act(async () =>
    fireEvent.click(screen.getByLabelText("open in split pane"))
  );

  expect(screen.getByTestId("pane-count").textContent).toBe("2");
});

test("Reference node opens with only reference path, not current pane stack", async () => {
  const contextNode = "context123" as ID;
  const targetNode = "target456" as ID;
  const refId = createAbstractRefId(List([contextNode]), targetNode);

  const viewPath: ViewPath = [
    0,
    { nodeID: TEST_ROOT, nodeIndex: 0 as NodeIndex, relationsID: "" },
    {
      nodeID: "someParent" as LongID,
      nodeIndex: 0 as NodeIndex,
      relationsID: "",
    },
    { nodeID: refId, nodeIndex: 0 as NodeIndex },
  ];

  renderWithTestData(
    <ViewContext.Provider value={viewPath}>
      <OpenInSplitPaneButton />
      <PaneCountDisplay />
      <NewPaneStackDisplay />
    </ViewContext.Provider>
  );

  await screen.findByTestId("pane-count");
  await act(async () =>
    fireEvent.click(screen.getByLabelText("open in split pane"))
  );

  const newPaneStack = JSON.parse(
    screen.getByTestId("new-pane-stack").textContent || "[]"
  );
  expect(newPaneStack).toEqual([contextNode, targetNode]);
});

test("OpenInSplitPaneButtonWithStack click does not bubble to parent onClick", async () => {
  const stack = [TEST_ROOT, "node1" as LongID];
  const parentClickHandler = jest.fn();

  renderWithTestData(
    <div onClick={parentClickHandler} role="presentation">
      <span onClick={(e) => e.stopPropagation()} role="presentation">
        <OpenInSplitPaneButtonWithStack stack={stack} />
      </span>
      <PaneCountDisplay />
    </div>
  );

  await screen.findByTestId("pane-count");
  await act(async () =>
    fireEvent.click(screen.getByLabelText("open in split pane"))
  );

  expect(screen.getByTestId("pane-count").textContent).toBe("2");
  expect(parentClickHandler).not.toHaveBeenCalled();
});
