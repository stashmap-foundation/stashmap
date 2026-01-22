import { updateItemRelevance } from "../connections";
import { usePlanner } from "../planner";
import { usePaneNavigation } from "../SplitPanesContext";
import { planDisconnectFromParent } from "../dnd";
import { useRelationItemContext } from "./useRelationItemContext";

// Relevance mapped to levels:
// "relevant" = 3
// "" (maybe relevant, default) = 2
// "little_relevant" = 1
// "not_relevant" = 0

export function relevanceToLevel(relevance: Relevance): number {
  switch (relevance) {
    case "relevant":
      return 3;
    case "":
      return 2;
    case "little_relevant":
      return 1;
    case "not_relevant":
      return 0;
    default:
      return 2;
  }
}

export function levelToRelevance(level: number): Relevance {
  switch (level) {
    case 3:
      return "relevant";
    case 2:
      return "";
    case 1:
      return "little_relevant";
    case 0:
      return "not_relevant";
    default:
      return "";
  }
}

export const RELEVANCE_LABELS = [
  "Not Relevant",
  "Little Relevant",
  "Maybe Relevant",
  "Relevant",
];

type UseUpdateRelevanceResult = {
  // Current state
  currentRelevance: Relevance;
  currentLevel: number;
  nodeText: string;
  // Actions
  setRelevance: (relevance: Relevance) => void;
  setLevel: (level: number) => void;
  removeFromList: () => void;
  // Visibility
  isVisible: boolean;
};

/**
 * Hook for updating item relevance.
 * Used by RelevanceSelector.
 */
export function useUpdateRelevance(): UseUpdateRelevanceResult {
  const { stack } = usePaneNavigation();
  const { createPlan, executePlan } = usePlanner();
  const {
    isVisible,
    nodeText,
    currentItem,
    viewPath,
    updateMetadata,
  } = useRelationItemContext();

  const currentRelevance = currentItem?.relevance ?? "";
  const currentLevel = relevanceToLevel(currentRelevance);

  const setRelevance = (relevance: Relevance): void => {
    updateMetadata(
      (rels, index) => updateItemRelevance(rels, index, relevance),
      { relevance }
    );
  };

  const setLevel = (level: number): void => {
    setRelevance(levelToRelevance(level));
  };

  const removeFromList = (): void => {
    if (!isVisible) return;
    const plan = planDisconnectFromParent(createPlan(), viewPath, stack);
    executePlan(plan);
  };

  return {
    currentRelevance,
    currentLevel,
    nodeText,
    setRelevance,
    setLevel,
    removeFromList,
    isVisible,
  };
}
