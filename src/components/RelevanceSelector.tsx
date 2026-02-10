import React, { useState } from "react";
import { TYPE_COLORS } from "../constants";
import {
  useUpdateRelevance,
  relevanceToLevel,
  levelToRelevance,
  RELEVANCE_LABELS,
} from "./useUpdateRelevance";
import {
  ViewPath,
  useViewPath,
  parseViewPath,
  getParentView,
  useNode,
  useDisplayText,
  useViewKey,
} from "../ViewContext";
import { usePlanner, planDeepCopyNode } from "../planner";
import { usePaneStack } from "../SplitPanesContext";
import { preventEditorBlur } from "./AddNode";
import { useEditorText } from "./EditorTextContext";
import { useTemporaryView } from "./TemporaryViewContext";
import { planBatchRelevance, EditorInfo } from "./batchOperations";

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
  isContains: boolean,
  isTogglingOff: boolean
): string {
  if (isNotRelevant || isContains || isTogglingOff || level !== displayLevel) {
    return TYPE_COLORS.inactive;
  }
  return LEVEL_COLORS[level] || TYPE_COLORS.inactive;
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

  const { currentRelevance, removeFromList, isVisible } = useUpdateRelevance();

  const viewPath = useViewPath();
  const viewKey = useViewKey();
  const [node] = useNode();
  const stack = usePaneStack();
  const { createPlan, executePlan } = usePlanner();
  const parentPath = getParentView(viewPath);
  const { selection } = useTemporaryView();

  const suggestionNodeText = node?.text || "";
  const versionedDisplayText = useDisplayText();
  const editorTextContext = useEditorText();
  const editorText = editorTextContext?.text ?? "";

  const acceptWithLevel = (level: number): void => {
    if (!parentPath) return;
    const relevance = levelToRelevance(level);
    const [plan] = planDeepCopyNode(
      createPlan(),
      viewPath,
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

  const isInSelection = selection.has(viewKey) && selection.size > 1;

  const getActionPaths = (): ViewPath[] =>
    isInSelection ? selection.toArray().map(parseViewPath) : [viewPath];

  const getEditorInfo = (): EditorInfo | undefined =>
    editorText ? { text: editorText, viewPath } : undefined;

  const handleSetLevel = (level: number): void => {
    if (isSuggestion) {
      acceptWithLevel(level);
      return;
    }
    const relevance = levelToRelevance(level === currentLevel ? -1 : level);
    executePlan(
      planBatchRelevance(
        createPlan(),
        getActionPaths(),
        stack,
        relevance,
        getEditorInfo()
      )
    );
  };

  const isCurrentlyNotRelevant = !isSuggestion && currentLevel === 0;

  const handleXClick = (): void => {
    if (isSuggestion) {
      acceptWithLevel(0);
      return;
    }
    if (!isInSelection && isCurrentlyNotRelevant) {
      removeFromList();
      return;
    }
    executePlan(
      planBatchRelevance(
        createPlan(),
        getActionPaths(),
        stack,
        "not_relevant",
        getEditorInfo()
      )
    );
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
        onMouseDown={preventEditorBlur}
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
          color: (() => {
            if (!isNotRelevant) {
              return TYPE_COLORS.inactive;
            }
            return isCurrentlyNotRelevant
              ? "var(--red)"
              : TYPE_COLORS.not_relevant;
          })(),
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
          onMouseDown={preventEditorBlur}
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
              isContains,
              hoverLevel !== null && hoverLevel === currentLevel
            ),
          }}
        >
          {LEVEL_SYMBOLS[level]}
        </span>
      ))}
    </div>
  );
}
