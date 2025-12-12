import React from "react";
import { SelectRelations } from "./SelectRelations";
import { FullscreenButton } from "./FullscreenButton";

export function NodeMenu(): JSX.Element | null {
  return (
    <div className="menu-layout w-100" style={{ height: "min-content" }}>
      <div className="d-flex align-items-center gap-2">
        <SelectRelations />
        <FullscreenButton />
      </div>
    </div>
  );
}
