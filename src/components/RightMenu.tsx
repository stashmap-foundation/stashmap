import React from "react";
import { useIsDiffItem, useIsRoot, useIsInReferencedByView } from "../ViewContext";
import { useIsViewingOtherUserContent } from "../SplitPanesContext";
import { RelevanceSelector } from "./RelevanceSelector";
import { EvidenceSelector } from "./EvidenceSelector";
import { ReferenceCount } from "./ReferenceCount";

export function RightMenu(): JSX.Element {
  const isDiffItem = useIsDiffItem();
  const isRoot = useIsRoot();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const isInReferencedByView = useIsInReferencedByView();

  const isReadonly = isRoot || isViewingOtherUserContent || isInReferencedByView;

  return (
    <div className="right-menu">
      <ReferenceCount />
      <div className="relevance-slot">
        {!isReadonly && <RelevanceSelector isDiffItem={isDiffItem} />}
      </div>
      <div className="evidence-slot">
        {!isReadonly && !isDiffItem && <EvidenceSelector />}
      </div>
    </div>
  );
}
