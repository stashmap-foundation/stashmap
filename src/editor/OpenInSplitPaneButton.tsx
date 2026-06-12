import React from "react";
import { useMediaQuery } from "react-responsive";
import { LOCAL } from "../core/nodeRef";
import {
  updateViewPathsAfterPaneInsert,
  buildPaneTarget,
  useRow,
} from "../rowModel";
import { useSplitPanes, usePaneIndex } from "../SplitPanesContext";
import { IS_MOBILE } from "./responsive";
import { planUpdateViews, usePlanner } from "../planner";
import { useData } from "../DataContext";

export function OpenInSplitPaneButton(): JSX.Element | null {
  const { addPaneAt } = useSplitPanes();
  const paneIndex = usePaneIndex();
  const data = useData();
  const isMobile = useMediaQuery(IS_MOBILE);
  const { createPlan, executePlan } = usePlanner();
  const row = useRow();

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

    const target = buildPaneTarget(data, row);
    addPaneAt(
      insertIndex,
      target.sourceId,
      target.rootNodeId,
      target.scrollToId,
      target.documentId
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
    addPaneAt(insertIndex, LOCAL);
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
