import { usePlanner } from "../app-shell/PlannerContext";
import { usePaneStack } from "../navigation/SplitPanesContext";
import { planDisconnectFromParent } from "../../app/treeActions";
import { useChildNodeContext } from "./useChildNodeContext";

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
  currentRelevance: Relevance;
  currentLevel: number;
  nodeText: string;
  setRelevance: (relevance: Relevance) => void;
  setLevel: (level: number) => void;
  removeFromList: () => void;
  isVisible: boolean;
};

export function useUpdateRelevance(): UseUpdateRelevanceResult {
  const stack = usePaneStack();
  const { createPlan, executePlan } = usePlanner();
  const { isVisible, nodeText, currentRow, rowPath, updateMetadata } =
    useChildNodeContext();

  const rawRelevance = currentRow?.relevance;
  const currentRelevance: Relevance =
    (rawRelevance as string) === "" ? undefined : rawRelevance;
  const currentLevel = relevanceToLevel(currentRelevance);

  const setRelevance = (relevance: Relevance): void => {
    updateMetadata({ relevance });
  };

  const setLevel = (level: number): void => {
    setRelevance(levelToRelevance(level));
  };

  const removeFromList = (): void => {
    if (!isVisible) return;
    const plan = planDisconnectFromParent(createPlan(), rowPath, stack);
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
