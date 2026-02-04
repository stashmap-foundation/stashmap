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

const LEVEL_SYMBOLS: Record<number, string> = {
  1: "~",
  2: "?",
  3: "!",
};

const LEVEL_COLORS: Record<number, string> = {
  1: TYPE_COLORS.little_relevant,
  2: TYPE_COLORS.maybe_relevant,
  3: TYPE_COLORS.relevant,
};

function getLevelColor(
  level: number,
  displayLevel: number,
  isNotRelevant: boolean,
  isContains: boolean
): string {
  if (isNotRelevant || isContains || level > displayLevel) {
    return TYPE_COLORS.inactive;
  }
  return LEVEL_COLORS[displayLevel] || TYPE_COLORS.inactive;
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
  const isContains = displayLevel === -1;
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

  const getTitle = (): string => {
    if (effectiveDisplayLevel >= 0) {
      return RELEVANCE_LABELS[effectiveDisplayLevel];
    }
    return isSuggestion ? "Set relevance" : RELEVANCE_LABELS[-1];
  };

  return (
    <div
      className="pill relevance-selector"
      onMouseLeave={() => setHoverLevel(null)}
      title={getTitle()}
    >
      <span
        className="relevance-symbol"
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
          color: isNotRelevant
            ? isCurrentlyNotRelevant
              ? "var(--red)"
              : TYPE_COLORS.not_relevant
            : TYPE_COLORS.inactive,
        }}
        title={isCurrentlyNotRelevant ? "Remove from list" : undefined}
      >
        x
      </span>

      {[1, 2, 3].map((level) => (
        <span
          key={level}
          className="relevance-symbol"
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
            color: getLevelColor(
              level,
              effectiveDisplayLevel,
              isNotRelevant,
              isContains
            ),
          }}
        >
          {LEVEL_SYMBOLS[level]}
        </span>
      ))}
    </div>
  );
}
