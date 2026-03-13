import React from "react";
import {
  useCurrentRowID,
  useViewPath,
  useDisplayText,
  useEffectiveAuthor,
  useCurrentRelation,
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
import { buildRelationUrl } from "../navigationUrl";

export function FullscreenButton(): JSX.Element | null {
  const stack = usePaneStack();
  const viewPath = useViewPath();
  const [itemID] = useCurrentRowID();
  const data = useData();
  const { knowledgeDBs } = data;
  const displayText = useDisplayText();
  const navigatePane = useNavigatePane();
  const effectiveAuthor = useEffectiveAuthor();
  const relation = useCurrentRelation();
  const currentItem = useCurrentEdge();
  const virtualType = currentItem?.virtualType;
  const currentReference = getCurrentReferenceForView(
    data,
    viewPath,
    stack,
    virtualType,
    currentItem
  );
  const isFullscreenNode = viewPath.length === 2;
  if (isFullscreenNode) {
    return null;
  }

  const refInfo = (() => {
    if (!currentReference) {
      if (isRefNode(relation)) {
        return getRefLinkTargetInfo(relation.id, knowledgeDBs, effectiveAuthor);
      }
      return getRefTargetInfo(itemID, knowledgeDBs, effectiveAuthor);
    }
    return virtualType === "version"
      ? getRefTargetInfo(currentReference.id, knowledgeDBs, effectiveAuthor)
      : getRefLinkTargetInfo(
          currentReference.id,
          knowledgeDBs,
          effectiveAuthor
        );
  })();
  const fullscreenRelation = relation;

  const href = (() => {
    if (refInfo?.rootRelation) {
      return buildRelationUrl(refInfo.rootRelation, refInfo.scrollToId);
    }
    if (fullscreenRelation) {
      return buildRelationUrl(fullscreenRelation.id);
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
