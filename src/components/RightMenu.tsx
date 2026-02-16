import React from "react";
import {
  useRelationItem,
  useIsRoot,
  useIsInSearchView,
  useIsViewingOtherUserContent,
} from "../ViewContext";
import { RelevanceSelector } from "./RelevanceSelector";
import { EvidenceSelector } from "./EvidenceSelector";

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
    </div>
  );
}
