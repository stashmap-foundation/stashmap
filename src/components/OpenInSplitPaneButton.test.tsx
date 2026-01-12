import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  SplitPanesProvider,
  PaneIndexProvider,
  PaneNavigationProvider,
  useSplitPanes,
} from "../SplitPanesContext";
import { ViewContext, ADD_TO_NODE, ViewPath, NodeIndex } from "../ViewContext";
import {
  OpenInSplitPaneButton,
  OpenInSplitPaneButtonWithStack,
} from "./OpenInSplitPaneButton";
import { ROOT } from "../types";
import { DataContextProvider } from "../DataContext";
import { setup, ALICE } from "../utils.test";

function PaneCountDisplay(): JSX.Element {
  const { panes } = useSplitPanes();
  return <div data-testid="pane-count">{panes.length}</div>;
}

function renderWithContext(viewPath: ViewPath): void {
  const [alice] = setup([ALICE]);
  render(
    // eslint-disable-next-line react/jsx-props-no-spreading
    <DataContextProvider {...alice()}>
      <SplitPanesProvider>
        <PaneIndexProvider index={0}>
          <PaneNavigationProvider initialWorkspace={ROOT}>
            <ViewContext.Provider value={viewPath}>
              <OpenInSplitPaneButton />
              <PaneCountDisplay />
            </ViewContext.Provider>
          </PaneNavigationProvider>
        </PaneIndexProvider>
      </SplitPanesProvider>
    </DataContextProvider>
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
  const [alice] = setup([ALICE]);

  render(
    // eslint-disable-next-line react/jsx-props-no-spreading
    <DataContextProvider {...alice()}>
      <SplitPanesProvider>
        <PaneIndexProvider index={0}>
          <PaneNavigationProvider initialWorkspace={ROOT}>
            <OpenInSplitPaneButtonWithStack stack={stack} />
            <PaneCountDisplay />
          </PaneNavigationProvider>
        </PaneIndexProvider>
      </SplitPanesProvider>
    </DataContextProvider>
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
