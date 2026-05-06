/* eslint-disable testing-library/no-unnecessary-act, @typescript-eslint/require-await */
import React from "react";
import { act, screen, fireEvent } from "@testing-library/react";
import {
  useSplitPanes,
  PaneIndexProvider,
  usePaneIndex,
  useCurrentPane,
} from "./SplitPanesContext";
import { renderApis, renderWithTestData, ALICE } from "./utils.test";

function TestSplitPanes(): JSX.Element {
  const { panes, addPaneAt, removePane } = useSplitPanes();
  return (
    <div>
      <div data-testid="pane-count">{panes.length}</div>
      <div data-testid="pane-ids">{panes.map((p) => p.id).join(",")}</div>
      <button
        type="button"
        onClick={() => addPaneAt(panes.length, ALICE.publicKey)}
      >
        Add Pane
      </button>
      <button
        type="button"
        onClick={() => addPaneAt(1, ALICE.publicKey, "node2" as LongID)}
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

test("addPaneAt adds a new pane to the end", async () => {
  renderWithTestData(<TestSplitPanes />);

  await screen.findByTestId("pane-count");
  expect(screen.getByTestId("pane-count").textContent).toBe("1");

  await act(async () => fireEvent.click(screen.getByText("Add Pane")));
  expect(screen.getByTestId("pane-count").textContent).toBe("2");

  await act(async () => fireEvent.click(screen.getByText("Add Pane")));
  expect(screen.getByTestId("pane-count").textContent).toBe("3");
});

test("addPaneAt inserts pane at specific index with root node", async () => {
  renderWithTestData(<TestSplitPanes />);

  await screen.findByTestId("pane-count");
  await act(async () => fireEvent.click(screen.getByText("Add Pane")));
  expect(screen.getByTestId("pane-count").textContent).toBe("2");

  const paneIdsBefore = screen.getByTestId("pane-ids").textContent?.split(",");

  await act(async () => fireEvent.click(screen.getByText("Add Pane At 1")));
  expect(screen.getByTestId("pane-count").textContent).toBe("3");

  const paneIdsAfter = screen.getByTestId("pane-ids").textContent?.split(",");
  expect(paneIdsAfter?.[0]).toBe(paneIdsBefore?.[0]);
  expect(paneIdsAfter?.[2]).toBe(paneIdsBefore?.[1]);
  expect(paneIdsAfter?.[1]).not.toBe(paneIdsBefore?.[0]);
  expect(paneIdsAfter?.[1]).not.toBe(paneIdsBefore?.[1]);
});

test("removePane removes pane by id", async () => {
  renderWithTestData(<TestSplitPanes />);

  await screen.findByTestId("pane-count");
  await act(async () => fireEvent.click(screen.getByText("Add Pane")));
  await act(async () => fireEvent.click(screen.getByText("Add Pane")));
  expect(screen.getByTestId("pane-count").textContent).toBe("3");

  const paneIdsBefore = screen.getByTestId("pane-ids").textContent?.split(",");

  await act(async () => fireEvent.click(screen.getByText("Remove Pane 1")));
  expect(screen.getByTestId("pane-count").textContent).toBe("2");

  const paneIdsAfter = screen.getByTestId("pane-ids").textContent?.split(",");
  expect(paneIdsAfter?.[0]).toBe(paneIdsBefore?.[0]);
  expect(paneIdsAfter?.[1]).toBe(paneIdsBefore?.[2]);
});

test("removePane does not remove the last pane", async () => {
  renderWithTestData(<TestSplitPanes />);

  await screen.findByTestId("pane-count");
  expect(screen.getByTestId("pane-count").textContent).toBe("1");

  await act(async () => fireEvent.click(screen.getByText("Remove First Pane")));
  expect(screen.getByTestId("pane-count").textContent).toBe("1");
});

function TestPaneIndexInner(): JSX.Element {
  const paneIndex = usePaneIndex();
  return <div data-testid="pane-index">{paneIndex}</div>;
}

test("usePaneIndex returns correct index", () => {
  renderApis(
    <PaneIndexProvider index={0}>
      <TestPaneIndexInner />
    </PaneIndexProvider>
  );
  expect(screen.getByTestId("pane-index").textContent).toBe("0");
});

test("usePaneIndex returns correct index for different panes", () => {
  renderApis(
    <PaneIndexProvider index={5}>
      <TestPaneIndexInner />
    </PaneIndexProvider>
  );
  expect(screen.getByTestId("pane-index").textContent).toBe("5");
});

function TestPaneNavigation(): JSX.Element {
  const { setPane } = useSplitPanes();
  const pane = useCurrentPane();
  const rootItemID = pane.rootNodeId || "";

  const setRoot = (rootNodeId?: LongID): void => {
    setPane({ ...pane, rootNodeId });
  };

  return (
    <div>
      <div data-testid="root-node-id">{rootItemID}</div>
      <div data-testid="root-item-id">{rootItemID}</div>
      <button type="button" onClick={() => setRoot(undefined)}>
        Clear Root
      </button>
      <button type="button" onClick={() => setRoot("new3" as LongID)}>
        Set Root
      </button>
    </div>
  );
}

test("setPane sets root node id", async () => {
  renderWithTestData(<TestPaneNavigation />);

  await screen.findByTestId("root-node-id");
  expect(screen.getByTestId("root-node-id").textContent).toBe("");
  await act(async () => fireEvent.click(screen.getByText("Set Root")));
  expect(screen.getByTestId("root-node-id").textContent).toBe("new3");
  expect(screen.getByTestId("root-item-id").textContent).toBe("new3");
});
