import React from "react";
import { useIsAddToNode, useViewPath } from "../ViewContext";
import { usePaneNavigation } from "../SplitPanesContext";

export function FullscreenButton(): JSX.Element | null {
  const { stack, setStack } = usePaneNavigation();
  const viewPath = useViewPath();
  const isAddToNode = useIsAddToNode();
  if (isAddToNode) {
    return null;
  }

  const onClick = (): void => {
    // Set the full path: stacked workspaces + viewPath node IDs.
    // stack.slice(0, -1) = workspaces before current one
    // viewPath[0] is pane index, slice(1) gives all tree path entries
    const stackedWorkspaces = stack.slice(0, -1);
    const viewPathNodeIDs = viewPath
      .slice(1)
      .map((subPath) => (subPath as { nodeID: LongID | ID }).nodeID);
    setStack([...stackedWorkspaces, ...viewPathNodeIDs]);
  };

  return (
    <button
      type="button"
      aria-label="open fullscreen"
      className="btn btn-borderless p-0"
      onClick={onClick}
      title="Open in fullscreen"
    >
      <span className="iconsminds-duplicate-layer" />
    </button>
  );
}
