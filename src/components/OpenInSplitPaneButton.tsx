import React from "react";
import { useMediaQuery } from "react-responsive";
import { useIsAddToNode, useNodeID, useViewPath } from "../ViewContext";
import {
  useSplitPanes,
  usePaneIndex,
  usePaneNavigation,
} from "../SplitPanesContext";
import { IS_MOBILE } from "./responsive";
import { isRefId, parseRefId } from "../connections";

export function OpenInSplitPaneButton(): JSX.Element | null {
  const { addPaneAt } = useSplitPanes();
  const paneIndex = usePaneIndex();
  const { stack } = usePaneNavigation();
  const viewPath = useViewPath();
  const [nodeID] = useNodeID();
  const isAddToNode = useIsAddToNode();
  const isMobile = useMediaQuery(IS_MOBILE);

  if (isAddToNode || isMobile) {
    return null;
  }

  const onClick = (): void => {
    // Build the full path: pane navigation stack (without last element, which is the workspace root)
    // + all node IDs from the ViewPath (skip pane index at position 0)
    const paneStackWithoutWorkspace = stack.slice(0, -1);

    if (isRefId(nodeID)) {
      const parsed = parseRefId(nodeID);
      if (parsed) {
        const targetStack = [
          ...parsed.targetContext.toArray(),
          parsed.targetNode,
        ];
        addPaneAt(paneIndex + 1, [
          ...paneStackWithoutWorkspace,
          ...targetStack,
        ]);
        return;
      }
    }

    // Regular nodes: use viewPath node IDs
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
