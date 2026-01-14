import {
  useRelationIndex,
  useViewPath,
  getParentView,
  upsertRelations,
  useIsInReferencedByView,
  useIsAddToNode,
  getRelationForView,
} from "../ViewContext";
import { updateItemArgument } from "../connections";
import { usePlanner } from "../planner";
import { usePaneNavigation } from "../SplitPanesContext";
import { useData } from "../DataContext";

type UseUpdateArgumentResult = {
  currentArgument: Argument;
  setArgument: (argument: Argument) => void;
  isVisible: boolean;
};

/**
 * Hook for updating item argument (confirms/contra/none).
 * Used by EvidenceSelector.
 */
export function useUpdateArgument(): UseUpdateArgumentResult {
  const data = useData();
  const viewPath = useViewPath();
  const relationIndex = useRelationIndex();
  const { stack } = usePaneNavigation();
  const { createPlan, executePlan } = usePlanner();
  const isInReferencedByView = useIsInReferencedByView();
  const isAddToNode = useIsAddToNode();
  const parentView = getParentView(viewPath);

  // Determine visibility
  const isVisible =
    !isInReferencedByView &&
    !isAddToNode &&
    relationIndex !== undefined &&
    parentView !== undefined;

  // Get current argument using same context-aware lookup as relationIndex
  let currentArgument: Argument = undefined;
  if (isVisible && parentView) {
    const relations = getRelationForView(data, parentView, stack);
    const currentItem = relations?.items.get(relationIndex!);
    currentArgument = currentItem?.argument;
  }

  const setArgument = (argument: Argument): void => {
    if (!isVisible || !parentView || relationIndex === undefined) return;
    const plan = upsertRelations(createPlan(), parentView, stack, (rels) =>
      updateItemArgument(rels, relationIndex, argument)
    );
    executePlan(plan);
  };

  return {
    currentArgument,
    setArgument,
    isVisible,
  };
}
