import React from "react";

export function NodeIcon({
  nodeType,
}: {
  nodeType: KnowNode["type"];
}): JSX.Element | null {
  if (nodeType === "reference") {
    return (
      <span className="reference-icon" title="Reference" aria-hidden="true">
        ⤶
      </span>
    );
  }
  return null;
}
