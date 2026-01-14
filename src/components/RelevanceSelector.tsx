import React, { useState } from "react";
import {
  useRelationIndex,
  useViewPath,
  getParentView,
  upsertRelations,
  useIsInReferencedByView,
  useIsAddToNode,
  useNode,
  getNodeIDFromView,
} from "../ViewContext";
import { updateItemRelevance, getRelations } from "../connections";
import { usePlanner } from "../planner";
import { usePaneNavigation } from "../SplitPanesContext";
import { useData } from "../DataContext";
import { TYPE_COLORS } from "../constants";

// Relevance mapped to levels:
// "" (relevant) = 3
// "maybe_relevant" = 2
// "little_relevant" = 1
// "not_relevant" = 0

function relevanceToLevel(relevance: Relevance): number {
  switch (relevance) {
    case "":
      return 3;
    case "maybe_relevant":
      return 2;
    case "little_relevant":
      return 1;
    case "not_relevant":
      return 0;
    default:
      return 3;
  }
}

function levelToRelevance(level: number): Relevance {
  switch (level) {
    case 3:
      return "";
    case 2:
      return "maybe_relevant";
    case 1:
      return "little_relevant";
    case 0:
      return "not_relevant";
    default:
      return "";
  }
}

const LABELS = ["Not Relevant", "Little Relevant", "Maybe Relevant", "Relevant"];

function getLevelColor(level: number, displayLevel: number, isNotRelevant: boolean): string {
  if (isNotRelevant || level > displayLevel) {
    return TYPE_COLORS.inactive;
  }
  // Color based on the current display level (not the individual dot)
  switch (displayLevel) {
    case 3:
      return TYPE_COLORS.relevant;
    case 2:
      return TYPE_COLORS.maybe_relevant;
    case 1:
      return TYPE_COLORS.little_relevant;
    default:
      return TYPE_COLORS.inactive;
  }
}

export function RelevanceSelector(): JSX.Element | null {
  const [hoverLevel, setHoverLevel] = useState<number | null>(null);
  const data = useData();
  const viewPath = useViewPath();
  const relationIndex = useRelationIndex();
  const { stack } = usePaneNavigation();
  const { createPlan, executePlan } = usePlanner();
  const isInReferencedByView = useIsInReferencedByView();
  const isAddToNode = useIsAddToNode();
  const [node] = useNode();
  const parentView = getParentView(viewPath);

  // Don't show for: Referenced By view, Add To Node row, or items without relation index
  if (isInReferencedByView || isAddToNode || relationIndex === undefined || !parentView) {
    return null;
  }

  const nodeText = node?.text || "";

  const [parentNodeID, pView] = getNodeIDFromView(data, parentView);
  const relations = getRelations(
    data.knowledgeDBs,
    pView.relations,
    data.user.publicKey,
    parentNodeID
  );
  const currentItem = relations?.items.get(relationIndex);
  const currentRelevance = currentItem?.relevance || "";
  const currentLevel = relevanceToLevel(currentRelevance);
  const displayLevel = hoverLevel !== null ? hoverLevel : currentLevel;

  const handleClick = (level: number): void => {
    const plan = upsertRelations(createPlan(), parentView, stack, (rels) =>
      updateItemRelevance(rels, relationIndex, levelToRelevance(level))
    );
    executePlan(plan);
  };

  const isNotRelevant = displayLevel === 0;

  return (
    <div
      className="relevance-selector"
      onMouseLeave={() => setHoverLevel(null)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "2px",
        padding: "2px 6px",
        borderRadius: "12px",
        backgroundColor: "rgba(0,0,0,0.04)",
        cursor: "pointer",
      }}
      title={LABELS[displayLevel]}
    >
      {/* X for not relevant - on left */}
      <span
        onClick={() => handleClick(0)}
        onMouseEnter={() => setHoverLevel(0)}
        role="button"
        tabIndex={0}
        aria-label={`mark ${nodeText} as not relevant`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick(0);
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "18px",
          height: "18px",
          fontSize: "1.2rem",
          fontWeight: 600,
          lineHeight: 1,
          borderRadius: "50%",
          color: isNotRelevant ? "#fff" : "#888",
          backgroundColor: isNotRelevant ? TYPE_COLORS.not_relevant : "transparent",
          transition: "all 0.15s ease",
        }}
      >
        ×
      </span>

      {/* Dots for levels 1-3 */}
      {[1, 2, 3].map((level) => (
        <span
          key={level}
          onClick={() => handleClick(level)}
          onMouseEnter={() => setHoverLevel(level)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleClick(level);
            }
          }}
          style={{
            width: "18px",
            height: "18px",
            borderRadius: "50%",
            backgroundColor: getLevelColor(level, displayLevel, isNotRelevant),
            transition: "all 0.15s ease",
          }}
        />
      ))}
    </div>
  );
}
