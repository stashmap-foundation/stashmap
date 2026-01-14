import React from "react";
import { VersionSelector, ReferencedByToggle } from "./SelectRelations";
import { TypeFilterButton } from "./TypeFilterButton";

export function LeftMenu(): JSX.Element {
  return (
    <div className="left-menu">
      <VersionSelector />
      <ReferencedByToggle />
      <TypeFilterButton />
    </div>
  );
}
