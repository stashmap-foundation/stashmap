import React, { useState } from "react";
import { TYPE_COLORS } from "../constants";
import {
  useUpdateRelevance,
  relevanceToLevel,
  levelToRelevance,
  RELEVANCE_LABELS,
} from "./useUpdateRelevance";
import {
  useViewPath,
  getParentView,
  useNodeID,
  useNode,
  useDisplayText,
} from "../ViewContext";
import { usePlanner } from "../planner";
import { planAddToParent } from "../dnd";
import { usePaneNavigation } from "../SplitPanesContext";

type RelevanceSelectorProps = {
  isDiffItem?: boolean;
};

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

function getXButtonAriaLabel(
  isDiffItem: boolean,
  isCurrentlyNotRelevant: boolean,
  displayText: string
): string {
  if (isDiffItem) {
    return `decline ${displayText}`;
  }
  if (isCurrentlyNotRelevant) {
    return `remove ${displayText} from list`;
  }
  return `mark ${displayText} as not relevant`;
}

function getXButtonBackgroundColor(
  isNotRelevant: boolean,
  isCurrentlyNotRelevant: boolean
): string {
  if (!isNotRelevant) {
    return "transparent";
  }
  if (isCurrentlyNotRelevant) {
    return "#c62828"; // Red for permanent removal from list
  }
  return TYPE_COLORS.not_relevant;
}

export function RelevanceSelector({
  isDiffItem = false,
}: RelevanceSelectorProps): JSX.Element | null {
  const [hoverLevel, setHoverLevel] = useState<number | null>(null);

  // Hooks for normal items (updating existing relevance)
  const { currentRelevance, setLevel, removeFromList, isVisible } =
    useUpdateRelevance();

  // Hooks for diff items (accepting with relevance)
  const viewPath = useViewPath();
  const [nodeID] = useNodeID();
  const [node] = useNode();
  const { stack } = usePaneNavigation();
  const { createPlan, executePlan } = usePlanner();
  const parentPath = getParentView(viewPath);

  const diffNodeText = node?.text || "";
  const versionedDisplayText = useDisplayText();

  // For diff items, accept with the specified relevance level
  const acceptWithLevel = (level: number): void => {
    if (!parentPath) return;
    const relevance = levelToRelevance(level);
    const plan = planAddToParent(createPlan(), nodeID, parentPath, stack, undefined, relevance);
    executePlan(plan);
  };

  // Determine visibility
  if (isDiffItem) {
    if (!parentPath) return null;
  } else if (!isVisible) return null;

  // For diff items: no selection initially (-1 means nothing selected)
  // For normal items: use current relevance
  const currentLevel = isDiffItem ? -1 : relevanceToLevel(currentRelevance);
  const displayLevel = hoverLevel !== null ? hoverLevel : currentLevel;
  const isNotRelevant = displayLevel === 0;
  const displayText = isDiffItem ? diffNodeText : versionedDisplayText;

  // Handler that works for both modes
  const handleSetLevel = (level: number): void => {
    if (isDiffItem) {
      acceptWithLevel(level);
    } else {
      setLevel(level);
    }
  };

  // Check if item is already marked as not relevant (for showing remove option)
  const isCurrentlyNotRelevant = !isDiffItem && currentLevel === 0;

  // Handler for X button - marks as not relevant, or removes if already not relevant
  const handleXClick = (): void => {
    if (isDiffItem) {
      acceptWithLevel(0); // Decline diff item
    } else if (isCurrentlyNotRelevant) {
      removeFromList(); // Completely remove from list
    } else {
      setLevel(0); // Mark as not relevant
    }
  };

  // For diff items with no hover, show all as inactive
  const effectiveDisplayLevel = displayLevel === -1 ? -1 : displayLevel;

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
      title={
        effectiveDisplayLevel >= 0
          ? RELEVANCE_LABELS[effectiveDisplayLevel]
          : "Set relevance"
      }
    >
      {/* X for not relevant (or trash for remove) - on left */}
      <span
        onClick={handleXClick}
        onMouseEnter={() => setHoverLevel(0)}
        role="button"
        tabIndex={0}
        aria-label={getXButtonAriaLabel(
          isDiffItem,
          isCurrentlyNotRelevant,
          displayText
        )}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleXClick();
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
          backgroundColor: getXButtonBackgroundColor(
            isNotRelevant,
            isCurrentlyNotRelevant
          ),
          transition: "all 0.15s ease",
        }}
        title={isCurrentlyNotRelevant ? "Remove from list" : undefined}
      >
        ×
      </span>

      {/* Dots for levels 1-3 */}
      {[1, 2, 3].map((level) => (
        <span
          key={level}
          onClick={() => handleSetLevel(level)}
          onMouseEnter={() => setHoverLevel(level)}
          role="button"
          tabIndex={0}
          aria-label={
            isDiffItem
              ? `accept ${displayText} as ${RELEVANCE_LABELS[
                  level
                ].toLowerCase()}`
              : `set ${displayText} to ${RELEVANCE_LABELS[level].toLowerCase()}`
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleSetLevel(level);
            }
          }}
          style={{
            width: "18px",
            height: "18px",
            borderRadius: "50%",
            backgroundColor: getLevelColor(
              level,
              effectiveDisplayLevel,
              isNotRelevant
            ),
            transition: "all 0.15s ease",
          }}
        />
      ))}
    </div>
  );
}
