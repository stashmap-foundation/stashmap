import React from "react";
import { useIsDiffItem } from "../ViewContext";
import { ToggleEditing } from "./TemporaryViewContext";
import { RelevanceSelector } from "./RelevanceSelector";
import { EvidenceSelector } from "./EvidenceSelector";

export function RightMenu(): JSX.Element {
  const isDiffItem = useIsDiffItem();
  return (
    <div className="right-menu">
      <RelevanceSelector isDiffItem={isDiffItem} />
      {!isDiffItem && <EvidenceSelector />}
      {!isDiffItem && <ToggleEditing />}
    </div>
  );
}
