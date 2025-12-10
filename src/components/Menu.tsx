import React from "react";
import { SelectRelations } from "./SelectRelations";

export function NodeMenu(): JSX.Element | null {
  return (
    <div className="menu-layout w-100" style={{ height: "min-content" }}>
      <SelectRelations />
    </div>
  );
}
