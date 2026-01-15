import React from "react";
import {
  VersionSelector,
  useOnChangeRelations,
  sortRelations,
} from "./SelectRelations";
import { TypeFilterButton, FilterDotsDisplay } from "./TypeFilterButton";
import {
  useNode,
  useNodeID,
  useIsAddToNode,
  useIsInReferencedByView,
  getAvailableRelationsForNode,
  getContextFromStackAndViewPath,
  useViewPath,
} from "../ViewContext";
import { getRelations, isReferenceNode } from "../connections";
import { useData } from "../DataContext";
import { REFERENCED_BY, TYPE_COLORS } from "../constants";
import { usePaneNavigation } from "../SplitPanesContext";

function useSwitchToNormalRelations(): (() => void) | undefined {
  const { knowledgeDBs, user } = useData();
  const [nodeID] = useNodeID();
  const viewPath = useViewPath();
  const { stack } = usePaneNavigation();
  const onChangeRelations = useOnChangeRelations();

  const context = getContextFromStackAndViewPath(stack, viewPath);
  const normalRelations = getAvailableRelationsForNode(
    knowledgeDBs,
    user.publicKey,
    nodeID,
    context
  );
  const sorted = sortRelations(normalRelations, user.publicKey);
  const topNormalRelation = sorted.first();

  if (!topNormalRelation) {
    return undefined;
  }

  return () => onChangeRelations(topNormalRelation, true);
}

function ReferenceDot(): JSX.Element | null {
  const { knowledgeDBs, user } = useData();
  const [node, view] = useNode();
  const onChangeRelations = useOnChangeRelations();
  const switchToNormal = useSwitchToNormalRelations();

  if (!node || isReferenceNode(node)) {
    return null;
  }

  const referencedByRelations = getRelations(
    knowledgeDBs,
    REFERENCED_BY,
    user.publicKey,
    node.id
  );
  const referenceCount = referencedByRelations?.items.size || 0;

  if (referenceCount === 0) {
    return null;
  }

  const isInReferencedBy = view.relations === REFERENCED_BY;
  const isExpanded = view.expanded === true;

  const handleClick = (): void => {
    if (isInReferencedBy) {
      if (isExpanded && switchToNormal) {
        switchToNormal();
      } else if (!isExpanded && referencedByRelations) {
        onChangeRelations(referencedByRelations, true);
      }
    } else if (referencedByRelations) {
      onChangeRelations(referencedByRelations, true);
    }
  };

  // Purple for references
  const dotColor = isInReferencedBy
    ? TYPE_COLORS.referenced_by
    : TYPE_COLORS.inactive;

  const ariaLabel = isInReferencedBy
    ? `hide references to ${node.text}`
    : `show references to ${node.text}`;

  return (
    <button
      type="button"
      className="btn btn-borderless p-0 d-flex align-items-center justify-content-center"
      onClick={handleClick}
      aria-label={ariaLabel}
      title={
        isInReferencedBy ? "Show children" : `Show ${referenceCount} references`
      }
      style={{
        width: "18px",
        height: "18px",
        borderRadius: "50%",
        backgroundColor: dotColor,
        color: "white",
        fontSize: "0.65rem",
        fontWeight: 600,
        lineHeight: 1,
        minWidth: "18px",
      }}
    >
      {referenceCount}
    </button>
  );
}

function GrayedFilterDots(): JSX.Element | null {
  const [node] = useNode();
  const switchToNormal = useSwitchToNormalRelations();

  if (!node || !switchToNormal) {
    return null;
  }

  return (
    <button
      type="button"
      className="btn btn-borderless p-0"
      onClick={switchToNormal}
      aria-label={`show children of ${node.text}`}
      title="Switch to children view"
    >
      <FilterDotsDisplay activeFilters={[]} />
    </button>
  );
}

function FilterAndReferencesToggle(): JSX.Element | null {
  const isAddToNode = useIsAddToNode();
  const isInReferencedByView = useIsInReferencedByView();
  const [node, view] = useNode();

  // Don't show in Add Note mode or when inside Referenced By view
  if (isAddToNode || isInReferencedByView || !node) {
    return null;
  }

  const isInReferencedBy = view?.relations === REFERENCED_BY;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 6px",
        borderRadius: "12px",
        backgroundColor: "rgba(0,0,0,0.04)",
      }}
    >
      <ReferenceDot />
      {isInReferencedBy ? <GrayedFilterDots /> : <TypeFilterButton />}
    </div>
  );
}

export function LeftMenu(): JSX.Element {
  return (
    <div className="left-menu">
      <VersionSelector />
      <FilterAndReferencesToggle />
    </div>
  );
}
