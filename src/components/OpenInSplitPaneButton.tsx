import React from "react";
import { useMediaQuery } from "react-responsive";
import {
  useViewPath,
  updateViewPathsAfterPaneInsert,
  buildPaneTarget,
  useCurrentEdge,
} from "../ViewContext";
import {
  useSplitPanes,
  usePaneIndex,
  usePaneStack,
} from "../SplitPanesContext";
import { IS_MOBILE } from "./responsive";
import { planUpdateViews, usePlanner } from "../planner";
import { useData } from "../DataContext";

export function OpenInSplitPaneButton(): JSX.Element | null {
  const { addPaneAt } = useSplitPanes();
  const paneIndex = usePaneIndex();
  const stack = usePaneStack();
  const viewPath = useViewPath();
  const data = useData();
  const isMobile = useMediaQuery(IS_MOBILE);
  const { createPlan, executePlan } = usePlanner();
  const currentItem = useCurrentEdge();

  if (isMobile) {
    return null;
  }

  const onClick = (): void => {
    const insertIndex = paneIndex + 1;
    const plan = createPlan();
    const shiftedViews = updateViewPathsAfterPaneInsert(
      plan.views,
      insertIndex
    );
    executePlan(planUpdateViews(plan, shiftedViews));

    const target = buildPaneTarget(data, viewPath, stack, currentItem);
    addPaneAt(
      insertIndex,
      target.stack,
      target.author,
      target.rootNodeId,
      target.scrollToId
    );
  };

  return (
    <button
      type="button"
      data-node-action="open-split-pane"
      aria-label="open in split pane"
      className="btn btn-icon"
      onClick={onClick}
      title="Open in new split pane"
    >
      <span aria-hidden="true">⍈</span>
    </button>
  );
}

export function NewPaneButton(): JSX.Element | null {
  const { addPaneAt } = useSplitPanes();
  const paneIndex = usePaneIndex();
  const { user } = useData();
  const isMobile = useMediaQuery(IS_MOBILE);
  const { createPlan, executePlan } = usePlanner();

  if (isMobile) {
    return null;
  }

  const onClick = (): void => {
    const insertIndex = paneIndex + 1;
    const plan = createPlan();
    const shiftedViews = updateViewPathsAfterPaneInsert(
      plan.views,
      insertIndex
    );
    executePlan(planUpdateViews(plan, shiftedViews));
    addPaneAt(insertIndex, [], user.publicKey);
  };

  return (
    <button
      type="button"
      data-pane-action="new-pane"
      aria-label="Open new pane"
      className="btn btn-icon"
      onClick={onClick}
      title="Open new pane"
    >
      <span aria-hidden="true">◫</span>
    </button>
  );
}
