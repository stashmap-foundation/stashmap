import React from "react";
import { useOnChangeViewingMode } from "./SelectRelations";
import { TypeFilterButton, FilterDotsDisplay } from "./TypeFilterButton";
import {
  useNode,
  useIsInReferencedByView,
  useDisplayText,
  isReferencedByView,
} from "../ViewContext";
import { getConcreteRefs, isReferenceNode } from "../connections";
import { useData } from "../DataContext";
import { TYPE_COLORS } from "../constants";
import { AddSiblingButton } from "./AddNode";

function useSwitchToNormalRelations(): () => void {
  const onChangeViewingMode = useOnChangeViewingMode();
  return () => onChangeViewingMode(undefined, true);
}

function ReferenceDot(): JSX.Element | null {
  const { knowledgeDBs } = useData();
  const [node, view] = useNode();
  const displayText = useDisplayText();
  const onChangeViewingMode = useOnChangeViewingMode();
  const switchToNormal = useSwitchToNormalRelations();

  if (!node || isReferenceNode(node)) {
    return null;
  }

  const concreteRefs = getConcreteRefs(knowledgeDBs, node.id);
  const referenceCount = concreteRefs.size;

  if (referenceCount === 0) {
    return null;
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
    : TYPE_COLORS.inactive;

  const ariaLabel = isInReferencedBy
    ? `hide references to ${displayText}`
    : `show references to ${displayText}`;

  return (
    <button
      type="button"
      className="pill"
      onClick={handleClick}
      aria-label={ariaLabel}
      title={
        isInReferencedBy ? "Show children" : `Show ${referenceCount} references`
      }
      style={{ color: textColor }}
    >
      {referenceCount}
    </button>
  );
}

function GrayedFilterDots(): JSX.Element | null {
  const [node] = useNode();
  const displayText = useDisplayText();
  const switchToNormal = useSwitchToNormalRelations();

  if (!node) {
    return null;
  }

  return (
    <button
      type="button"
      className="pill"
      onClick={switchToNormal}
      aria-label={`show children of ${displayText}`}
      title="Switch to children view"
    >
      <FilterDotsDisplay activeFilters={[]} />
    </button>
  );
}

function FilterAndReferencesToggle(): JSX.Element | null {
  const isInReferencedByView = useIsInReferencedByView();
  const [node, view] = useNode();

  if (isInReferencedByView || !node) {
    return null;
  }

  const isInReferencedBy = view && isReferencedByView(view);

  return (
    <div className="filter-references-toggle">
      <ReferenceDot />
      {isInReferencedBy ? <GrayedFilterDots /> : <TypeFilterButton />}
    </div>
  );
}

export function LeftMenu(): JSX.Element {
  return (
    <div className="left-menu">
      <AddSiblingButton />
      <FilterAndReferencesToggle />
    </div>
  );
}
