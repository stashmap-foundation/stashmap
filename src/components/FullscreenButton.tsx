import React from "react";
import { useNodeID, useViewPath, useDisplayText } from "../ViewContext";
import { usePaneStack, useNavigatePane } from "../SplitPanesContext";
import { getRefTargetInfo } from "../connections";
import { useData } from "../DataContext";
import { stackToPath, buildRelationUrl } from "../navigationUrl";

export function FullscreenButton(): JSX.Element | null {
  const stack = usePaneStack();
  const viewPath = useViewPath();
  const [nodeID] = useNodeID();
  const { knowledgeDBs, user } = useData();
  const displayText = useDisplayText();
  const navigatePane = useNavigatePane();
  const isFullscreenNode = viewPath.length === 2;
  if (isFullscreenNode) {
    return null;
  }

  const refInfo = getRefTargetInfo(nodeID, knowledgeDBs, user.publicKey);

  const getTargetUrl = (): string => {
    if (refInfo?.rootRelation) {
      return buildRelationUrl(refInfo.rootRelation);
    }
    const targetStack = refInfo
      ? refInfo.stack
      : [
          ...stack.slice(0, -1),
          ...viewPath
            .slice(1)
            .map((subPath) => (subPath as { nodeID: LongID | ID }).nodeID),
        ];
    return stackToPath(targetStack, knowledgeDBs, user.publicKey) || "#";
  };

  const href = getTargetUrl();

  const ariaLabel = displayText
    ? `open ${displayText} in fullscreen`
    : "open fullscreen";

  return (
    <a
      href={href}
      data-node-action="open-fullscreen"
      aria-label={ariaLabel}
      className="btn btn-icon"
      onClick={(e) => {
        e.preventDefault();
        navigatePane(href);
      }}
      title="Open in fullscreen"
    >
      <span aria-hidden="true">↗</span>
    </a>
  );
}
