import React from "react";
import { deleteRelations, getRelations } from "../connections";
import {
  useViewPath,
  useViewKey,
  upsertRelations,
  getRelationsFromView,
  getLast,
  updateViewPathsAfterDisconnect,
  parseViewPath,
  calculateIndexFromNodeIndex,
  getParentView,
  getNodeIDFromView,
  getAvailableRelationsForNode,
  newRelations,
  getNodeFromView,
} from "../ViewContext";
import {
  switchOffMultiselect,
  useDeselectAllInView,
  useGetSelectedInView,
  useSelectedIndices,
  useTemporaryView,
} from "./TemporaryViewContext";
import { planUpdateViews, planUpsertRelations, usePlanner } from "../planner";
import { useData } from "../DataContext";

export function DisconnectBtn(): JSX.Element | null {
  const data = useData();
  const { createPlan, executePlan } = usePlanner();
  const { multiselectBtns, selection, setState } = useTemporaryView();
  const viewContext = useViewPath();
  const viewKey = useViewKey();
  const selectedIndices = useSelectedIndices();
  const selected = useGetSelectedInView()(viewKey);
  const deselectAllInView = useDeselectAllInView();
  if (selectedIndices.size === 0) {
    return null;
  }
  const onDisconnect = (): void => {
    const relations = getRelationsFromView(data, viewContext);
    if (!relations) {
      return;
    }
    const disconnectPlan = upsertRelations(createPlan(), viewContext, (rel) =>
      deleteRelations(rel, selectedIndices)
    );
    const finalPlan = selected.reduce((plan, path) => {
      const { nodeID, nodeIndex } = getLast(parseViewPath(path));
      return planUpdateViews(
        plan,
        plan.activeWorkspace,
        updateViewPathsAfterDisconnect(
          plan.views,
          nodeID,
          relations.id,
          nodeIndex
        )
      );
    }, disconnectPlan);
    executePlan(finalPlan);
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
  const relations = getRelations(
    data.knowledgeDBs,
    parentView.relations,
    data.user.publicKey,
    parentNodeID
  );
  if (!relations) {
    return null;
  }
  const relationType = relations.type;
  const index = calculateIndexFromNodeIndex(relations, nodeID, nodeIndex);
  if (index === undefined) {
    return null;
  }

  const onDisconnect = (): void => {
    const disconnectPlan = upsertRelations(
      createPlan(),
      parentPath,
      (rel): Relations => {
        return {
          ...rel,
          items: rel.items.delete(index),
        };
      }
    );
    const planAfterDisconnect = planUpdateViews(
      disconnectPlan,
      disconnectPlan.activeWorkspace,
      updateViewPathsAfterDisconnect(
        disconnectPlan.views,
        parentNodeID,
        relations.id,
        nodeIndex
      )
    );
    // add to node to not_relevant relations, in case relationtype is relevant, little relevant or maybe relevant
    const existingNotRelevantRelations = getAvailableRelationsForNode(
      planAfterDisconnect.knowledgeDBs,
      planAfterDisconnect.user.publicKey,
      parentNodeID
    ).find((r) => r.type === "not_relevant");
    const notRelevantRelations =
      existingNotRelevantRelations ||
      newRelations(
        parentNodeID,
        "not_relevant",
        planAfterDisconnect.user.publicKey
      );
    const planWithNotRelevantRelations = planUpsertRelations(
      planAfterDisconnect,
      notRelevantRelations
    );

    const finalPlan =
      relationType === "" ||
      relationType === "little_relevant" ||
      relationType === "maybe_relevant"
        ? planUpsertRelations(planWithNotRelevantRelations, {
            ...notRelevantRelations,
            items: notRelevantRelations.items.push(nodeID),
          })
        : planAfterDisconnect;
    executePlan(finalPlan);
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
