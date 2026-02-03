import React from "react";
import { useOnChangeViewingMode } from "./SelectRelations";
import { useNode, useDisplayText, isReferencedByView } from "../ViewContext";
import { getConcreteRefs, isReferenceNode } from "../connections";
import { useData } from "../DataContext";
import { TYPE_COLORS } from "../constants";

function useSwitchToNormalRelations(): () => void {
  const onChangeViewingMode = useOnChangeViewingMode();
  return () => onChangeViewingMode(undefined, true);
}

export function ReferenceCount(): JSX.Element {
  const { knowledgeDBs } = useData();
  const [node, view] = useNode();
  const displayText = useDisplayText();
  const onChangeViewingMode = useOnChangeViewingMode();
  const switchToNormal = useSwitchToNormalRelations();

  if (!node || isReferenceNode(node)) {
    return <div className="ref-count-column" />;
  }

  const concreteRefs = getConcreteRefs(knowledgeDBs, node.id);
  const referenceCount = concreteRefs.size;

  if (referenceCount === 0) {
    return <div className="ref-count-column" />;
  }

  const isInReferencedBy = isReferencedByView(view);
  const isExpanded = view.expanded === true;

  const handleClick = (): void => {
    if (isInReferencedBy) {
      if (isExpanded) {
        switchToNormal();
      } else {
        onChangeViewingMode("REFERENCED_BY", true);
      }
    } else {
      onChangeViewingMode("REFERENCED_BY", true);
    }
  };

  const textColor = isInReferencedBy
    ? TYPE_COLORS.referenced_by
    : "var(--base01)";

  const ariaLabel = isInReferencedBy
    ? `hide references to ${displayText}`
    : `show references to ${displayText}`;

  const alwaysVisible = referenceCount > 1;

  return (
    <div className="ref-count-column">
      <button
        type="button"
        className={`ref-count-btn${alwaysVisible ? "" : " show-on-row-hover"}`}
        onClick={handleClick}
        aria-label={ariaLabel}
        title={
          isInReferencedBy
            ? "Show children"
            : `Show ${referenceCount} references`
        }
        style={{ color: textColor }}
      >
        ⤶{referenceCount}
      </button>
    </div>
  );
}
