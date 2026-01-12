import { Set } from "immutable";
import React from "react";
import { Dropdown } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { Button } from "../commons/Ui";
import { deleteRelations, isRemote, splitID } from "../connections";
import {
  updateViewPathsAfterDeleteNode,
  useNode,
  useNodeID,
} from "../ViewContext";
import { useData } from "../DataContext";
import { newDB } from "../knowledge";
import {
  Plan,
  planDeleteNode,
  planUpdateViews,
  planUpsertRelations,
  usePlanner,
} from "../planner";
import { isMutableNode } from "./TemporaryViewContext";
import { useWorkspaceContext } from "../WorkspaceContext";
import { ROOT } from "../types";

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

export function DeleteWorkspace({
  as,
  withCaption,
}: {
  as?: "button" | "item";
  withCaption?: boolean;
}): JSX.Element | null {
  const { activeWorkspace } = useWorkspaceContext();
  const data = useData();
  const { createPlan, executePlan } = usePlanner();
  const navigate = useNavigate();

  if (isRemote(splitID(activeWorkspace)[0], data.user.publicKey)) {
    return null;
  }

  const deleteCurrentWorkspace = (): void => {
    const planWithDisconnectedNode = disconnectNode(
      createPlan(),
      activeWorkspace
    );
    const planWithDeletedNode = planDeleteNode(
      planWithDisconnectedNode,
      activeWorkspace
    );

    executePlan(planWithDeletedNode);

    // If deleting active node, navigate to ROOT
    navigate(`/w/${ROOT}`);
  };

  if (as === "item") {
    return (
      <Dropdown.Item
        className="d-flex workspace-selection dropdown-item-border-bottom"
        tabIndex={0}
      >
        <span className="simple-icon-trash d-block dropdown-item-icon" />
        <div className="workspace-selection-text">Delete Workspace</div>
      </Dropdown.Item>
    );
  }
  return (
    <Button
      onClick={() => {
        deleteCurrentWorkspace();
      }}
      className="btn font-size-small"
      ariaLabel="delete workspace"
    >
      <span className="simple-icon-trash" />
      {withCaption && <span className="ms-2">Delete Workspace</span>}
    </Button>
  );
}

export function DeleteNode({
  withCaption,
  afterOnClick,
}: {
  withCaption?: boolean;
  afterOnClick: () => void;
}): JSX.Element | null {
  const data = useData();
  const [nodeID] = useNodeID();
  const [node] = useNode();
  const navigate = useNavigate();
  const { createPlan, executePlan } = usePlanner();

  if (!isMutableNode(node, data.user)) {
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
      <span className="simple-icon-trash" />
      {withCaption && <span className="ms-2">Delete</span>}
    </Button>
  );
}
