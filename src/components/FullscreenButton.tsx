import React from "react";
import { useIsAddToNode, useNodeID, useViewPath } from "../ViewContext";
import { usePaneNavigation } from "../SplitPanesContext";
import { isRefId, parseRefId } from "../connections";

export function FullscreenButton(): JSX.Element | null {
  const { stack, setStack } = usePaneNavigation();
  const viewPath = useViewPath();
  const [nodeID] = useNodeID();
  const isAddToNode = useIsAddToNode();
  if (isAddToNode) {
    return null;
  }

  const onClick = (): void => {
    const stackedWorkspaces = stack.slice(0, -1);

    if (isRefId(nodeID)) {
      const parsed = parseRefId(nodeID);
      if (parsed) {
        const targetStack = [
          ...parsed.targetContext.toArray(),
          parsed.targetNode,
        ];
        setStack([...stackedWorkspaces, ...targetStack]);
        return;
      }
    }

    // Regular nodes: use viewPath node IDs
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
