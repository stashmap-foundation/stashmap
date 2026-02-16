import React, { useState } from "react";
import { TYPE_COLORS } from "../constants";
import { useUpdateArgument } from "./useUpdateArgument";
import {
  ViewPath,
  useViewPath,
  parseViewPath,
  useNode,
  useDisplayText,
  useViewKey,
  useRelationItem,
  useVirtualItemsMap,
} from "../ViewContext";
import { usePlanner } from "../planner";
import { usePaneStack } from "../SplitPanesContext";
import { preventEditorBlur } from "./AddNode";
import { useEditorText } from "./EditorTextContext";
import { useTemporaryView } from "./TemporaryViewContext";
import { planBatchArgument, EditorInfo } from "./batchOperations";

function getArgumentColor(argument: Argument, isHovered: boolean): string {
  if (argument === "confirms") {
    return TYPE_COLORS.confirms;
  }
  if (argument === "contra") {
    return TYPE_COLORS.contra;
  }
  return isHovered ? "var(--base00)" : "var(--base01)";
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
  const [isHovered, setIsHovered] = useState(false);
  const { currentArgument, isVisible } = useUpdateArgument();
  const relationItem = useRelationItem();
  const virtualType = relationItem?.virtualType;
  const isAcceptableVirtual =
    virtualType === "incoming" ||
    virtualType === "occurrence" ||
    virtualType === "version";
  const viewPath = useViewPath();
  const viewKey = useViewKey();
  const [node] = useNode();
  const versionedDisplayText = useDisplayText();
  const editorTextContext = useEditorText();
  const editorText = editorTextContext?.text ?? "";
  const stack = usePaneStack();
  const { createPlan, executePlan } = usePlanner();
  const { selection } = useTemporaryView();
  const virtualItemsMap = useVirtualItemsMap();

  if (!isVisible && !isAcceptableVirtual) return null;

  const nodeName =
    editorText.trim() || versionedDisplayText || node?.text || "item";

  const isInSelection = selection.has(viewKey) && selection.size > 1;

  const getActionPaths = (): ViewPath[] =>
    isInSelection ? selection.toArray().map(parseViewPath) : [viewPath];

  const getEditorInfo = (): EditorInfo | undefined =>
    editorText ? { text: editorText, viewPath } : undefined;

  const handleClick = (): void => {
    const nextArgument = getNextArgument(currentArgument);
    executePlan(
      planBatchArgument(
        createPlan(),
        getActionPaths(),
        stack,
        nextArgument,
        virtualItemsMap,
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
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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
      style={{ color: getArgumentColor(currentArgument, isHovered) }}
    >
      {getArgumentSymbol(currentArgument)}
    </span>
  );
}
