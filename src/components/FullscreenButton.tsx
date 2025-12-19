import React from "react";
import { useIsAddToNode, useNodeID } from "../ViewContext";
import { useNavigationStack } from "../NavigationStackContext";

export function FullscreenButton(): JSX.Element | null {
  const { push } = useNavigationStack();
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
      <span className="iconsminds-layer-forward" />
    </button>
  );
}
