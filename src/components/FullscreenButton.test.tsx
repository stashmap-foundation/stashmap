import React from "react";
import { List } from "immutable";
import { screen, fireEvent } from "@testing-library/react";
import { usePaneNavigation } from "../SplitPanesContext";
import { ViewContext, ViewPath, NodeIndex } from "../ViewContext";
import { FullscreenButton } from "./FullscreenButton";
import { ROOT } from "../types";
import { renderApis } from "../utils.test";
import { createAbstractRefId } from "../connections";

function CurrentStackDisplay(): JSX.Element {
  const { stack } = usePaneNavigation();
  return <div data-testid="current-stack">{JSON.stringify(stack)}</div>;
}

test("Reference node opens with only reference path, not current pane stack", () => {
  // Create a ref ID: context is [contextNode], target is targetNode
  const contextNode = "context123" as ID;
  const targetNode = "target456" as ID;
  const refId = createAbstractRefId(List([contextNode]), targetNode);

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

  // Initial stack has some nodes that should NOT be included in the new stack
  const initialStack = [
    "existingNode1" as LongID,
    "existingNode2" as LongID,
    ROOT,
  ];

  renderApis(
    <ViewContext.Provider value={viewPath}>
      <FullscreenButton />
      <CurrentStackDisplay />
    </ViewContext.Provider>,
    { initialStack }
  );

  // Verify initial stack before clicking
  expect(
    JSON.parse(screen.getByTestId("current-stack").textContent || "[]")
  ).toEqual(initialStack);

  fireEvent.click(screen.getByLabelText("open fullscreen"));

  // The stack should only have the reference path [contextNode, targetNode]
  // NOT the previous stack
  const currentStack = JSON.parse(
    screen.getByTestId("current-stack").textContent || "[]"
  );
  expect(currentStack).toEqual([contextNode, targetNode]);
});
