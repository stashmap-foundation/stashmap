import React from "react";
import { DeedsatsLogo } from "../DeedsatsLogo";

export function NodeIcon({ node }: { node: KnowNode }): JSX.Element | null {
  if (node.type === "project") {
    return (
      <DeedsatsLogo
        styles={{
          maxHeight: "40px",
          position: "relative",
          top: "-5px",
          marginRight: "5px",
        }}
      />
    );
  }
  if (node.type === "reference") {
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
