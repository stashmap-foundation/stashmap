import { getNodeForView, getCurrentEdgeForView } from "../rows/resolveRow";
import { type RowPath, getParentRowPath } from "../rows/rowPaths";
import {
  useCurrentNode,
  useCurrentRowID,
  useIsInSearchView,
  useNodeIndex,
  useRowPath,
} from "../features/tree/RowContext";
import { isEmptySemanticID } from "../connections";
import { usePlanner } from "../planner";
import {
  planUpdateViewItemMetadata,
  NodeItemMetadata,
} from "../nodeItemMutations";
import { usePaneStack } from "../features/navigation/SplitPanesContext";
import { useData } from "../DataContext";
import { useEditorText } from "./EditorTextContext";

type NodeItemContext = {
  // Current state
  nodeIndex: number | undefined;
  isVisible: boolean;
  isEmptyNode: boolean;
  nodeText: string;
  currentRow: GraphNode | undefined;
  // For updating
  rowPath: RowPath;
  parentView: RowPath | undefined;
  nodeID: LongID | undefined;
  // Update function
  updateMetadata: (metadata: NodeItemMetadata) => void;
};

/**
 * Shared hook for node row context.
 * Used by useUpdateRelevance and useUpdateArgument.
 * Provides common data and an updateMetadata function that handles:
 * - Empty nodes with text: materialize via planSaveNodeAndEnsureNodes
 * - Empty nodes without text: update via planUpdateEmptyNodeMetadata
 * - Regular nodes: optionally save text, then update nodes
 */
export function useNodeItemContext(): NodeItemContext {
  const data = useData();
  const rowPath = useRowPath();
  const nodeIndex = useNodeIndex();
  const stack = usePaneStack();
  const { createPlan, executePlan } = usePlanner();
  const isInSearchView = useIsInSearchView();
  const currentNode = useCurrentNode();
  const parentView = getParentRowPath(rowPath);

  const [rowID] = useCurrentRowID();
  const isEmptyNode = isEmptySemanticID(rowID);
  const nodeID = parentView
    ? getNodeForView(data, parentView, stack)?.id
    : undefined;
  const editorTextContext = useEditorText();
  const nodeText = currentNode?.text || "";

  const isVisible =
    !isInSearchView && nodeIndex !== undefined && parentView !== undefined;

  // Get the current row using context-aware lookup
  const currentRow =
    isVisible && parentView ? getCurrentEdgeForView(data, rowPath) : undefined;

  const updateMetadata = (metadata: NodeItemMetadata): void => {
    const editorText = editorTextContext?.text ?? "";
    if (isEmptyNode && !nodeID) return;
    if (!isEmptyNode && (!isVisible || !parentView || nodeIndex === undefined))
      return;

    executePlan(
      planUpdateViewItemMetadata(
        createPlan(),
        rowPath,
        stack,
        metadata,
        editorText
      )
    );
  };

  return {
    nodeIndex,
    isVisible,
    isEmptyNode,
    nodeText,
    currentRow,
    rowPath,
    parentView,
    nodeID,
    updateMetadata,
  };
}
