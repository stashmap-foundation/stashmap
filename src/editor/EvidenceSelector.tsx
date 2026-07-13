import React from "react";
import { TYPE_COLORS } from "../core/constants";
import { useUpdateArgument } from "./useUpdateArgument";
import { useCurrentNode, useDisplayText, useRow } from "../rowModel";
import { usePlanner } from "../planner";
import { preventEditorBlur } from "./AddNode";
import { useEditorText } from "./EditorTextContext";
import { useTemporaryView } from "./temporaryViewState";
import { planBatchArgument, EditorInfo } from "./batchOperations";
import { nodeText, spansText } from "../core/nodeSpans";
import { usePaneTreeResult } from "./TreeView";

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
  const row = useRow();
  const { virtualType } = row;
  const isAcceptableVirtual =
    virtualType === "incoming" || virtualType === "version";
  const { viewKey } = row;
  const currentNode = useCurrentNode();
  const versionedDisplayText = useDisplayText();
  const editorTextContext = useEditorText();
  const editorSpans = editorTextContext?.spans;
  const editorText = spansText(editorSpans ?? []);
  const { createPlan, executePlan } = usePlanner();
  const { selection } = useTemporaryView();
  const rows = usePaneTreeResult()?.rows.toArray() ?? [row];

  if (!isVisible && !isAcceptableVirtual) return null;

  const nodeName =
    editorText.trim() ||
    versionedDisplayText ||
    (currentNode ? nodeText(currentNode) : "") ||
    "row";

  const isInSelection = selection.has(viewKey) && selection.size > 1;

  const getActionRows = (): Row[] =>
    isInSelection
      ? rows.filter((selectedRow) => selection.has(selectedRow.viewKey))
      : [row];

  const getEditorInfo = (): EditorInfo | undefined =>
    editorSpans ? { spans: editorSpans, viewKey } : undefined;

  const handleClick = (): void => {
    const nextArgument = getNextArgument(currentArgument);
    executePlan(
      planBatchArgument(
        createPlan(),
        getActionRows(),
        nextArgument,
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
