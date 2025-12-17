import React from "react";
import { SelectRelations } from "./SelectRelations";

export function NodeMenu(): JSX.Element {
  return (
    <div className="menu-layout w-100" style={{ height: "min-content" }}>
      <div className="d-flex align-items-center gap-2">
        <SelectRelations />
      </div>
    </div>
  );
}
