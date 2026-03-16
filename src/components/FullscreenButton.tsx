import React from "react";
import {
  useCurrentRowID,
  useViewPath,
  useDisplayText,
  useEffectiveAuthor,
  useCurrentNode,
  getCurrentReferenceForView,
  useCurrentEdge,
} from "../ViewContext";
import { usePaneStack, useNavigatePane } from "../SplitPanesContext";
import {
  getRefLinkTargetInfo,
  getRefTargetInfo,
  isRefNode,
} from "../connections";
import { useData } from "../DataContext";
import { buildNodeRouteUrl } from "../navigationUrl";

export function FullscreenButton(): JSX.Element | null {
  const stack = usePaneStack();
  const viewPath = useViewPath();
  const [rowID] = useCurrentRowID();
  const data = useData();
  const { knowledgeDBs } = data;
  const displayText = useDisplayText();
  const navigatePane = useNavigatePane();
  const effectiveAuthor = useEffectiveAuthor();
  const node = useCurrentNode();
  const currentRow = useCurrentEdge();
  const virtualType = currentRow?.virtualType;
  const currentReference = getCurrentReferenceForView(
    data,
    viewPath,
    stack,
    virtualType,
    currentRow
  );
  const isFullscreenNode = viewPath.length === 2;
  if (isFullscreenNode) {
    return null;
  }

  const refInfo = (() => {
    if (!currentReference) {
      if (isRefNode(node)) {
        return getRefLinkTargetInfo(node.id, knowledgeDBs, effectiveAuthor);
      }
      return getRefTargetInfo(rowID, knowledgeDBs, effectiveAuthor);
    }
    return virtualType === "version"
      ? getRefTargetInfo(currentReference.id, knowledgeDBs, effectiveAuthor)
      : getRefLinkTargetInfo(
          currentReference.id,
          knowledgeDBs,
          effectiveAuthor
        );
  })();
  const fullscreenNode = node;

  const href = (() => {
    if (refInfo?.rootNodeId) {
      return buildNodeRouteUrl(refInfo.rootNodeId, refInfo.scrollToId);
    }
    if (fullscreenNode) {
      return buildNodeRouteUrl(fullscreenNode.id);
    }
    return undefined;
  })();

  if (!href) {
    return null;
  }

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
      <span aria-hidden="true">↖</span>
    </a>
  );
}
