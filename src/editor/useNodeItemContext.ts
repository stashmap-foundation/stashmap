import {
  useNodeIndex,
  useViewPath,
  getParentView,
  useIsInSearchView,
  useCurrentNode,
  useCurrentRowID,
  getNodeForView,
  getCurrentEdgeForView,
  ViewPath,
} from "../ViewContext";
import { isEmptySemanticID } from "../core/connections";
import { usePlanner } from "../planner";
import {
  planUpdateViewItemMetadata,
  NodeItemMetadata,
} from "../nodeItemMutations";
import { useData } from "../DataContext";
import { useCurrentPane } from "../SplitPanesContext";
import { useEditorText } from "./EditorTextContext";
import { nodeText as getNodeSpanText } from "../core/nodeSpans";

type NodeItemContext = {
  // Current state
  nodeIndex: number | undefined;
  isVisible: boolean;
  isEmptyNode: boolean;
  nodeText: string;
  currentRow: GraphNode | undefined;
  // For updating
  viewPath: ViewPath;
  parentView: ViewPath | undefined;
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
  const viewPath = useViewPath();
  const nodeIndex = useNodeIndex();
  const { createPlan, executePlan } = usePlanner();
  const isInSearchView = useIsInSearchView();
  const currentNode = useCurrentNode();
  const parentView = getParentView(viewPath);
  const pane = useCurrentPane();
  const isDocumentTopLevel =
    pane.documentId !== undefined && parentView === undefined && !!currentNode;

  const [rowID] = useCurrentRowID();
  const isEmptyNode = isEmptySemanticID(rowID);
  const nodeID = (() => {
    if (parentView) {
      return getNodeForView(data, parentView)?.id;
    }
    if (isDocumentTopLevel) {
      return currentNode.id;
    }
    return undefined;
  })();
  const editorTextContext = useEditorText();
  const nodeText = currentNode ? getNodeSpanText(currentNode) : "";

  const isVisible =
    !isInSearchView &&
    (isDocumentTopLevel ||
      (nodeIndex !== undefined && parentView !== undefined));

  // Get the current row using context-aware lookup
  const currentRow = (() => {
    if (isDocumentTopLevel) {
      return currentNode;
    }
    if (isVisible && parentView) {
      return getCurrentEdgeForView(data, viewPath);
    }
    return undefined;
  })();

  const updateMetadata = (metadata: NodeItemMetadata): void => {
    const editorText = editorTextContext?.text ?? "";
    if (isEmptyNode && !nodeID) return;
    if (
      !isEmptyNode &&
      !isDocumentTopLevel &&
      (!isVisible || !parentView || nodeIndex === undefined)
    )
      return;

    executePlan(
      planUpdateViewItemMetadata(createPlan(), viewPath, metadata, editorText)
    );
  };

  return {
    nodeIndex,
    isVisible,
    isEmptyNode,
    nodeText,
    currentRow,
    viewPath,
    parentView,
    nodeID,
    updateMetadata,
  };
}
