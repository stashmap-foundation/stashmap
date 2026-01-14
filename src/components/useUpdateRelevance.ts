import {
  useRelationIndex,
  useViewPath,
  getParentView,
  upsertRelations,
  useIsInReferencedByView,
  useIsAddToNode,
  useNode,
  getRelationForView,
} from "../ViewContext";
import { updateItemRelevance, deleteRelations } from "../connections";
import { Set } from "immutable";
import { usePlanner } from "../planner";
import { usePaneNavigation } from "../SplitPanesContext";
import { useData } from "../DataContext";

// Relevance mapped to levels:
// "" (relevant) = 3
// "maybe_relevant" = 2
// "little_relevant" = 1
// "not_relevant" = 0

export function relevanceToLevel(relevance: Relevance): number {
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

export function levelToRelevance(level: number): Relevance {
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
  const data = useData();
  const viewPath = useViewPath();
  const relationIndex = useRelationIndex();
  const { stack } = usePaneNavigation();
  const { createPlan, executePlan } = usePlanner();
  const isInReferencedByView = useIsInReferencedByView();
  const isAddToNode = useIsAddToNode();
  const [node] = useNode();
  const parentView = getParentView(viewPath);

  // Determine visibility
  const isVisible =
    !isInReferencedByView &&
    !isAddToNode &&
    relationIndex !== undefined &&
    parentView !== undefined;

  // Get current relevance using same context-aware lookup as relationIndex
  let currentRelevance: Relevance = "";
  if (isVisible && parentView) {
    const relations = getRelationForView(data, parentView, stack);
    const currentItem = relations?.items.get(relationIndex!);
    currentRelevance = currentItem?.relevance || "";
  }

  const currentLevel = relevanceToLevel(currentRelevance);
  const nodeText = node?.text || "";

  const setRelevance = (relevance: Relevance): void => {
    if (!isVisible || !parentView || relationIndex === undefined) return;
    const plan = upsertRelations(createPlan(), parentView, stack, (rels) =>
      updateItemRelevance(rels, relationIndex, relevance)
    );
    executePlan(plan);
  };

  const setLevel = (level: number): void => {
    setRelevance(levelToRelevance(level));
  };

  const removeFromList = (): void => {
    if (!isVisible || !parentView || relationIndex === undefined) return;
    const plan = upsertRelations(createPlan(), parentView, stack, (rels) =>
      deleteRelations(rels, Set([relationIndex]))
    );
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
