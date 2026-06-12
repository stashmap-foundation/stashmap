import React from "react";
import {
  useIsRoot,
  useIsInSearchView,
  useIsViewingOtherUserContent,
  useCurrentRowID,
  useCurrentNode,
  useRow,
} from "../rowModel";
import { isEmptySemanticID } from "../core/connections";
import { useCurrentPane } from "../SplitPanesContext";
import { RelevanceSelector } from "./RelevanceSelector";
import { EvidenceSelector } from "./EvidenceSelector";
import { FullscreenButton } from "./FullscreenButton";
import { OpenInSplitPaneButton } from "./OpenInSplitPaneButton";

export function RightMenu(): JSX.Element {
  const { virtualType } = useRow();
  const isVirtualItem =
    virtualType === "suggestion" ||
    virtualType === "incoming" ||
    virtualType === "version";
  const isRoot = useIsRoot();
  const pane = useCurrentPane();
  const currentNode = useCurrentNode();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const isInSearchView = useIsInSearchView();
  const [rowID] = useCurrentRowID();
  const isDocumentTopLevel =
    isRoot && pane.documentId !== undefined && !isVirtualItem && !!currentNode;

  const isReadonly =
    (isRoot && !isDocumentTopLevel) ||
    isInSearchView ||
    (isViewingOtherUserContent && !isVirtualItem);

  return (
    <div className="right-menu">
      <div className="relevance-slot">
        {!isReadonly && <RelevanceSelector virtualType={virtualType} />}
      </div>
      <div className="evidence-slot">
        {!isReadonly && virtualType !== "suggestion" && <EvidenceSelector />}
      </div>
      {!isEmptySemanticID(rowID) && (
        <div className="action-slot">
          <FullscreenButton />
          <OpenInSplitPaneButton />
        </div>
      )}
    </div>
  );
}
