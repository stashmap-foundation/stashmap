import React from "react";
import { useMediaQuery } from "react-responsive";
import { updateView, useNode, useNodeID, useViewPath } from "../ViewContext";
import { IS_MOBILE } from "./responsive";
import { useData } from "../DataContext";
import { planUpdateViews, usePlanner } from "../planner";

export function ChangeColumnWidth(): JSX.Element | null {
  const isMobile = useMediaQuery(IS_MOBILE);
  const { views } = useData();
  const { createPlan, executePlan } = usePlanner();
  const viewContext = useViewPath();
  const view = useNodeID()[1];
  const [node] = useNode();
  if (!views) {
    return null;
  }
  if (isMobile) {
    return null;
  }
  const onIncreaseColumnWidth = (): void => {
    const plan = createPlan();
    executePlan(
      planUpdateViews(
        plan,
        plan.activeWorkspace,
        updateView(views, viewContext, {
          ...view,
          width: view.width + 1,
        })
      )
    );
  };
  const onDecreaseColumnWidth = (): void => {
    const newPlan = createPlan();
    executePlan(
      planUpdateViews(
        newPlan,
        newPlan.activeWorkspace,
        updateView(views, viewContext, {
          ...view,
          width: Math.max(view.width - 1, 1),
        })
      )
    );
  };
  const suffix = node ? ` of ${node.text}` : "";
  return (
    <>
      {view.width > 1 && (
        <button
          type="button"
          aria-label={`decrease width${suffix}`}
          disabled={view.width === 1}
          className="btn btn-borderless"
          onClick={onDecreaseColumnWidth}
        >
          <span className="iconsminds-arrow-left" />
        </button>
      )}
      <button
        type="button"
        aria-label={`increase width${suffix}`}
        className="btn btn-borderless"
        onClick={onIncreaseColumnWidth}
      >
        <span className="iconsminds-arrow-right" />
      </button>
    </>
  );
}
