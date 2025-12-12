import React from "react";
import { SelectRelations } from "./SelectRelations";
import { FullscreenButton } from "./FullscreenButton";
import { useViewPath } from "../ViewContext";

export function NodeMenu(): JSX.Element | null {
  const viewPath = useViewPath();
  const showFullscreenButton = viewPath.length > 1;
  return (
    <div className="menu-layout w-100" style={{ height: "min-content" }}>
      <div className="d-flex align-items-center gap-2">
        <SelectRelations />
        {showFullscreenButton && <FullscreenButton />}
      </div>
    </div>
  );
}
