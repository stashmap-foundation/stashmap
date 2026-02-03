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
  getContext,
} from "../ViewContext";
import { usePlanner, planDeepCopyNode } from "../planner";
import { usePaneStack } from "../SplitPanesContext";
import { preventEditorBlurIfSameNode } from "./AddNode";
import { useEditorText } from "./EditorTextContext";

type RelevanceSelectorProps = {
  isSuggestion?: boolean;
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
  isSuggestion: boolean,
  isCurrentlyNotRelevant: boolean,
  displayText: string
): string {
  if (isSuggestion) {
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
    return "var(--red)";
  }
  return TYPE_COLORS.not_relevant;
}

export function RelevanceSelector({
  isSuggestion = false,
}: RelevanceSelectorProps): JSX.Element | null {
  const [hoverLevel, setHoverLevel] = useState<number | null>(null);

  // Hooks for normal items (updating existing relevance)
  const { currentRelevance, setLevel, removeFromList, isVisible } =
    useUpdateRelevance();

  // Hooks for suggestions (accepting with relevance)
  const viewPath = useViewPath();
  const [nodeID] = useNodeID();
  const [node] = useNode();
  const stack = usePaneStack();
  const { createPlan, executePlan } = usePlanner();
  const parentPath = getParentView(viewPath);

  const suggestionNodeText = node?.text || "";
  const versionedDisplayText = useDisplayText();
  const editorTextContext = useEditorText();
  const editorText = editorTextContext?.text ?? "";

  // For suggestions, accept with the specified relevance level
  // Uses planDeepCopyNode to resolve crefs and copy children
  const acceptWithLevel = (level: number): void => {
    if (!parentPath) return;
    const relevance = levelToRelevance(level);
    const sourceContext = getContext(createPlan(), viewPath, stack);
    const [plan] = planDeepCopyNode(
      createPlan(),
      nodeID,
      sourceContext,
      parentPath,
      stack,
      undefined,
      relevance
    );
    executePlan(plan);
  };

  // Determine visibility
  if (isSuggestion) {
    if (!parentPath) return null;
  } else if (!isVisible) return null;

  // For suggestions: no selection initially (-1 means nothing selected)
  // For normal items: use current relevance
  const currentLevel = isSuggestion ? -1 : relevanceToLevel(currentRelevance);
  const displayLevel = hoverLevel !== null ? hoverLevel : currentLevel;
  const isNotRelevant = displayLevel === 0;
  const displayText = isSuggestion
    ? suggestionNodeText
    : editorText.trim() || versionedDisplayText;

  // Handler that works for both modes
  const handleSetLevel = (level: number): void => {
    if (isSuggestion) {
      acceptWithLevel(level);
    } else {
      setLevel(level);
    }
  };

  // Check if item is already marked as not relevant (for showing remove option)
  const isCurrentlyNotRelevant = !isSuggestion && currentLevel === 0;

  // Handler for X button - marks as not relevant, or removes if already not relevant
  const handleXClick = (): void => {
    if (isSuggestion) {
      acceptWithLevel(0); // Decline suggestion
    } else if (isCurrentlyNotRelevant) {
      removeFromList(); // Completely remove from list
    } else {
      setLevel(0); // Mark as not relevant
    }
  };

  // For suggestions with no hover, show all as inactive
  const effectiveDisplayLevel = displayLevel === -1 ? -1 : displayLevel;

  return (
    <div
      className="pill relevance-selector"
      onMouseLeave={() => setHoverLevel(null)}
      title={
        effectiveDisplayLevel >= 0
          ? RELEVANCE_LABELS[effectiveDisplayLevel]
          : "Set relevance"
      }
    >
      <span
        className="relevance-x"
        onClick={handleXClick}
        onMouseDown={preventEditorBlurIfSameNode}
        onMouseEnter={() => setHoverLevel(0)}
        role="button"
        tabIndex={0}
        aria-label={getXButtonAriaLabel(
          isSuggestion,
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
          color: isNotRelevant ? "var(--base03)" : "var(--base01)",
          backgroundColor: getXButtonBackgroundColor(
            isNotRelevant,
            isCurrentlyNotRelevant
          ),
        }}
        title={isCurrentlyNotRelevant ? "Remove from list" : undefined}
      >
        ×
      </span>

      {[1, 2, 3].map((level) => (
        <span
          key={level}
          className="relevance-dot"
          onClick={() => handleSetLevel(level)}
          onMouseDown={preventEditorBlurIfSameNode}
          onMouseEnter={() => setHoverLevel(level)}
          role="button"
          tabIndex={0}
          aria-label={
            isSuggestion
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
            backgroundColor: getLevelColor(
              level,
              effectiveDisplayLevel,
              isNotRelevant
            ),
          }}
        />
      ))}
    </div>
  );
}
