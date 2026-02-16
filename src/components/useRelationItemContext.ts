import {
  useRelationIndex,
  useViewPath,
  getParentView,
  upsertRelations,
  useIsInSearchView,
  useNode,
  useNodeID,
  getRelationForView,
  ViewPath,
} from "../ViewContext";
import { isEmptyNodeID } from "../connections";
import {
  usePlanner,
  planUpdateEmptyNodeMetadata,
  planSaveNodeAndEnsureRelations,
  Plan,
} from "../planner";
import { usePaneStack } from "../SplitPanesContext";
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
  const stack = usePaneStack();
  const { createPlan, executePlan } = usePlanner();
  const isInSearchView = useIsInSearchView();
  const [node] = useNode();
  const parentView = getParentView(viewPath);

  const [nodeID] = useNodeID();
  const isEmptyNode = isEmptyNodeID(nodeID);
  const relationsID = parentView
    ? getRelationForView(data, parentView, stack)?.id
    : undefined;
  const editorTextContext = useEditorText();
  const nodeText = node?.text || "";

  const isVisible =
    !isInSearchView && relationIndex !== undefined && parentView !== undefined;

  // Get current item using context-aware lookup
  const currentItem =
    isVisible && parentView
      ? getRelationForView(data, parentView, stack)?.items.get(relationIndex!)
      : undefined;

  const updateMetadata = (
    updater: (relations: Relations, index: number) => Relations,
    metadata: { relevance?: Relevance; argument?: Argument }
  ): void => {
    const editorText = editorTextContext?.text ?? "";
    const hasEditorText = editorText.trim().length > 0;

    if (isEmptyNode) {
      if (!relationsID) return;
      if (hasEditorText) {
        const { plan } = planSaveNodeAndEnsureRelations(
          createPlan(),
          editorText,
          viewPath,
          stack,
          metadata.relevance,
          metadata.argument
        );
        executePlan(plan);
      } else {
        executePlan(
          planUpdateEmptyNodeMetadata(createPlan(), relationsID, metadata)
        );
      }
      return;
    }

    if (!isVisible || !parentView || relationIndex === undefined) return;

    const textChanged = hasEditorText && editorText !== nodeText;
    const basePlan: Plan = createPlan();

    const { plan: planWithSave } = textChanged
      ? planSaveNodeAndEnsureRelations(basePlan, editorText, viewPath, stack)
      : { plan: basePlan };

    const plan = upsertRelations(planWithSave, parentView, stack, (rels) =>
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
