import React from "react";
import { List } from "immutable";
import { screen, fireEvent } from "@testing-library/react";
import { usePaneStack } from "../SplitPanesContext";
import { ViewContext, ViewPath, NodeIndex } from "../ViewContext";
import { FullscreenButton } from "./FullscreenButton";
import { ROOT } from "../types";
import { renderWithTestData } from "../utils.test";
import { createAbstractRefId } from "../connections";

function CurrentStackDisplay(): JSX.Element {
  const stack = usePaneStack();
  return <div data-testid="current-stack">{JSON.stringify(stack)}</div>;
}

test("Reference node opens with only reference path, not current pane stack", async () => {
  const contextNode = "context123" as ID;
  const targetNode = "target456" as ID;
  const refId = createAbstractRefId(List([contextNode]), targetNode);

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

  renderWithTestData(
    <ViewContext.Provider value={viewPath}>
      <FullscreenButton />
      <CurrentStackDisplay />
    </ViewContext.Provider>
  );

  await screen.findByTestId("current-stack");
  fireEvent.click(
    screen.getByLabelText("open Loading... → Loading... in fullscreen")
  );

  const currentStack = JSON.parse(
    screen.getByTestId("current-stack").textContent || "[]"
  );
  expect(currentStack).toEqual([contextNode, targetNode]);
});
