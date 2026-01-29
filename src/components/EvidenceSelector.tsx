import React, { useState } from "react";
import { TYPE_COLORS } from "../constants";
import { useUpdateArgument } from "./useUpdateArgument";
import { useNode, useDisplayText } from "../ViewContext";
import { preventEditorBlurIfSameNode } from "./AddNode";
import { useEditorText } from "./EditorTextContext";

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
  if (argument === "confirms") return "✓";
  if (argument === "contra") return "✗";
  return "○";
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
  const { currentArgument, setArgument, isVisible } = useUpdateArgument();
  const [node] = useNode();
  const versionedDisplayText = useDisplayText();
  const editorTextContext = useEditorText();
  const editorText = editorTextContext?.text ?? "";

  if (!isVisible) return null;

  const nodeName =
    editorText.trim() || versionedDisplayText || node?.text || "item";

  const handleClick = (): void => {
    setArgument(getNextArgument(currentArgument));
  };

  const hasArgument = currentArgument !== undefined;

  return (
    <span
      className="evidence-selector"
      data-has-argument={hasArgument ? "true" : undefined}
      onClick={handleClick}
      onMouseDown={preventEditorBlurIfSameNode}
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
      style={{
        cursor: "pointer",
        color: getArgumentColor(currentArgument, isHovered),
        transition: "color 0.15s ease",
        fontSize: "1rem",
        fontWeight: "bold",
        marginRight: "4px",
      }}
    >
      {getArgumentSymbol(currentArgument)}
    </span>
  );
}
