import { updateItemRelevance } from "../connections";
import { usePlanner } from "../planner";
import { usePaneStack } from "../SplitPanesContext";
import { planDisconnectFromParent } from "../dnd";
import { useRelationItemContext } from "./useRelationItemContext";

// Relevance mapped to levels (for 3-dot UI):
// "relevant" = 3 (3 dots)
// "maybe_relevant" = 2 (2 dots)
// "little_relevant" = 1 (1 dot)
// "not_relevant" = 0 (X button)
// undefined (contains, default) = -1 (no dots selected)

export function relevanceToLevel(relevance: Relevance): number {
  switch (relevance) {
    case "relevant":
      return 3;
    case "maybe_relevant":
      return 2;
    case "little_relevant":
      return 1;
    case "not_relevant":
      return 0;
    case undefined:
      return -1;
    default:
      return -1;
  }
}

export function levelToRelevance(level: number): Relevance {
  switch (level) {
    case 3:
      return "relevant";
    case 2:
      return "maybe_relevant";
    case 1:
      return "little_relevant";
    case 0:
      return "not_relevant";
    default:
      return undefined;
  }
}

export const RELEVANCE_LABELS: Record<number, string> = {
  [-1]: "Contains",
  0: "Not Relevant",
  1: "Little Relevant",
  2: "Maybe Relevant",
  3: "Relevant",
};

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
  const stack = usePaneStack();
  const { createPlan, executePlan } = usePlanner();
  const { isVisible, nodeText, currentItem, viewPath, updateMetadata } =
    useRelationItemContext();

  const rawRelevance = currentItem?.relevance;
  const currentRelevance: Relevance =
    (rawRelevance as string) === "" ? undefined : rawRelevance;
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
