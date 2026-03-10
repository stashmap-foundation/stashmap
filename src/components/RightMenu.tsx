import React from "react";
import {
  useCurrentEdge,
  useIsRoot,
  useIsInSearchView,
  useIsViewingOtherUserContent,
  useCurrentRowID,
} from "../ViewContext";
import { isEmptySemanticID } from "../connections";
import { RelevanceSelector } from "./RelevanceSelector";
import { EvidenceSelector } from "./EvidenceSelector";
import { FullscreenButton } from "./FullscreenButton";
import { OpenInSplitPaneButton } from "./OpenInSplitPaneButton";

export function RightMenu(): JSX.Element {
  const virtualType = useCurrentEdge()?.virtualType;
  const isVirtualItem =
    virtualType === "suggestion" ||
    virtualType === "incoming" ||
    virtualType === "occurrence" ||
    virtualType === "version";
  const isRoot = useIsRoot();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const isInSearchView = useIsInSearchView();
  const [itemID] = useCurrentRowID();

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
      {!isEmptySemanticID(itemID) && (
        <div className="action-slot">
          <FullscreenButton />
          <OpenInSplitPaneButton />
        </div>
      )}
    </div>
  );
}
