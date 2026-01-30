import React from "react";
import { useMediaQuery } from "react-responsive";
import {
  useNodeID,
  useViewPath,
  updateViewPathsAfterPaneInsert,
} from "../ViewContext";
import {
  useSplitPanes,
  usePaneIndex,
  usePaneStack,
  usePaneAuthor,
} from "../SplitPanesContext";
import { IS_MOBILE } from "./responsive";
import { getRefTargetInfo } from "../connections";
import { planUpdateViews, usePlanner } from "../planner";
import { useData } from "../DataContext";
import { ROOT } from "../types";

export function OpenInSplitPaneButton(): JSX.Element | null {
  const { addPaneAt } = useSplitPanes();
  const paneIndex = usePaneIndex();
  const stack = usePaneStack();
  const currentAuthor = usePaneAuthor();
  const viewPath = useViewPath();
  const [nodeID] = useNodeID();
  const isMobile = useMediaQuery(IS_MOBILE);
  const { createPlan, executePlan } = usePlanner();
  const { knowledgeDBs, user } = useData();

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

    const paneStackWithoutWorkspace = stack.slice(0, -1);

    const refInfo = getRefTargetInfo(nodeID, knowledgeDBs, user.publicKey);
    if (refInfo) {
      addPaneAt(
        insertIndex,
        refInfo.stack,
        refInfo.author,
        refInfo.rootRelation
      );
      return;
    }

    const viewPathNodeIDs = viewPath
      .slice(1)
      .map((subPath) => (subPath as { nodeID: LongID | ID }).nodeID);
    const fullStack = [...paneStackWithoutWorkspace, ...viewPathNodeIDs];
    addPaneAt(insertIndex, fullStack, currentAuthor);
  };

  return (
    <button
      type="button"
      aria-label="open in split pane"
      className="btn btn-icon"
      onClick={onClick}
      title="Open in new split pane"
    >
      <span aria-hidden="true">»</span>
    </button>
  );
}

export function OpenInSplitPaneButtonWithStack({
  stack,
}: {
  stack: ID[];
}): JSX.Element | null {
  const { addPaneAt } = useSplitPanes();
  const paneIndex = usePaneIndex();
  const author = usePaneAuthor();
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

    addPaneAt(insertIndex, stack, author);
  };

  return (
    <button
      type="button"
      aria-label="open in split pane"
      className="btn btn-icon"
      onClick={onClick}
      title="Open in new split pane"
    >
      <span aria-hidden="true">»</span>
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
    addPaneAt(insertIndex, [ROOT], user.publicKey);
  };

  return (
    <button
      type="button"
      aria-label="Open new pane"
      className="btn btn-icon"
      onClick={onClick}
      title="Open new pane"
    >
      <span aria-hidden="true">»</span>
    </button>
  );
}
