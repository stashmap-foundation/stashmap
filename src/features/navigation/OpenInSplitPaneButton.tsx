import React from "react";
import { useMediaQuery } from "react-responsive";
import { buildPaneTarget } from "../../rows/resolveRow";
import {
  planUpdateViews,
  updateRowPathsAfterPaneInsert,
} from "../../session/views";
import { useCurrentEdge, useRowPath } from "../tree/RowContext";
import { useSplitPanes, usePaneIndex, usePaneStack } from "./SplitPanesContext";
import { IS_MOBILE } from "./responsive";
import { usePlanner } from "../../planner";
import { useData } from "../../DataContext";

export function OpenInSplitPaneButton(): JSX.Element | null {
  const { addPaneAt } = useSplitPanes();
  const paneIndex = usePaneIndex();
  const stack = usePaneStack();
  const rowPath = useRowPath();
  const data = useData();
  const isMobile = useMediaQuery(IS_MOBILE);
  const { createPlan, executePlan } = usePlanner();
  const currentRow = useCurrentEdge();

  if (isMobile) {
    return null;
  }

  const onClick = (): void => {
    const insertIndex = paneIndex + 1;
    const plan = createPlan();
    const shiftedViews = updateRowPathsAfterPaneInsert(plan.views, insertIndex);
    executePlan(planUpdateViews(plan, shiftedViews));

    const target = buildPaneTarget(data, rowPath, stack, currentRow);
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
    const shiftedViews = updateRowPathsAfterPaneInsert(plan.views, insertIndex);
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
