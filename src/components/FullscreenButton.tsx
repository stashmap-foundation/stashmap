import React from "react";
import { useNodeID, useViewPath, useDisplayText } from "../ViewContext";
import {
  useSplitPanes,
  useCurrentPane,
  usePaneStack,
} from "../SplitPanesContext";
import { getRefTargetInfo } from "../connections";
import { useData } from "../DataContext";

export function FullscreenButton(): JSX.Element | null {
  const { setPane } = useSplitPanes();
  const pane = useCurrentPane();
  const stack = usePaneStack();
  const viewPath = useViewPath();
  const [nodeID] = useNodeID();
  const { knowledgeDBs, user } = useData();
  const displayText = useDisplayText();
  const isFullscreenNode = viewPath.length === 2;
  if (isFullscreenNode) {
    return null;
  }

  const onClick = (): void => {
    const refInfo = getRefTargetInfo(nodeID, knowledgeDBs, user.publicKey);
    if (refInfo) {
      setPane({
        ...pane,
        stack: refInfo.stack,
        author: refInfo.author,
        rootRelation: refInfo.rootRelation,
      });
      return;
    }

    const stackedWorkspaces = stack.slice(0, -1);
    const viewPathNodeIDs = viewPath
      .slice(1)
      .map((subPath) => (subPath as { nodeID: LongID | ID }).nodeID);
    setPane({
      ...pane,
      stack: [...stackedWorkspaces, ...viewPathNodeIDs],
      rootRelation: undefined,
    });
  };

  const ariaLabel = displayText
    ? `open ${displayText} in fullscreen`
    : "open fullscreen";

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className="btn btn-borderless p-0"
      onClick={onClick}
      title="Open in fullscreen"
    >
      <span aria-hidden="true">↗</span>
    </button>
  );
}
