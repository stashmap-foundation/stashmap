import {
  useRelationIndex,
  useViewPath,
  getParentView,
  useIsInSearchView,
  useCurrentRelation,
  useCurrentRowID,
  getRelationForView,
  getCurrentEdgeForView,
  ViewPath,
} from "../ViewContext";
import { isEmptySemanticID } from "../connections";
import { usePlanner } from "../planner";
import {
  planUpdateViewItemMetadata,
  RelationItemMetadata,
} from "../relationItemMutations";
import { usePaneStack } from "../SplitPanesContext";
import { useData } from "../DataContext";
import { useEditorText } from "./EditorTextContext";

type RelationItemContext = {
  // Current state
  relationIndex: number | undefined;
  isVisible: boolean;
  isEmptyNode: boolean;
  nodeText: string;
  currentItem: GraphNode | undefined;
  // For updating
  viewPath: ViewPath;
  parentView: ViewPath | undefined;
  relationsID: LongID | undefined;
  // Update function
  updateMetadata: (metadata: RelationItemMetadata) => void;
};

/**
 * Shared hook for relation item context.
 * Used by useUpdateRelevance and useUpdateArgument.
 * Provides common data and an updateMetadata function that handles:
 * - Empty nodes with text: materialize via planSaveNodeAndEnsureRelations
 * - Empty nodes without text: update via planUpdateEmptyNodeMetadata
 * - Regular nodes: optionally save text, then update nodes
 */
export function useRelationItemContext(): RelationItemContext {
  const data = useData();
  const viewPath = useViewPath();
  const relationIndex = useRelationIndex();
  const stack = usePaneStack();
  const { createPlan, executePlan } = usePlanner();
  const isInSearchView = useIsInSearchView();
  const currentRelation = useCurrentRelation();
  const parentView = getParentView(viewPath);

  const [itemID] = useCurrentRowID();
  const isEmptyNode = isEmptySemanticID(itemID);
  const relationsID = parentView
    ? getRelationForView(data, parentView, stack)?.id
    : undefined;
  const editorTextContext = useEditorText();
  const nodeText = currentRelation?.text || "";

  const isVisible =
    !isInSearchView && relationIndex !== undefined && parentView !== undefined;

  // Get current item using context-aware lookup
  const currentItem =
    isVisible && parentView ? getCurrentEdgeForView(data, viewPath) : undefined;

  const updateMetadata = (metadata: RelationItemMetadata): void => {
    const editorText = editorTextContext?.text ?? "";
    if (isEmptyNode && !relationsID) return;
    if (
      !isEmptyNode &&
      (!isVisible || !parentView || relationIndex === undefined)
    )
      return;

    executePlan(
      planUpdateViewItemMetadata(
        createPlan(),
        viewPath,
        stack,
        metadata,
        editorText
      )
    );
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
