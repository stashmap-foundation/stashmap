import React, { useState } from "react";
import { TYPE_COLORS } from "../constants";
import {
  useUpdateRelevance,
  relevanceToLevel,
  RELEVANCE_LABELS,
} from "./useUpdateRelevance";

function getLevelColor(
  level: number,
  displayLevel: number,
  isNotRelevant: boolean
): string {
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
  const { currentRelevance, nodeText, setLevel, isVisible } =
    useUpdateRelevance();

  if (!isVisible) {
    return null;
  }

  const currentLevel = relevanceToLevel(currentRelevance);
  const displayLevel = hoverLevel !== null ? hoverLevel : currentLevel;
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
      title={RELEVANCE_LABELS[displayLevel]}
    >
      {/* X for not relevant - on left */}
      <span
        onClick={() => setLevel(0)}
        onMouseEnter={() => setHoverLevel(0)}
        role="button"
        tabIndex={0}
        aria-label={`mark ${nodeText} as not relevant`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setLevel(0);
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
          backgroundColor: isNotRelevant
            ? TYPE_COLORS.not_relevant
            : "transparent",
          transition: "all 0.15s ease",
        }}
      >
        ×
      </span>

      {/* Dots for levels 1-3 */}
      {[1, 2, 3].map((level) => (
        <span
          key={level}
          onClick={() => setLevel(level)}
          onMouseEnter={() => setHoverLevel(level)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setLevel(level);
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
