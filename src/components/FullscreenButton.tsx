import React from "react";
import { useIsAddToNode, useNodeID } from "../ViewContext";
import { usePaneNavigation } from "../SplitPanesContext";

export function FullscreenButton(): JSX.Element | null {
  const { push } = usePaneNavigation();
  const [nodeID] = useNodeID();
  const isAddToNode = useIsAddToNode();
  if (isAddToNode) {
    return null;
  }

  const onClick = (): void => {
    push(nodeID);
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
