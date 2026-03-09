import React from "react";
import { useMediaQuery } from "react-responsive";
import {
  useCurrentItemID,
  useViewPath,
  updateViewPathsAfterPaneInsert,
  getEffectiveAuthor,
  useCurrentRelation,
  getItemIDsForViewPath,
  getCurrentReferenceForView,
  useCurrentEdge,
} from "../ViewContext";
import {
  useSplitPanes,
  usePaneIndex,
  usePaneStack,
} from "../SplitPanesContext";
import { IS_MOBILE } from "./responsive";
import { getRefLinkTargetInfo, getRefTargetInfo } from "../connections";
import { planUpdateViews, usePlanner } from "../planner";
import { useData } from "../DataContext";

export function OpenInSplitPaneButton(): JSX.Element | null {
  const { addPaneAt } = useSplitPanes();
  const paneIndex = usePaneIndex();
  const stack = usePaneStack();
  const viewPath = useViewPath();
  const data = useData();
  const [nodeID] = useCurrentItemID();
  const isMobile = useMediaQuery(IS_MOBILE);
  const { createPlan, executePlan } = usePlanner();
  const { knowledgeDBs } = data;
  const relation = useCurrentRelation();
  const virtualType = useCurrentEdge()?.virtualType;
  const currentReference = getCurrentReferenceForView(
    data,
    viewPath,
    stack,
    virtualType
  );

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
    const refInfo = currentReference
      ? virtualType === "version"
        ? getRefTargetInfo(
            currentReference.id,
            knowledgeDBs,
            effectiveAuthor
          )
        : getRefLinkTargetInfo(
            currentReference.id,
            knowledgeDBs,
            effectiveAuthor
          )
      : getRefTargetInfo(nodeID, knowledgeDBs, effectiveAuthor);
    if (refInfo) {
      addPaneAt(
        insertIndex,
        refInfo.stack,
        refInfo.author,
        refInfo.rootRelation,
        refInfo.scrollToId
      );
      return;
    }

    const viewPathNodeIDs = getItemIDsForViewPath(data, viewPath);
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
