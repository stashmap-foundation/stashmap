import React from "react";
import { Set } from "immutable";
import { getRelations, markItemsAsNotRelevant, shortID } from "../connections";
import { REFERENCED_BY } from "../constants";
import {
  useViewPath,
  useViewKey,
  upsertRelations,
  getRelationForView,
  getLast,
  calculateIndexFromNodeIndex,
  getParentView,
  getNodeIDFromView,
  getNodeFromView,
} from "../ViewContext";
import {
  switchOffMultiselect,
  useDeselectAllInView,
  useSelectedIndices,
  useTemporaryView,
} from "./TemporaryViewContext";
import { usePlanner } from "../planner";
import { useData } from "../DataContext";
import { usePaneNavigation } from "../SplitPanesContext";

export function DisconnectBtn(): JSX.Element | null {
  const data = useData();
  const { stack } = usePaneNavigation();
  const { createPlan, executePlan } = usePlanner();
  const { multiselectBtns, selection, setState } = useTemporaryView();
  const viewContext = useViewPath();
  const viewKey = useViewKey();
  const selectedIndices = useSelectedIndices();
  const deselectAllInView = useDeselectAllInView();
  if (selectedIndices.size === 0) {
    return null;
  }
  const onDisconnect = (): void => {
    const relations = getRelationForView(data, viewContext, stack);
    if (!relations) {
      return;
    }
    // Mark items as "not_relevant" instead of deleting them
    const disconnectPlan = upsertRelations(
      createPlan(),
      viewContext,
      stack,
      (rel) => markItemsAsNotRelevant(rel, selectedIndices)
    );
    executePlan(disconnectPlan);
    deselectAllInView(viewKey);
    setState(switchOffMultiselect(multiselectBtns, selection, viewKey));
  };

  return (
    <button
      type="button"
      className="btn btn-borderless p-0"
      onClick={onDisconnect}
      aria-label={`disconnect ${selectedIndices.size} selected nodes`}
    >
      <span style={{ fontSize: "1.4rem" }}>×</span>
    </button>
  );
}

export function DisconnectNodeBtn(): JSX.Element | null {
  const data = useData();
  const { stack } = usePaneNavigation();
  const { createPlan, executePlan } = usePlanner();
  const viewPath = useViewPath();
  const { nodeID, nodeIndex } = getLast(viewPath);
  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    return null;
  }
  const [parentNodeID, parentView] = getNodeIDFromView(data, parentPath);
  if (!parentNodeID || !parentView) {
    return null;
  }
  // Referenced By items are readonly - can't disconnect them
  if (parentView.relations === REFERENCED_BY) {
    return null;
  }
  const relations = getRelations(
    data.knowledgeDBs,
    parentView.relations,
    data.user.publicKey,
    parentNodeID
  );

  // DEBUG - filter for specific node
  const debugRelations = "e4eda09c-1176-48fc-b578-84473bf4354e";
  if (parentView.relations && shortID(parentView.relations) === debugRelations) {
    console.log("DisconnectNodeBtn DEBUG", {
      nodeID,
      parentNodeID,
      parentViewRelations: parentView.relations,
      relationsFound: !!relations,
      relations,
    });
  }

  if (!relations) {
    return null;
  }
  const index = calculateIndexFromNodeIndex(relations, nodeID, nodeIndex);
  if (index === undefined) {
    return null;
  }

  const onDisconnect = (): void => {
    // Mark item as "not_relevant" instead of deleting it
    const disconnectPlan = upsertRelations(
      createPlan(),
      parentPath,
      stack,
      (rel) => markItemsAsNotRelevant(rel, Set([index]))
    );
    executePlan(disconnectPlan);
  };

  return (
    <button
      type="button"
      className="btn btn-borderless p-0"
      onClick={onDisconnect}
      aria-label={`disconnect node ${getNodeFromView(data, viewPath)[0]?.text}`}
    >
      <span style={{ fontSize: "1.4rem" }}>×</span>
    </button>
  );
}
