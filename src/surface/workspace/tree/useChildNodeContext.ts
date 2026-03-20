import {
  getNodeForView,
  getCurrentEdgeForView,
} from "../../../rows/resolveRow";
import { type RowPath, getParentRowPath } from "../../../rows/rowPaths";
import type { GraphNode } from "../../../graph/types";
import {
  useCurrentNode,
  useCurrentRowID,
  useIsInSearchView,
  useNodeIndex,
  useRowPath,
} from "./RowContext";
import { isEmptySemanticID } from "../../../graph/context";
import { usePlanner } from "../../app-shell/PlannerContext";
import {
  planUpdateRowNodeMetadata,
  type ChildNodeMetadata,
} from "../../../usecases/session/editorActions";
import { usePaneStack } from "../layout/SplitPanesContext";
import { useData } from "../../app-shell/DataContext";
import { useEditorText } from "../editor/EditorTextContext";

type ChildNodeContext = {
  nodeIndex: number | undefined;
  isVisible: boolean;
  isEmptyNode: boolean;
  nodeText: string;
  currentRow: GraphNode | undefined;
  rowPath: RowPath;
  parentRowPath: RowPath | undefined;
  nodeID: LongID | undefined;
  updateMetadata: (metadata: ChildNodeMetadata) => void;
};

export function useChildNodeContext(): ChildNodeContext {
  const data = useData();
  const rowPath = useRowPath();
  const nodeIndex = useNodeIndex();
  const stack = usePaneStack();
  const { createPlan, executePlan } = usePlanner();
  const isInSearchView = useIsInSearchView();
  const currentNode = useCurrentNode();
  const parentRowPath = getParentRowPath(rowPath);

  const [rowID] = useCurrentRowID();
  const isEmptyNode = isEmptySemanticID(rowID);
  const nodeID = parentRowPath
    ? getNodeForView(data, parentRowPath, stack)?.id
    : undefined;
  const editorTextContext = useEditorText();
  const nodeText = currentNode?.text || "";

  const isVisible =
    !isInSearchView && nodeIndex !== undefined && parentRowPath !== undefined;

  const currentRow =
    isVisible && parentRowPath
      ? getCurrentEdgeForView(data, rowPath)
      : undefined;

  const updateMetadata = (metadata: ChildNodeMetadata): void => {
    const editorText = editorTextContext?.text ?? "";
    if (isEmptyNode && !nodeID) return;
    if (
      !isEmptyNode &&
      (!isVisible || !parentRowPath || nodeIndex === undefined)
    ) {
      return;
    }

    executePlan(
      planUpdateRowNodeMetadata(
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
    parentRowPath,
    nodeID,
    updateMetadata,
  };
}
