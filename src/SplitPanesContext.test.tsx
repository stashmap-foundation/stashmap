import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  SplitPanesProvider,
  useSplitPanes,
  PaneIndexProvider,
  usePaneIndex,
  PaneNavigationProvider,
  usePaneNavigation,
} from "./SplitPanesContext";
import { ROOT } from "./types";

function TestSplitPanes(): JSX.Element {
  const { panes, addPane, addPaneAt, removePane } = useSplitPanes();
  return (
    <div>
      <div data-testid="pane-count">{panes.length}</div>
      <div data-testid="pane-ids">{panes.map((p) => p.id).join(",")}</div>
      <button type="button" onClick={addPane}>
        Add Pane
      </button>
      <button
        type="button"
        onClick={() => addPaneAt(1, ["node1" as LongID, "node2" as LongID])}
      >
        Add Pane At 1
      </button>
      <button type="button" onClick={() => removePane(panes[1]?.id)}>
        Remove Pane 1
      </button>
      <button type="button" onClick={() => removePane(panes[0]?.id)}>
        Remove First Pane
      </button>
    </div>
  );
}

test("addPane adds a new pane to the end", () => {
  render(
    <SplitPanesProvider>
      <TestSplitPanes />
    </SplitPanesProvider>
  );

  expect(screen.getByTestId("pane-count").textContent).toBe("1");

  fireEvent.click(screen.getByText("Add Pane"));
  expect(screen.getByTestId("pane-count").textContent).toBe("2");

  fireEvent.click(screen.getByText("Add Pane"));
  expect(screen.getByTestId("pane-count").textContent).toBe("3");
});

test("addPaneAt inserts pane at specific index with initialStack", () => {
  render(
    <SplitPanesProvider>
      <TestSplitPanes />
    </SplitPanesProvider>
  );

  fireEvent.click(screen.getByText("Add Pane"));
  expect(screen.getByTestId("pane-count").textContent).toBe("2");

  const paneIdsBefore = screen.getByTestId("pane-ids").textContent?.split(",");

  fireEvent.click(screen.getByText("Add Pane At 1"));
  expect(screen.getByTestId("pane-count").textContent).toBe("3");

  const paneIdsAfter = screen.getByTestId("pane-ids").textContent?.split(",");
  expect(paneIdsAfter?.[0]).toBe(paneIdsBefore?.[0]);
  expect(paneIdsAfter?.[2]).toBe(paneIdsBefore?.[1]);
  expect(paneIdsAfter?.[1]).not.toBe(paneIdsBefore?.[0]);
  expect(paneIdsAfter?.[1]).not.toBe(paneIdsBefore?.[1]);
});

test("removePane removes pane by id", () => {
  render(
    <SplitPanesProvider>
      <TestSplitPanes />
    </SplitPanesProvider>
  );

  fireEvent.click(screen.getByText("Add Pane"));
  fireEvent.click(screen.getByText("Add Pane"));
  expect(screen.getByTestId("pane-count").textContent).toBe("3");

  const paneIdsBefore = screen.getByTestId("pane-ids").textContent?.split(",");

  fireEvent.click(screen.getByText("Remove Pane 1"));
  expect(screen.getByTestId("pane-count").textContent).toBe("2");

  const paneIdsAfter = screen.getByTestId("pane-ids").textContent?.split(",");
  expect(paneIdsAfter?.[0]).toBe(paneIdsBefore?.[0]);
  expect(paneIdsAfter?.[1]).toBe(paneIdsBefore?.[2]);
});

test("removePane does not remove the last pane", () => {
  render(
    <SplitPanesProvider>
      <TestSplitPanes />
    </SplitPanesProvider>
  );

  expect(screen.getByTestId("pane-count").textContent).toBe("1");

  fireEvent.click(screen.getByText("Remove First Pane"));
  expect(screen.getByTestId("pane-count").textContent).toBe("1");
});

function TestPaneIndexInner(): JSX.Element {
  const paneIndex = usePaneIndex();
  return <div data-testid="pane-index">{paneIndex}</div>;
}

test("usePaneIndex returns correct index", () => {
  render(
    <SplitPanesProvider>
      <PaneIndexProvider index={0}>
        <TestPaneIndexInner />
      </PaneIndexProvider>
    </SplitPanesProvider>
  );
  expect(screen.getByTestId("pane-index").textContent).toBe("0");
});

test("usePaneIndex returns correct index for different panes", () => {
  render(
    <SplitPanesProvider>
      <PaneIndexProvider index={5}>
        <TestPaneIndexInner />
      </PaneIndexProvider>
    </SplitPanesProvider>
  );
  expect(screen.getByTestId("pane-index").textContent).toBe("5");
});

function TestPaneNavigation(): JSX.Element {
  const { stack, activeWorkspace, popTo, setStack } = usePaneNavigation();
  return (
    <div>
      <div data-testid="stack">{stack.join(",")}</div>
      <div data-testid="active-workspace">{activeWorkspace}</div>
      <button type="button" onClick={() => popTo(stack.length - 2)}>
        Pop
      </button>
      <button type="button" onClick={() => popTo(0)}>
        Pop To 0
      </button>
      <button
        type="button"
        onClick={() =>
          setStack(["new1" as LongID, "new2" as LongID, "new3" as LongID])
        }
      >
        Set Stack
      </button>
    </div>
  );
}

test("popTo(length-2) removes last item and updates activeWorkspace", () => {
  render(
    <SplitPanesProvider>
      <PaneIndexProvider index={0}>
        <PaneNavigationProvider initialWorkspace={ROOT}>
          <TestPaneNavigation />
        </PaneNavigationProvider>
      </PaneIndexProvider>
    </SplitPanesProvider>
  );

  fireEvent.click(screen.getByText("Set Stack"));
  expect(screen.getByTestId("stack").textContent).toBe("new1,new2,new3");

  fireEvent.click(screen.getByText("Pop"));
  expect(screen.getByTestId("stack").textContent).toBe("new1,new2");
  expect(screen.getByTestId("active-workspace").textContent).toBe("new2");
});

test("popTo with invalid index does not change stack", () => {
  render(
    <SplitPanesProvider>
      <PaneIndexProvider index={0}>
        <PaneNavigationProvider initialWorkspace={ROOT}>
          <TestPaneNavigation />
        </PaneNavigationProvider>
      </PaneIndexProvider>
    </SplitPanesProvider>
  );

  expect(screen.getByTestId("stack").textContent).toBe(ROOT);

  fireEvent.click(screen.getByText("Pop"));
  expect(screen.getByTestId("stack").textContent).toBe(ROOT);
  expect(screen.getByTestId("active-workspace").textContent).toBe(ROOT);
});

test("popTo navigates to specific stack index", () => {
  render(
    <SplitPanesProvider>
      <PaneIndexProvider index={0}>
        <PaneNavigationProvider initialWorkspace={ROOT}>
          <TestPaneNavigation />
        </PaneNavigationProvider>
      </PaneIndexProvider>
    </SplitPanesProvider>
  );

  fireEvent.click(screen.getByText("Set Stack"));
  expect(screen.getByTestId("stack").textContent).toBe("new1,new2,new3");

  fireEvent.click(screen.getByText("Pop To 0"));
  expect(screen.getByTestId("stack").textContent).toBe("new1");
  expect(screen.getByTestId("active-workspace").textContent).toBe("new1");
});

test("setStack replaces entire stack with new path", () => {
  render(
    <SplitPanesProvider>
      <PaneIndexProvider index={0}>
        <PaneNavigationProvider initialWorkspace={ROOT}>
          <TestPaneNavigation />
        </PaneNavigationProvider>
      </PaneIndexProvider>
    </SplitPanesProvider>
  );

  expect(screen.getByTestId("stack").textContent).toBe(ROOT);

  fireEvent.click(screen.getByText("Set Stack"));
  expect(screen.getByTestId("stack").textContent).toBe("new1,new2,new3");
  expect(screen.getByTestId("active-workspace").textContent).toBe("new3");
});

test("initialStack sets initial stack and activeWorkspace", () => {
  const initialStack = [
    "node1" as LongID,
    "node2" as LongID,
    "node3" as LongID,
  ];

  render(
    <SplitPanesProvider>
      <PaneIndexProvider index={0}>
        <PaneNavigationProvider
          initialWorkspace={ROOT}
          initialStack={initialStack}
        >
          <TestPaneNavigation />
        </PaneNavigationProvider>
      </PaneIndexProvider>
    </SplitPanesProvider>
  );

  expect(screen.getByTestId("stack").textContent).toBe("node1,node2,node3");
  expect(screen.getByTestId("active-workspace").textContent).toBe("node3");
});
