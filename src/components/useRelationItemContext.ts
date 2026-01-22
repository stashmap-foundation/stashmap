import {
  useRelationIndex,
  useViewPath,
  getParentView,
  upsertRelations,
  useIsInReferencedByView,
  useIsAddToNode,
  useNode,
  useNodeID,
  getRelationForView,
  getNodeIDFromView,
  ViewPath,
} from "../ViewContext";
import { isEmptyNodeID } from "../connections";
import { usePlanner, planUpdateEmptyNodeMetadata, planSaveNodeAndEnsureRelations, Plan } from "../planner";
import { usePaneNavigation } from "../SplitPanesContext";
import { useData } from "../DataContext";
import { useEditorText } from "./EditorTextContext";

type RelationItemContext = {
  // Current state
  relationIndex: number | undefined;
  isVisible: boolean;
  isEmptyNode: boolean;
  nodeText: string;
  currentItem: RelationItem | undefined;
  // For updating
  viewPath: ViewPath;
  parentView: ViewPath | undefined;
  relationsID: LongID | undefined;
  // Update function
  updateMetadata: (
    updater: (relations: Relations, index: number) => Relations,
    metadata: { relevance?: Relevance; argument?: Argument }
  ) => void;
};

/**
 * Shared hook for relation item context.
 * Used by useUpdateRelevance and useUpdateArgument.
 * Provides common data and an updateMetadata function that handles:
 * - Empty nodes with text: materialize via planSaveNodeAndEnsureRelations
 * - Empty nodes without text: update via planUpdateEmptyNodeMetadata
 * - Regular nodes: optionally save text, then update relations
 */
export function useRelationItemContext(): RelationItemContext {
  const data = useData();
  const viewPath = useViewPath();
  const relationIndex = useRelationIndex();
  const { stack } = usePaneNavigation();
  const { createPlan, executePlan } = usePlanner();
  const isInReferencedByView = useIsInReferencedByView();
  const isAddToNode = useIsAddToNode();
  const [node] = useNode();
  const parentView = getParentView(viewPath);

  const [nodeID] = useNodeID();
  const isEmptyNode = isEmptyNodeID(nodeID);
  const relationsID = parentView
    ? getNodeIDFromView(data, parentView)[1].relations
    : undefined;
  const editorTextContext = useEditorText();
  const nodeText = node?.text || "";

  // Determine visibility
  const isVisible =
    !isInReferencedByView &&
    !isAddToNode &&
    relationIndex !== undefined &&
    parentView !== undefined;

  // Get current item using context-aware lookup
  const currentItem =
    isVisible && parentView
      ? getRelationForView(data, parentView, stack)?.items.get(relationIndex!)
      : undefined;

  const updateMetadata = (
    updater: (relations: Relations, index: number) => Relations,
    metadata: { relevance?: Relevance; argument?: Argument }
  ): void => {
    const editorText = editorTextContext?.getText() ?? "";
    const hasEditorText = editorText.trim().length > 0;

    if (isEmptyNode) {
      if (!relationsID) return;
      if (hasEditorText) {
        const plan = planSaveNodeAndEnsureRelations(
          createPlan(),
          editorText,
          viewPath,
          stack,
          metadata.relevance,
          metadata.argument
        );
        executePlan(plan);
      } else {
        executePlan(planUpdateEmptyNodeMetadata(createPlan(), relationsID, metadata));
      }
      return;
    }

    if (!isVisible || !parentView || relationIndex === undefined) return;

    const textChanged = hasEditorText && editorText !== nodeText;
    let plan: Plan = createPlan();

    if (textChanged) {
      plan = planSaveNodeAndEnsureRelations(plan, editorText, viewPath, stack);
    }

    plan = upsertRelations(plan, parentView, stack, (rels) =>
      updater(rels, relationIndex)
    );
    executePlan(plan);
  };

  return {
    relationIndex,
    isVisible,
    isEmptyNode,
    nodeText,
    currentItem,
    viewPath,
    parentView,
    relationsID,
    updateMetadata,
  };
}
