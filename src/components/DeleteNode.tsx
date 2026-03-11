import { Set } from "immutable";
import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../commons/Ui";
import { deleteRelations, getRelationItemSemanticID } from "../connections";
import {
  updateViewPathsAfterDeleteItem,
  useCurrentRelation,
  useCurrentRowID,
  useViewPath,
} from "../ViewContext";
import { usePaneStack } from "../SplitPanesContext";
import { newDB } from "../knowledge";
import {
  Plan,
  planUpdateViews,
  planUpsertRelations,
  usePlanner,
} from "../planner";
import { isEditableRelation } from "./TemporaryViewContext";
import { planDeleteNodeFromView } from "../treeMutations";

function disconnectNode(plan: Plan, toDisconnect: LongID | ID): Plan {
  const myDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  return myDB.relations.reduce((rdx, relation) => {
    const toDelete = relation.items.reduce((indices, item, idx) => {
      if (
        getRelationItemSemanticID(plan.knowledgeDBs, item, relation.author) ===
        toDisconnect
      ) {
        return indices.add(idx);
      }
      return indices;
    }, Set<number>());
    if (toDelete.size === 0) {
      return rdx;
    }
    return planUpsertRelations(rdx, deleteRelations(relation, toDelete));
  }, planUpdateViews(plan, updateViewPathsAfterDeleteItem(plan.views, toDisconnect)));
}

export function DeleteNode({
  withCaption,
  afterOnClick,
}: {
  withCaption?: boolean;
  afterOnClick: () => void;
}): JSX.Element | null {
  const [itemID] = useCurrentRowID();
  const relation = useCurrentRelation();
  const viewPath = useViewPath();
  const stack = usePaneStack();
  const navigate = useNavigate();
  const { createPlan, executePlan } = usePlanner();

  if (!isEditableRelation(relation)) {
    return null;
  }
  const deleteNode = (): void => {
    const planWithDeletedNode = planDeleteNodeFromView(
      disconnectNode(createPlan(), itemID),
      viewPath,
      stack
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
