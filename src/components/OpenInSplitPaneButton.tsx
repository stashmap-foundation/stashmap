import React from "react";
import { useMediaQuery } from "react-responsive";
import {
  useIsAddToNode,
  useNodeID,
  useViewPath,
  updateViewPathsAfterPaneInsert,
} from "../ViewContext";
import {
  useSplitPanes,
  usePaneIndex,
  usePaneNavigation,
} from "../SplitPanesContext";
import { IS_MOBILE } from "./responsive";
import { getRefTargetStack } from "../connections";
import { planUpdateViews, usePlanner } from "../planner";

export function OpenInSplitPaneButton(): JSX.Element | null {
  const { addPaneAt } = useSplitPanes();
  const paneIndex = usePaneIndex();
  const { stack } = usePaneNavigation();
  const viewPath = useViewPath();
  const [nodeID] = useNodeID();
  const isAddToNode = useIsAddToNode();
  const isMobile = useMediaQuery(IS_MOBILE);
  const { createPlan, executePlan } = usePlanner();

  if (isAddToNode || isMobile) {
    return null;
  }

  const onClick = (): void => {
    // Shift view paths for panes at and after the insertion point
    const insertIndex = paneIndex + 1;
    const plan = createPlan();
    const shiftedViews = updateViewPathsAfterPaneInsert(
      plan.views,
      insertIndex
    );
    executePlan(planUpdateViews(plan, shiftedViews));

    // Build the full path: pane navigation stack (without last element, which is the workspace root)
    // + all node IDs from the ViewPath (skip pane index at position 0)
    const paneStackWithoutWorkspace = stack.slice(0, -1);

    // For Reference nodes, use only the reference's path (context + target)
    const targetStack = getRefTargetStack(nodeID);
    if (targetStack) {
      addPaneAt(insertIndex, targetStack);
      return;
    }

    // Regular nodes: use viewPath node IDs
    const viewPathNodeIDs = viewPath
      .slice(1)
      .map((subPath) => (subPath as { nodeID: LongID | ID }).nodeID);
    const fullStack = [...paneStackWithoutWorkspace, ...viewPathNodeIDs];
    addPaneAt(insertIndex, fullStack);
  };

  return (
    <button
      type="button"
      aria-label="open in split pane"
      className="btn btn-borderless p-0"
      onClick={onClick}
      title="Open in new split pane"
    >
      <span className="iconsminds-left-to-right" />
    </button>
  );
}

export function OpenInSplitPaneButtonWithStack({
  stack,
}: {
  stack: (LongID | ID)[];
}): JSX.Element | null {
  const { addPaneAt } = useSplitPanes();
  const paneIndex = usePaneIndex();
  const isMobile = useMediaQuery(IS_MOBILE);
  const { createPlan, executePlan } = usePlanner();

  if (isMobile) {
    return null;
  }

  const onClick = (): void => {
    // Shift view paths for panes at and after the insertion point
    const insertIndex = paneIndex + 1;
    const plan = createPlan();
    const shiftedViews = updateViewPathsAfterPaneInsert(
      plan.views,
      insertIndex
    );
    executePlan(planUpdateViews(plan, shiftedViews));

    addPaneAt(insertIndex, stack);
  };

  return (
    <button
      type="button"
      aria-label="open in split pane"
      className="btn btn-borderless p-0"
      onClick={onClick}
      title="Open in new split pane"
    >
      <span className="iconsminds-left-to-right" />
    </button>
  );
}
