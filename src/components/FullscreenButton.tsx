import React from "react";
import {
  useNodeID,
  useViewPath,
  useDisplayText,
  useEffectiveAuthor,
  useCurrentRelation,
  getContext,
  getNodeIDsForViewPath,
} from "../ViewContext";
import {
  usePaneStack,
  useCurrentPane,
  useNavigatePane,
} from "../SplitPanesContext";
import { getRefTargetInfo, isSearchId, shortID } from "../connections";
import { useData } from "../DataContext";
import { buildNodeUrl, buildRelationUrl } from "../navigationUrl";
import { getAlternativeRelations } from "../footerSemantics";

export function FullscreenButton(): JSX.Element | null {
  const stack = usePaneStack();
  const pane = useCurrentPane();
  const viewPath = useViewPath();
  const [nodeID] = useNodeID();
  const data = useData();
  const { knowledgeDBs, user } = data;
  const displayText = useDisplayText();
  const navigatePane = useNavigatePane();
  const effectiveAuthor = useEffectiveAuthor();
  const relation = useCurrentRelation();
  const context = getContext(data, viewPath, stack);
  const isFullscreenNode = viewPath.length === 2;
  if (isFullscreenNode) {
    return null;
  }

  const refInfo = getRefTargetInfo(nodeID, knowledgeDBs, effectiveAuthor);
  const standaloneRelation = getAlternativeRelations(
    knowledgeDBs,
    nodeID,
    context,
    relation?.id,
    effectiveAuthor,
    relation?.root
  )
    .filter(
      (candidate) =>
        candidate.author === effectiveAuthor &&
        candidate.root === shortID(candidate.id)
    )
    .sortBy((candidate) => -candidate.updated)
    .first();
  const fullscreenRelation = standaloneRelation || relation;

  const getTargetUrl = (): string => {
    if (refInfo?.rootRelation) {
      return buildRelationUrl(refInfo.rootRelation, refInfo.scrollTo);
    }
    if (fullscreenRelation) {
      return buildRelationUrl(fullscreenRelation.id);
    }
    const targetStack = (
      refInfo
        ? refInfo.stack
        : [...stack.slice(0, -1), ...getNodeIDsForViewPath(data, viewPath)]
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
