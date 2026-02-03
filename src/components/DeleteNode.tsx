import { Set } from "immutable";
import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../commons/Ui";
import { deleteRelations } from "../connections";
import {
  updateViewPathsAfterDeleteNode,
  useNode,
  useNodeID,
} from "../ViewContext";
import { newDB } from "../knowledge";
import {
  Plan,
  planDeleteNode,
  planUpdateViews,
  planUpsertRelations,
  usePlanner,
} from "../planner";
import { isMutableNode } from "./TemporaryViewContext";

function disconnectNode(plan: Plan, toDisconnect: LongID | ID): Plan {
  const myDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  return myDB.relations.reduce((rdx, relation) => {
    const toDelete = relation.items.reduce((indices, item, idx) => {
      if (item.nodeID === toDisconnect) {
        return indices.add(idx);
      }
      return indices;
    }, Set<number>());
    if (toDelete.size === 0) {
      return rdx;
    }
    return planUpsertRelations(rdx, deleteRelations(relation, toDelete));
  }, planUpdateViews(plan, updateViewPathsAfterDeleteNode(plan.views, toDisconnect)));
}

export function DeleteNode({
  withCaption,
  afterOnClick,
}: {
  withCaption?: boolean;
  afterOnClick: () => void;
}): JSX.Element | null {
  const [nodeID] = useNodeID();
  const [node] = useNode();
  const navigate = useNavigate();
  const { createPlan, executePlan } = usePlanner();

  if (!isMutableNode(node)) {
    return null;
  }
  const deleteNode = (): void => {
    const planWithDisconnectedNode = disconnectNode(createPlan(), nodeID);
    const planWithDeletedNode = planDeleteNode(
      planWithDisconnectedNode,
      nodeID
    );
    executePlan(planWithDeletedNode);
    navigate("/");
  };

  return (
    <Button
      onClick={() => {
        deleteNode();
        afterOnClick();
      }}
      className="btn font-size-small"
      ariaLabel="delete node"
    >
      <span aria-hidden="true">×</span>
      {withCaption && <span className="ms-2">Delete</span>}
    </Button>
  );
}
