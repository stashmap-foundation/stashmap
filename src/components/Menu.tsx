import React from "react";
import { useMediaQuery } from "react-responsive";
import {
  ToggleEditing,
  ToggleMultiselect,
  useTemporaryView,
} from "./TemporaryViewContext";
import { DisconnectBtn } from "./DisconnectBtn";
import { SelectRelations } from "./SelectRelations";
import { useNode, useViewKey } from "../ViewContext";
import { IS_MOBILE } from "./responsive";
import { getRelations } from "../connections";
import { useData } from "../DataContext";

function BaseMenu({
  showMultiselectToggle = false,
  alwaysOneSelected = false,
  showMobileEditing = false,
}: {
  showMultiselectToggle?: boolean;
  alwaysOneSelected?: boolean;
  showMobileEditing?: boolean;
}): JSX.Element {
  const temporaryView = useTemporaryView();
  const viewKey = useViewKey();
  const isMobile = useMediaQuery(IS_MOBILE);
  const isMultiSelectToggled = temporaryView.multiselectBtns.has(viewKey);
  return (
    <div className="flex-row-space-between font-size-big">
      <div className="flex-row-start p-1">
        {showMultiselectToggle && (
          <>
            <ToggleMultiselect />
            <div className="vertical-line ms-2 me-2" />
          </>
        )}
        {!isMultiSelectToggled && (
          <div className="menu-layout">
            <SelectRelations alwaysOneSelected={alwaysOneSelected} />
            {showMobileEditing && isMobile && <ToggleEditing />}
          </div>
        )}
      </div>
      {isMultiSelectToggled && (
        <div className="flex-row-end p-1">
          <DisconnectBtn />
        </div>
      )}
    </div>
  );
}

export function DetailViewMenu(): JSX.Element {
  return <BaseMenu showMultiselectToggle alwaysOneSelected showMobileEditing />;
}

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
