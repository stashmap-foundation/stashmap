import React from "react";
import {
  useIsRoot,
  useIsInSearchView,
  useIsViewingOtherUserContent,
  useCurrentNode,
  useRow,
} from "../rowModel";
import { isEmptyNodeID } from "../core/connections";
import { LOCAL } from "../core/nodeRef";
import { useCurrentPane } from "../SplitPanesContext";
import { RelevanceSelector } from "./RelevanceSelector";
import { EvidenceSelector } from "./EvidenceSelector";
import { FullscreenButton } from "./FullscreenButton";
import { OpenInSplitPaneButton } from "./OpenInSplitPaneButton";

export function RightMenu(): JSX.Element {
  const row = useRow();
  const { virtualType, sourceId } = row;
  const isVirtualItem = virtualType === "incoming";
  const isRoot = useIsRoot();
  const pane = useCurrentPane();
  const currentNode = useCurrentNode();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const isInSearchView = useIsInSearchView();
  const isDocumentTopLevel =
    isRoot && pane.documentId !== undefined && !isVirtualItem && !!currentNode;

  const isReadonly =
    (isRoot && !isDocumentTopLevel) ||
    isInSearchView ||
    (sourceId !== LOCAL && row.rowType !== "occurrence" && !isVirtualItem) ||
    (isViewingOtherUserContent && !isVirtualItem);

  return (
    <div className="right-menu">
      <div className="relevance-slot">
        {!isReadonly && <RelevanceSelector virtualType={virtualType} />}
      </div>
      <div className="evidence-slot">{!isReadonly && <EvidenceSelector />}</div>
      {!isEmptyNodeID(currentNode.id) && (
        <div className="action-slot">
          <FullscreenButton />
          <OpenInSplitPaneButton />
        </div>
      )}
    </div>
  );
}
