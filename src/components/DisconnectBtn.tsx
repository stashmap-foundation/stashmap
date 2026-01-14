import React from "react";
import {
  switchOffMultiselect,
  useDeselectAllInView,
  useSelectedIndices,
  useTemporaryView,
} from "./TemporaryViewContext";
import { useViewKey } from "../ViewContext";
import { useDisconnectMultiple, useDisconnectNode } from "./useUpdateRelevance";

export function DisconnectBtn(): JSX.Element | null {
  const { multiselectBtns, selection, setState } = useTemporaryView();
  const viewKey = useViewKey();
  const selectedIndices = useSelectedIndices();
  const deselectAllInView = useDeselectAllInView();

  const { disconnect, selectedCount } = useDisconnectMultiple(
    selectedIndices,
    () => {
      deselectAllInView(viewKey);
      setState(switchOffMultiselect(multiselectBtns, selection, viewKey));
    }
  );

  if (selectedCount === 0) {
    return null;
  }

  return (
    <button
      type="button"
      className="btn btn-borderless p-0"
      onClick={disconnect}
      aria-label={`disconnect ${selectedCount} selected nodes`}
    >
      <span style={{ fontSize: "1.4rem" }}>×</span>
    </button>
  );
}

export function DisconnectNodeBtn(): JSX.Element | null {
  const { disconnect, isVisible, nodeText } = useDisconnectNode();

  if (!isVisible) {
    return null;
  }

  return (
    <button
      type="button"
      className="btn btn-borderless p-0"
      onClick={disconnect}
      aria-label={`disconnect node ${nodeText}`}
    >
      <span style={{ fontSize: "1.4rem" }}>×</span>
    </button>
  );
}
