import React from "react";
import {
  useRelationItem,
  useIsRoot,
  useIsInSearchView,
  useIsViewingOtherUserContent,
  useNodeID,
} from "../ViewContext";
import { isEmptyNodeID } from "../connections";
import { RelevanceSelector } from "./RelevanceSelector";
import { EvidenceSelector } from "./EvidenceSelector";
import { FullscreenButton } from "./FullscreenButton";
import { OpenInSplitPaneButton } from "./OpenInSplitPaneButton";

export function RightMenu(): JSX.Element {
  const virtualType = useRelationItem()?.virtualType;
  const isVirtualItem =
    virtualType === "suggestion" ||
    virtualType === "incoming" ||
    virtualType === "occurrence" ||
    virtualType === "version";
  const isRoot = useIsRoot();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const isInSearchView = useIsInSearchView();
  const [nodeID] = useNodeID();

  const isReadonly =
    isRoot || isInSearchView || (isViewingOtherUserContent && !isVirtualItem);

  return (
    <div className="right-menu">
      <div className="relevance-slot">
        {!isReadonly && <RelevanceSelector virtualType={virtualType} />}
      </div>
      <div className="evidence-slot">
        {!isReadonly && virtualType !== "suggestion" && <EvidenceSelector />}
      </div>
      {!isEmptyNodeID(nodeID) && (
        <div className="action-slot">
          <FullscreenButton />
          <OpenInSplitPaneButton />
        </div>
      )}
    </div>
  );
}
