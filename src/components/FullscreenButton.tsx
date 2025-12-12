import React from "react";
import { useNodeID } from "../ViewContext";
import { useNavigationStack } from "../NavigationStackContext";

export function FullscreenButton(): JSX.Element {
  const { push } = useNavigationStack();
  const [nodeID] = useNodeID();

  const onClick = (): void => {
    push(nodeID);
  };

  return (
    <button
      type="button"
      aria-label="open fullscreen"
      className="btn btn-borderless"
      onClick={onClick}
      title="Open in fullscreen"
    >
      <span className="simple-icon-size-fullscreen" />
    </button>
  );
}
