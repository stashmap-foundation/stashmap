import React from "react";
import {
  useNodeID,
  useViewPath,
  useDisplayText,
  useEffectiveAuthor,
  useRelation,
} from "../ViewContext";
import {
  usePaneStack,
  useCurrentPane,
  useNavigatePane,
} from "../SplitPanesContext";
import { getRefTargetInfo } from "../connections";
import { useData } from "../DataContext";
import { buildNodeUrl, buildRelationUrl } from "../navigationUrl";

export function FullscreenButton(): JSX.Element | null {
  const stack = usePaneStack();
  const pane = useCurrentPane();
  const viewPath = useViewPath();
  const [nodeID] = useNodeID();
  const { knowledgeDBs, user } = useData();
  const displayText = useDisplayText();
  const navigatePane = useNavigatePane();
  const effectiveAuthor = useEffectiveAuthor();
  const relation = useRelation();
  const isFullscreenNode = viewPath.length === 2;
  if (isFullscreenNode) {
    return null;
  }

  const refInfo = getRefTargetInfo(nodeID, knowledgeDBs, effectiveAuthor);

  const getTargetUrl = (): string => {
    if (refInfo?.rootRelation) {
      return buildRelationUrl(refInfo.rootRelation);
    }
    if (relation) {
      return buildRelationUrl(relation.id);
    }
    const targetStack = refInfo
      ? refInfo.stack
      : [
          ...stack.slice(0, -1),
          ...viewPath
            .slice(1)
            .map((subPath) => (subPath as { nodeID: LongID | ID }).nodeID),
        ];
    return (
      buildNodeUrl(targetStack, knowledgeDBs, user.publicKey, pane.author) ||
      "#"
    );
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
