import React from "react";
import {
  useIsSuggestion,
  useIsRoot,
  useIsInReferencedByView,
  useIsViewingOtherUserContent,
} from "../ViewContext";
import { RelevanceSelector } from "./RelevanceSelector";
import { EvidenceSelector } from "./EvidenceSelector";
import { ReferenceCount } from "./ReferenceCount";

export function RightMenu(): JSX.Element {
  const isSuggestion = useIsSuggestion();
  const isRoot = useIsRoot();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const isInReferencedByView = useIsInReferencedByView();

  const isReadonly =
    isRoot || isViewingOtherUserContent || isInReferencedByView;

  return (
    <div className="right-menu">
      <ReferenceCount />
      <div className="relevance-slot">
        {!isReadonly && <RelevanceSelector isSuggestion={isSuggestion} />}
      </div>
      <div className="evidence-slot">
        {!isReadonly && !isSuggestion && <EvidenceSelector />}
      </div>
    </div>
  );
}
