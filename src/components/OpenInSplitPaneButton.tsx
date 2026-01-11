import React from "react";
import { useIsAddToNode, useNodeID } from "../ViewContext";
import { useSplitPanes, usePaneIndex } from "../SplitPanesContext";

export function OpenInSplitPaneButton(): JSX.Element | null {
  const { addPaneAt } = useSplitPanes();
  const paneIndex = usePaneIndex();
  const [nodeID] = useNodeID();
  const isAddToNode = useIsAddToNode();

  if (isAddToNode) {
    return null;
  }

  const onClick = (): void => {
    addPaneAt(paneIndex + 1, nodeID);
  };

  return (
    <button
      type="button"
      aria-label="open in split pane"
      className="btn btn-borderless p-0"
      onClick={onClick}
      title="Open in new split pane"
    >
      <span className="iconsminds-left-to-right" />
    </button>
  );
}

// Version that accepts nodeID as prop (for stacked layers)
export function OpenInSplitPaneButtonWithNodeID({
  nodeID,
}: {
  nodeID: LongID | ID;
}): JSX.Element {
  const { addPaneAt } = useSplitPanes();
  const paneIndex = usePaneIndex();

  const onClick = (): void => {
    addPaneAt(paneIndex + 1, nodeID);
  };

  return (
    <button
      type="button"
      aria-label="open in split pane"
      className="btn btn-borderless p-0"
      onClick={onClick}
      title="Open in new split pane"
    >
      <span className="iconsminds-left-to-right" />
    </button>
  );
}
