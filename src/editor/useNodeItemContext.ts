import {
  useIsInSearchView,
  useCurrentNode,
  useCurrentRowID,
  ViewPath,
  useRow,
} from "../rowModel";
import { isEmptySemanticID } from "../core/connections";
import { usePlanner } from "../planner";
import {
  planUpdateViewItemMetadata,
  NodeItemMetadata,
} from "../nodeItemMutations";
import { useCurrentPane, usePaneIndex } from "../SplitPanesContext";
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
  nodeID: ID | undefined;
  parentNode: GraphNode | undefined;
  childID: ID;
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
  const row = useRow();
  const { viewPath } = row;
  const nodeIndex = row.childIndex;
  const { createPlan, executePlan } = usePlanner();
  const isInSearchView = useIsInSearchView();
  const currentNode = useCurrentNode();
  const parentView = row.parentViewPath;
  const pane = useCurrentPane();
  const paneIndex = usePaneIndex();
  const isDocumentTopLevel =
    pane.documentId !== undefined && parentView === undefined && !!currentNode;

  const [rowID] = useCurrentRowID();
  const isEmptyNode = isEmptySemanticID(rowID);
  const nodeID = (() => {
    if (parentView) {
      return row.parentNode?.id;
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
      return row.node;
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
      planUpdateViewItemMetadata(
        createPlan(),
        {
          node: row.node,
          rowID,
          viewPath,
          parentNode: row.parentNode,
          parentViewPath: row.parentViewPath,
          childIndex: row.childIndex,
          virtualType: row.virtualType,
          paneIndex,
          paneAuthor: pane.author,
          documentId: pane.documentId,
          isDocumentTopLevel,
        },
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
    viewPath,
    parentView,
    nodeID,
    parentNode: row.parentNode,
    childID: row.node.id,
    updateMetadata,
  };
}
