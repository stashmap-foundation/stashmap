import React from "react";
import {
  updateView,
  useNode,
  useNodeID,
  useViewKey,
  useViewPath,
  useDisplayText,
  isReferencedByView,
} from "../ViewContext";
import { useDeselectAllInView } from "./TemporaryViewContext";
import { getRelations, isReferenceNode } from "../connections";
import { REFERENCED_BY } from "../constants";
import { useData } from "../DataContext";
import { planUpdateViews, usePlanner } from "../planner";

type ChangeViewingMode = (
  viewingMode: "REFERENCED_BY" | undefined,
  expand: boolean
) => void;

export function useOnChangeViewingMode(): ChangeViewingMode {
  const data = useData();
  const viewPath = useViewPath();
  const { createPlan, executePlan } = usePlanner();
  const view = useNodeID()[1];
  const viewKey = useViewKey();
  const deselectAllInView = useDeselectAllInView();

  return (viewingMode: "REFERENCED_BY" | undefined, expand: boolean): void => {
    const plan = planUpdateViews(
      createPlan(),
      updateView(data.views, viewPath, {
        ...view,
        viewingMode,
        expanded: expand,
      })
    );
    executePlan(plan);
    deselectAllInView(viewKey);
  };
}

export function useOnToggleExpanded(): (expand: boolean) => void {
  const data = useData();
  const { createPlan, executePlan } = usePlanner();
  const viewPath = useViewPath();
  const view = useNodeID()[1];

  return (expand: boolean): void => {
    const plan = planUpdateViews(
      createPlan(),
      updateView(data.views, viewPath, {
        ...view,
        expanded: expand,
      })
    );
    executePlan(plan);
  };
}

export function ReferencedByToggle(): JSX.Element | null {
  const { knowledgeDBs, user } = useData();
  const [node] = useNode();
  const displayText = useDisplayText();
  const [, view] = useNodeID();
  const onChangeViewingMode = useOnChangeViewingMode();

  if (!node) {
    return null;
  }

  if (isReferenceNode(node)) {
    return null;
  }

  const referencedByRelations = getRelations(
    knowledgeDBs,
    REFERENCED_BY,
    user.publicKey,
    node.id
  );

  if (!referencedByRelations || referencedByRelations.items.size === 0) {
    return null;
  }

  const isInReferencedBy = isReferencedByView(view);
  const isExpanded = view.expanded === true;

  const onClick = (): void => {
    if (isInReferencedBy) {
      if (isExpanded) {
        onChangeViewingMode(undefined, true);
      } else {
        onChangeViewingMode("REFERENCED_BY", true);
      }
    } else {
      onChangeViewingMode("REFERENCED_BY", true);
    }
  };

  // Match old behavior: show "hide" only when both selected AND expanded
  const ariaLabel =
    isInReferencedBy && isExpanded
      ? `hide references to ${displayText}`
      : `show references to ${displayText}`;

  return (
    <button
      type="button"
      className={`btn btn-borderless p-0 ${isInReferencedBy ? "active" : ""}`}
      onClick={onClick}
      aria-label={ariaLabel}
      title={isInReferencedBy ? "Show children" : "Show references"}
    >
      <span className="iconsminds-link-2" />
      <span className="ms-1 font-size-small">
        {referencedByRelations.items.size}
      </span>
    </button>
  );
}
