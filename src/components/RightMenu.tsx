import React from "react";
import { useIsDiffItem, useIsRoot, useIsInReferencedByView } from "../ViewContext";
import { useIsViewingOtherUserContent } from "../SplitPanesContext";
import { RelevanceSelector } from "./RelevanceSelector";
import { EvidenceSelector } from "./EvidenceSelector";

export function RightMenu(): JSX.Element | null {
  const isDiffItem = useIsDiffItem();
  const isRoot = useIsRoot();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const isInReferencedByView = useIsInReferencedByView();

  const isReadonly = isViewingOtherUserContent || isInReferencedByView;

  if (isRoot || isReadonly) {
    return null;
  }

  return (
    <div className="right-menu">
      <RelevanceSelector isDiffItem={isDiffItem} />
      {!isDiffItem && <EvidenceSelector />}
    </div>
  );
}
