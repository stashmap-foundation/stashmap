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
  // No argument set - show inactive, slightly highlighted on hover
  return isHovered ? "#b0b0b0" : TYPE_COLORS.inactive;
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

  return (
    <div
      className="evidence-selector"
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 6px",
        borderRadius: "12px",
        backgroundColor: "rgba(0,0,0,0.04)",
        cursor: "pointer",
      }}
      title={getArgumentLabel(currentArgument)}
    >
      <span
        onClick={handleClick}
        onMouseDown={preventEditorBlurIfSameNode}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        role="button"
        tabIndex={0}
        aria-label={`Evidence for ${nodeName}: ${getArgumentLabel(
          currentArgument
        )}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        style={{
          width: "18px",
          height: "18px",
          borderRadius: "50%",
          backgroundColor: getArgumentColor(currentArgument, isHovered),
          transition: "all 0.15s ease",
        }}
      />
    </div>
  );
}
