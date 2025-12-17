import React, { useRef } from "react";
import { ConnectableElement, useDrag } from "react-dnd";
import { ViewPath, useIsAddToNode, useViewPath } from "../ViewContext";
import { NOTE_TYPE, Node } from "./Node";
import { useDroppable } from "./DroppableContainer";
import { ToggleEditing, useIsEditingOn } from "./TemporaryViewContext";
import { RemoveColumnButton } from "./RemoveColumnButton";
import { ChangeColumnWidth } from "./ChangeColumnWidth";
import { DisconnectNodeBtn } from "./DisconnectBtn";
import { JoinProjectButton } from "../JoinProjext";
import { FullscreenButton } from "./FullscreenButton";

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

export function ListItem({
  index,
  treeViewPath,
}: {
  index: number;
  treeViewPath: ViewPath;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  const [{ dragDirection }, drop] = useDroppable({
    destination: treeViewPath,
    index,
    ref,
  });
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
