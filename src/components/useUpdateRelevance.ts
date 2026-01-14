import { Set } from "immutable";
import {
  useRelationIndex,
  useViewPath,
  getParentView,
  upsertRelations,
  useIsInReferencedByView,
  useIsAddToNode,
  useNode,
  getNodeIDFromView,
  getRelationForView,
  calculateIndexFromNodeIndex,
  getLast,
  getViewFromPath,
} from "../ViewContext";
import {
  updateItemRelevance,
  getRelations,
  markItemsAsNotRelevant,
} from "../connections";
import { usePlanner } from "../planner";
import { usePaneNavigation } from "../SplitPanesContext";
import { useData } from "../DataContext";
import { REFERENCED_BY } from "../constants";

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
  // Visibility
  isVisible: boolean;
};

/**
 * Hook for updating item relevance.
 * Extracts common logic used by RelevanceSelector and DisconnectNodeBtn.
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

  // Get current relevance
  let currentRelevance: Relevance = "";
  if (isVisible && parentView) {
    const [parentNodeID, pView] = getNodeIDFromView(data, parentView);
    const relations = getRelations(
      data.knowledgeDBs,
      pView.relations,
      data.user.publicKey,
      parentNodeID
    );
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

  return {
    currentRelevance,
    currentLevel,
    nodeText,
    setRelevance,
    setLevel,
    isVisible,
  };
}

type UseDisconnectResult = {
  // Action
  disconnect: () => void;
  // Visibility
  isVisible: boolean;
  nodeText: string;
};

/**
 * Hook for disconnecting a single node (marking as not relevant).
 * Used by DisconnectNodeBtn.
 */
export function useDisconnectNode(): UseDisconnectResult {
  const data = useData();
  const { stack } = usePaneNavigation();
  const { createPlan, executePlan } = usePlanner();
  const viewPath = useViewPath();
  const [node] = useNode();
  const { nodeID, nodeIndex } = getLast(viewPath);
  const parentPath = getParentView(viewPath);

  const nodeText = node?.text || "";

  // Check visibility conditions
  let isVisible = false;
  let relationIndex: number | undefined;

  if (parentPath) {
    const parentView = getViewFromPath(data, parentPath);
    if (parentView && parentView.relations !== REFERENCED_BY) {
      const relations = getRelationForView(data, parentPath, stack);
      if (relations) {
        relationIndex = calculateIndexFromNodeIndex(
          relations,
          nodeID,
          nodeIndex
        );
        isVisible = relationIndex !== undefined;
      }
    }
  }

  const disconnect = (): void => {
    if (!isVisible || !parentPath || relationIndex === undefined) return;
    const plan = upsertRelations(createPlan(), parentPath, stack, (rel) =>
      markItemsAsNotRelevant(rel, Set([relationIndex]))
    );
    executePlan(plan);
  };

  return {
    disconnect,
    isVisible,
    nodeText,
  };
}

type UseDisconnectMultipleResult = {
  // Action
  disconnect: () => void;
  // Info
  selectedCount: number;
};

/**
 * Hook for disconnecting multiple selected nodes.
 * Used by DisconnectBtn.
 */
export function useDisconnectMultiple(
  selectedIndices: Set<number>,
  onAfterDisconnect?: () => void
): UseDisconnectMultipleResult {
  const data = useData();
  const { stack } = usePaneNavigation();
  const { createPlan, executePlan } = usePlanner();
  const viewContext = useViewPath();

  const disconnect = (): void => {
    if (selectedIndices.size === 0) return;
    const relations = getRelationForView(data, viewContext, stack);
    if (!relations) return;

    const plan = upsertRelations(createPlan(), viewContext, stack, (rel) =>
      markItemsAsNotRelevant(rel, selectedIndices)
    );
    executePlan(plan);
    onAfterDisconnect?.();
  };

  return {
    disconnect,
    selectedCount: selectedIndices.size,
  };
}
