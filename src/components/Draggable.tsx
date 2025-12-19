import React, { useRef } from "react";
import { ConnectableElement, useDrag } from "react-dnd";
import {
  ViewPath,
  useIsAddToNode,
  useIsDiffItem,
  useViewPath,
  getParentView,
  upsertRelations,
  useNodeID,
  newRelations,
  getNodeIDFromView,
} from "../ViewContext";
import { NOTE_TYPE, Node } from "./Node";
import { useDroppable } from "./DroppableContainer";
import { ToggleEditing, useIsEditingOn } from "./TemporaryViewContext";
import { RemoveColumnButton } from "./RemoveColumnButton";
import { ChangeColumnWidth } from "./ChangeColumnWidth";
import { DisconnectNodeBtn } from "./DisconnectBtn";
import { JoinProjectButton } from "../JoinProjext";
import { FullscreenButton } from "./FullscreenButton";
import { addRelationToRelations, shortID } from "../connections";
import { useData } from "../DataContext";
import { usePlanner, planUpsertRelations } from "../planner";
import { newDB } from "../knowledge";

export type DragItemType = {
  path: ViewPath;
};

type DraggableProps = {
  className?: string;
};

const Draggable = React.forwardRef<HTMLDivElement, DraggableProps>(
  ({ className }: DraggableProps, ref): JSX.Element => {
    const path = useViewPath();
    const isAddToNode = useIsAddToNode();
    const isNodeBeeingEdited = useIsEditingOn();
    const disableDrag = isAddToNode || isNodeBeeingEdited;

    const [{ isDragging }, drag] = useDrag({
      type: NOTE_TYPE,
      item: () => {
        return { path };
      },
      collect: (monitor) => ({
        isDragging: !!monitor.isDragging(),
      }),
      canDrag: () => !disableDrag,
    });

    drag(ref as ConnectableElement);
    return (
      <div ref={ref} className={`item ${isDragging ? "is-dragging" : ""}`}>
        <Node className={className} />
      </div>
    );
  }
);

export function DraggableNote(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="visible-on-hover">
      <Draggable ref={ref} />
      <div className="on-hover-menu right">
        <ToggleEditing />
        <ChangeColumnWidth />
        <JoinProjectButton />
        <span className="always-visible">
          <RemoveColumnButton />
          <FullscreenButton />
        </span>
      </div>
    </div>
  );
}

function AcceptDiffItemButton(): JSX.Element {
  const viewPath = useViewPath();
  const [nodeID] = useNodeID();
  const { createPlan, executePlan } = usePlanner();
  const parentPath = getParentView(viewPath);

  const onClick = (): void => {
    if (!parentPath) return;
    const plan = upsertRelations(createPlan(), parentPath, (relations) =>
      addRelationToRelations(relations, nodeID)
    );
    executePlan(plan);
  };

  return (
    <button
      type="button"
      aria-label="accept item"
      className="btn btn-borderless p-0"
      onClick={onClick}
      title="Add to my list"
    >
      <span style={{ fontSize: "1.4rem", color: "green" }}>✓</span>
    </button>
  );
}

function DeclineDiffItemButton(): JSX.Element {
  const data = useData();
  const viewPath = useViewPath();
  const [nodeID] = useNodeID();
  const { createPlan, executePlan } = usePlanner();
  const parentPath = getParentView(viewPath);

  const onClick = (): void => {
    if (!parentPath) return;

    // Get the parent node ID (this is the HEAD for the not_relevant relation)
    const [parentNodeID] = getNodeIDFromView(data, parentPath);
    const headID = shortID(parentNodeID);

    // Find existing "not_relevant" relation for this head, or create new one
    const myRelations = data.knowledgeDBs.get(
      data.user.publicKey,
      newDB()
    ).relations;
    const existingNotRelevant = myRelations.find(
      (r) => r.head === headID && r.type === "not_relevant"
    );

    const notRelevantRelation =
      existingNotRelevant ||
      newRelations(parentNodeID, "not_relevant", data.user.publicKey);

    // Add only this item to the not_relevant relation
    const updatedRelation = addRelationToRelations(notRelevantRelation, nodeID);
    const plan = planUpsertRelations(createPlan(), updatedRelation);
    executePlan(plan);
  };

  return (
    <button
      type="button"
      aria-label="decline item"
      className="btn btn-borderless p-0"
      onClick={onClick}
      title="Mark as not relevant"
    >
      <span style={{ fontSize: "1.4rem" }}>×</span>
    </button>
  );
}

function DiffItemActions(): JSX.Element {
  return (
    <div className="on-hover-menu right">
      <span className="always-visible">
        <AcceptDiffItemButton />
        <DeclineDiffItemButton />
        <FullscreenButton />
      </span>
    </div>
  );
}

function DraggableDiffItem({ className }: { className?: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const path = useViewPath();

  // Diff items are draggable but NOT droppable
  const [{ isDragging }, drag] = useDrag({
    type: NOTE_TYPE,
    item: () => {
      return { path, isDiffItem: true };
    },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  });

  drag(ref as ConnectableElement);

  return (
    <div
      ref={ref}
      className={`item diff-item ${isDragging ? "is-dragging" : ""} ${
        className || ""
      }`}
    >
      <Node className={className} isDiffItem />
    </div>
  );
}

export function ListItem({
  index,
  treeViewPath,
}: {
  index: number;
  treeViewPath: ViewPath;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const isDiffItem = useIsDiffItem();

  // Diff items are NOT droppable
  const [{ dragDirection }, drop] = useDroppable({
    destination: treeViewPath,
    index,
    ref,
  });

  if (isDiffItem) {
    // Diff items: draggable but NOT droppable, show accept/decline buttons
    return (
      <div className="visible-on-hover diff-item-container">
        <DraggableDiffItem />
        <DiffItemActions />
      </div>
    );
  }

  drop(ref);
  const className = `${dragDirection === 1 ? "dragging-over-top" : ""} ${
    dragDirection === -1 ? "dragging-over-bottom" : ""
  }`;
  return (
    <div className="visible-on-hover">
      <Draggable ref={ref} className={className} />
      <div className="on-hover-menu right">
        <ToggleEditing />
        <span className="always-visible">
          <DisconnectNodeBtn />
          <FullscreenButton />
        </span>
      </div>
    </div>
  );
}
