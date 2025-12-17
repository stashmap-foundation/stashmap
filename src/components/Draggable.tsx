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
} from "../ViewContext";
import { NOTE_TYPE, Node } from "./Node";
import { useDroppable } from "./DroppableContainer";
import { ToggleEditing, useIsEditingOn } from "./TemporaryViewContext";
import { RemoveColumnButton } from "./RemoveColumnButton";
import { ChangeColumnWidth } from "./ChangeColumnWidth";
import { DisconnectNodeBtn } from "./DisconnectBtn";
import { JoinProjectButton } from "../JoinProjext";
import { FullscreenButton } from "./FullscreenButton";
import { addRelationToRelations } from "../connections";
import { useData } from "../DataContext";
import { usePlanner } from "../planner";

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
      <div className="on-hover-menu left">
        <RemoveColumnButton />
      </div>
      <div className="on-hover-menu right">
        <ToggleEditing />
        <ChangeColumnWidth />
        <JoinProjectButton />
        <span className="always-visible">
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
      className="btn btn-borderless"
      onClick={onClick}
      title="Add to my list"
    >
      <span className="simple-icon-check" />
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
    // Add to "not_relevant" relation type
    const plan = upsertRelations(createPlan(), parentPath, (relations) => {
      // Create a new "not_relevant" relation if needed, or add to existing
      const notRelevantRelations = {
        ...relations,
        type: "not_relevant",
        id: newRelations(relations.head, "not_relevant", data.user.publicKey)
          .id,
      };
      return addRelationToRelations(notRelevantRelations, nodeID);
    });
    executePlan(plan);
  };

  return (
    <button
      type="button"
      aria-label="decline item"
      className="btn btn-borderless"
      onClick={onClick}
      title="Mark as not relevant"
    >
      <span className="simple-icon-close" />
    </button>
  );
}

function DiffItemActions(): JSX.Element {
  return (
    <div className="on-hover-menu right diff-item-actions">
      <AcceptDiffItemButton />
      <DeclineDiffItemButton />
      <span className="always-visible">
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
          <FullscreenButton />
        </span>
        <DisconnectNodeBtn />
      </div>
    </div>
  );
}
