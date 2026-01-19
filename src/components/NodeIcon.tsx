import React from "react";

export function NodeIcon({
  nodeType,
}: {
  nodeType: KnowNode["type"];
}): JSX.Element | null {
  if (nodeType === "reference") {
    return (
      <span
        className="iconsminds-link reference-icon"
        title="Reference"
        style={{
          marginRight: "6px",
          fontSize: "0.9em",
          color: "#6c8ebf",
        }}
      />
    );
  }
  return null;
}
