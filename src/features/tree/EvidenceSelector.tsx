import React from "react";
import { TYPE_COLORS } from "../../constants";
import { useUpdateArgument } from "./useUpdateArgument";
import { parseRowPath, type RowPath } from "../../rows/rowPaths";
import {
  useCurrentEdge,
  useCurrentNode,
  useDisplayText,
  useRowPath,
  useViewKey,
  useVirtualRowsMap,
} from "./RowContext";
import { usePlanner } from "../../planner";
import { usePaneStack } from "../navigation/SplitPanesContext";
import { preventEditorBlur } from "./AddNode";
import { useEditorText } from "../editor/EditorTextContext";
import { useTemporaryView } from "./TemporaryViewContext";
import { planBatchArgument, EditorInfo } from "./batchOperations";

function getArgumentColor(argument: Argument): string {
  if (argument === "confirms") {
    return TYPE_COLORS.confirms;
  }
  if (argument === "contra") {
    return TYPE_COLORS.contra;
  }
  return TYPE_COLORS.inactive;
}

function getArgumentSymbol(argument: Argument): string {
  if (argument === "confirms") return "+";
  if (argument === "contra") return "−";
  return "±";
}

function getNextArgument(current: Argument): Argument {
  // Cycle: undefined -> confirms -> contra -> undefined
  if (current === undefined) return "confirms";
  if (current === "confirms") return "contra";
  return undefined;
}

function getArgumentLabel(argument: Argument): string {
  if (argument === "confirms") return "Confirms";
  if (argument === "contra") return "Contradicts";
  return "No evidence type";
}

export function EvidenceSelector(): JSX.Element | null {
  const { currentArgument, isVisible } = useUpdateArgument();
  const currentRow = useCurrentEdge();
  const virtualType = currentRow?.virtualType;
  const isAcceptableVirtual =
    virtualType === "incoming" || virtualType === "version";
  const rowPath = useRowPath();
  const viewKey = useViewKey();
  const currentNode = useCurrentNode();
  const versionedDisplayText = useDisplayText();
  const editorTextContext = useEditorText();
  const editorText = editorTextContext?.text ?? "";
  const stack = usePaneStack();
  const { createPlan, executePlan } = usePlanner();
  const { selection } = useTemporaryView();
  const virtualRowsMap = useVirtualRowsMap();

  if (!isVisible && !isAcceptableVirtual) return null;

  const nodeName =
    editorText.trim() || versionedDisplayText || currentNode?.text || "row";

  const isInSelection = selection.has(viewKey) && selection.size > 1;

  const getActionPaths = (): RowPath[] =>
    isInSelection ? selection.toArray().map(parseRowPath) : [rowPath];

  const getEditorInfo = (): EditorInfo | undefined =>
    editorText ? { text: editorText, rowPath } : undefined;

  const handleClick = (): void => {
    const nextArgument = getNextArgument(currentArgument);
    executePlan(
      planBatchArgument(
        createPlan(),
        getActionPaths(),
        stack,
        nextArgument,
        virtualRowsMap,
        getEditorInfo()
      )
    );
  };

  const hasArgument = currentArgument !== undefined;

  return (
    <span
      className="pill evidence-selector"
      data-has-argument={hasArgument ? "true" : undefined}
      onClick={handleClick}
      onMouseDown={preventEditorBlur}
      role="button"
      tabIndex={0}
      aria-label={`Evidence for ${nodeName}: ${getArgumentLabel(
        currentArgument
      )}`}
      title={getArgumentLabel(currentArgument)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      style={{ color: getArgumentColor(currentArgument) }}
    >
      {getArgumentSymbol(currentArgument)}
    </span>
  );
}
