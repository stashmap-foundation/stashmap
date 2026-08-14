import {
  useIsInSearchView,
  useCurrentNode,
  useIsViewingOtherUserContent,
  ViewPath,
  useRow,
} from "../rowModel";
import { isEmptyNodeID } from "../core/connections";
import { planUpdateOneMetadata } from "./batchOperations";
import { usePlanner } from "../planner";
import { NodeItemMetadata } from "../nodeItemMetadata";
import { useCurrentPane } from "../SplitPanesContext";
import { useEditorText } from "./EditorTextContext";
import { nodeText as getNodeSpanText } from "../core/nodeSpans";

type NodeItemContext = {
  nodeIndex: number | undefined;
  isVisible: boolean;
  isEmptyNode: boolean;
  nodeText: string;
  currentRow: GraphNode | undefined;
  viewPath: ViewPath;
  parentView: ViewPath | undefined;
  nodeID: ID | undefined;
  parentNode: GraphNode | undefined;
  childID: ID;
  updateMetadata: (metadata: NodeItemMetadata) => void;
};

export function useNodeItemContext(): NodeItemContext {
  const row = useRow();
  const { viewPath } = row;
  const nodeIndex = row.childIndex;
  const { createPlan, executePlan } = usePlanner();
  const isInSearchView = useIsInSearchView();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const currentNode = useCurrentNode();
  const parentView = row.parentViewPath;
  const pane = useCurrentPane();
  const isDocumentTopLevel =
    pane.documentId !== undefined && parentView === undefined && !!currentNode;

  const isEmptyNode = isEmptyNodeID(row.node.id);
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
      (nodeIndex !== undefined && parentView !== undefined) ||
      (row.rowType === "occurrence" &&
        parentView !== undefined &&
        !isViewingOtherUserContent) ||
      (row.rowType === "incoming" && parentView !== undefined));

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
    if (isViewingOtherUserContent || (isEmptyNode && !nodeID)) return;
    executePlan(
      planUpdateOneMetadata(
        createPlan(),
        row,
        metadata,
        editorTextContext?.spans
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
