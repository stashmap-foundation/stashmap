import React from "react";
import { useMediaQuery } from "react-responsive";
import { SelectRelations } from "./SelectRelations";
import { useNode } from "../ViewContext";
import { IS_MOBILE } from "./responsive";
import { getRelations } from "../connections";
import { useData } from "../DataContext";

function useIsActionable(): boolean {
  const [node, view] = useNode();
  const { knowledgeDBs, user } = useData();
  if (!node) {
    return false;
  }
  const nRelations =
    getRelations(knowledgeDBs, view.relations, user.publicKey, node.id)?.items
      .size || 0;
  // TODO: if there are other versions it's also actionable
  return nRelations > 0; // || isShowVersions()
}

function ReadonlyMenu(): JSX.Element | null {
  if (!useIsActionable()) {
    return null;
  }
  return (
    <div className="menu-layout w-100" style={{ height: "min-content" }}>
      <SelectRelations readonly />
    </div>
  );
}

export function NodeMenu(): JSX.Element | null {
  // show ReadonlyMenu on mobile because there is no tree view
  const isMobile = useMediaQuery(IS_MOBILE);
  if (isMobile) {
    return <ReadonlyMenu />;
  }
  return (
    <div className="menu-layout w-100" style={{ height: "min-content" }}>
      <SelectRelations />
    </div>
  );
}
