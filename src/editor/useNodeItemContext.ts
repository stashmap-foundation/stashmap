import {
  getDisplayTextForRow,
  rowArgument,
  rowID,
  rowRelevance,
  useIsInSearchView,
  useIsViewingOtherUserContent,
  useRow,
} from "../rowModel";
import { isEmptyNodeID } from "../core/connections";
import { planUpdateOneMetadata } from "./batchOperations";
import { usePlanner } from "../planner";
import { NodeItemMetadata } from "../nodeItemMetadata";
import { useEditorText } from "./EditorTextContext";

type NodeItemContext = {
  isVisible: boolean;
  nodeText: string;
  relevance: Relevance;
  argument: Argument;
  updateMetadata: (metadata: NodeItemMetadata) => void;
};

export function useNodeItemContext(): NodeItemContext {
  const row = useRow();
  const { createPlan, executePlan } = usePlanner();
  const isInSearchView = useIsInSearchView();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const isEmptyNode = isEmptyNodeID(rowID(row));
  const editorTextContext = useEditorText();
  const isVisible =
    !isInSearchView &&
    (row.depth === 1 ||
      (row.parentViewPath !== undefined &&
        (row.rowType === "incoming" || !isViewingOtherUserContent)));

  const updateMetadata = (metadata: NodeItemMetadata): void => {
    if (isViewingOtherUserContent || isEmptyNode) return;
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
    isVisible,
    nodeText: getDisplayTextForRow(row),
    relevance: rowRelevance(row),
    argument: rowArgument(row),
    updateMetadata,
  };
}
