import React from "react";
import { useIsDiffItem, useIsRoot, useIsInReferencedByView } from "../ViewContext";
import { useIsViewingOtherUserContent } from "../SplitPanesContext";
import { RelevanceSelector } from "./RelevanceSelector";
import { EvidenceSelector } from "./EvidenceSelector";

export function RightMenu(): JSX.Element {
  const isDiffItem = useIsDiffItem();
  const isRoot = useIsRoot();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const isInReferencedByView = useIsInReferencedByView();

  const isReadonly = isRoot || isViewingOtherUserContent || isInReferencedByView;

  return (
    <div className="right-menu">
      {!isReadonly && (
        <>
          <RelevanceSelector isDiffItem={isDiffItem} />
          {!isDiffItem && <EvidenceSelector />}
        </>
      )}
    </div>
  );
}
