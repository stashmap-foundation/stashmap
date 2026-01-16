import React from "react";
import { useIsDiffItem, useIsRoot } from "../ViewContext";
import { RelevanceSelector } from "./RelevanceSelector";
import { EvidenceSelector } from "./EvidenceSelector";

export function RightMenu(): JSX.Element | null {
  const isDiffItem = useIsDiffItem();
  const isRoot = useIsRoot();

  // Root node doesn't have relevance/evidence settings
  if (isRoot) {
    return null;
  }

  return (
    <div className="right-menu">
      <RelevanceSelector isDiffItem={isDiffItem} />
      {!isDiffItem && <EvidenceSelector />}
    </div>
  );
}
