import React from "react";
import { useMediaQuery } from "react-responsive";
import {
  useNodeID,
  useViewPath,
  updateViewPathsAfterPaneInsert,
  getEffectiveAuthor,
  useRelation,
} from "../ViewContext";
import {
  useSplitPanes,
  usePaneIndex,
  usePaneStack,
} from "../SplitPanesContext";
import { IS_MOBILE } from "./responsive";
import { getRefTargetInfo } from "../connections";
import { planUpdateViews, usePlanner } from "../planner";
import { useData } from "../DataContext";

export function OpenInSplitPaneButton(): JSX.Element | null {
  const { addPaneAt } = useSplitPanes();
  const paneIndex = usePaneIndex();
  const stack = usePaneStack();
  const viewPath = useViewPath();
  const data = useData();
  const [nodeID] = useNodeID();
  const isMobile = useMediaQuery(IS_MOBILE);
  const { createPlan, executePlan } = usePlanner();
  const { knowledgeDBs } = data;
  const relation = useRelation();

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

    const paneStackWithoutRoot = stack.slice(0, -1);

    const effectiveAuthor = getEffectiveAuthor(data, viewPath);
    const refInfo = getRefTargetInfo(nodeID, knowledgeDBs, effectiveAuthor);
    if (refInfo) {
      addPaneAt(
        insertIndex,
        refInfo.stack,
        refInfo.author,
        refInfo.rootRelation,
        refInfo.scrollTo
      );
      return;
    }

    const viewPathNodeIDs = viewPath
      .slice(1)
      .map((subPath) => (subPath as { nodeID: LongID | ID }).nodeID);
    const fullStack = [...paneStackWithoutRoot, ...viewPathNodeIDs];
    addPaneAt(
      insertIndex,
      fullStack,
      getEffectiveAuthor(data, viewPath),
      relation?.id
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
