import React from "react";
import { useMediaQuery } from "react-responsive";
import { useIsAddToNode, useViewPath } from "../ViewContext";
import {
  useSplitPanes,
  usePaneIndex,
  usePaneNavigation,
} from "../SplitPanesContext";
import { IS_MOBILE } from "./responsive";

export function OpenInSplitPaneButton(): JSX.Element | null {
  const { addPaneAt } = useSplitPanes();
  const paneIndex = usePaneIndex();
  const { stack } = usePaneNavigation();
  const viewPath = useViewPath();
  const isAddToNode = useIsAddToNode();
  const isMobile = useMediaQuery(IS_MOBILE);

  if (isAddToNode || isMobile) {
    return null;
  }

  const onClick = (): void => {
    // Build the full path: pane navigation stack (without last element, which is the workspace root)
    // + all node IDs from the ViewPath (skip pane index at position 0)
    const paneStackWithoutWorkspace = stack.slice(0, -1);
    const viewPathNodeIDs = viewPath
      .slice(1)
      .map((subPath) => (subPath as { nodeID: LongID | ID }).nodeID);
    const fullStack = [...paneStackWithoutWorkspace, ...viewPathNodeIDs];
    addPaneAt(paneIndex + 1, fullStack);
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

// Version that accepts a stack as prop (for stacked layers)
export function OpenInSplitPaneButtonWithStack({
  stack,
}: {
  stack: (LongID | ID)[];
}): JSX.Element | null {
  const { addPaneAt } = useSplitPanes();
  const paneIndex = usePaneIndex();
  const isMobile = useMediaQuery(IS_MOBILE);

  if (isMobile) {
    return null;
  }

  const onClick = (): void => {
    addPaneAt(paneIndex + 1, stack);
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
