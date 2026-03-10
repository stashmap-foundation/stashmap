import React from "react";
import {
  useCurrentRowID,
  useViewPath,
  useDisplayText,
  useEffectiveAuthor,
  useCurrentRelation,
  getRowIDsForViewPath,
  getCurrentReferenceForView,
  useCurrentEdge,
} from "../ViewContext";
import {
  usePaneStack,
  useCurrentPane,
  useNavigatePane,
} from "../SplitPanesContext";
import {
  getRefLinkTargetInfo,
  getRefTargetInfo,
  isSearchId,
} from "../connections";
import { useData } from "../DataContext";
import { buildNodeUrl, buildRelationUrl } from "../navigationUrl";

export function FullscreenButton(): JSX.Element | null {
  const stack = usePaneStack();
  const pane = useCurrentPane();
  const viewPath = useViewPath();
  const [itemID] = useCurrentRowID();
  const data = useData();
  const { knowledgeDBs, user } = data;
  const displayText = useDisplayText();
  const navigatePane = useNavigatePane();
  const effectiveAuthor = useEffectiveAuthor();
  const relation = useCurrentRelation();
  const virtualType = useCurrentEdge()?.virtualType;
  const currentReference = getCurrentReferenceForView(
    data,
    viewPath,
    stack,
    virtualType
  );
  const isFullscreenNode = viewPath.length === 2;
  if (isFullscreenNode) {
    return null;
  }

  const refInfo = (() => {
    if (!currentReference) {
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

  const getTargetUrl = (): string => {
    if (refInfo?.rootRelation) {
      return buildRelationUrl(refInfo.rootRelation, refInfo.scrollToId);
    }
    if (fullscreenRelation) {
      return buildRelationUrl(fullscreenRelation.id);
    }
    const targetStack = (
      refInfo
        ? refInfo.stack
        : [...stack.slice(0, -1), ...getRowIDsForViewPath(data, viewPath)]
    ).filter((id) => !isSearchId(id as ID));
    return (
      buildNodeUrl(
        targetStack,
        knowledgeDBs,
        user.publicKey,
        refInfo?.author || pane.author
      ) || "#"
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
      <span aria-hidden="true">↖</span>
    </a>
  );
}
