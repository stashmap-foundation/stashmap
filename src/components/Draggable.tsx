import React, { useRef } from "react";
import { ConnectableElement, useDrag } from "react-dnd";
import {
  ViewPath,
  useIsAddToNode,
  useIsDiffItem,
  useIsInReferencedByView,
  useViewPath,
} from "../ViewContext";
import { NOTE_TYPE, Node } from "./Node";
import { useDroppable } from "./DroppableContainer";
import { ToggleEditing, useIsEditingOn } from "./TemporaryViewContext";
import { JoinProjectButton } from "../JoinProjext";
import { FullscreenButton } from "./FullscreenButton";
import { OpenInSplitPaneButton } from "./OpenInSplitPaneButton";
import { RelevanceSelector } from "./RelevanceSelector";

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
        <JoinProjectButton />
        <span className="always-visible">
          <FullscreenButton />
          <OpenInSplitPaneButton />
        </span>
      </div>
    </div>
  );
}

function DiffItemActions(): JSX.Element {
  return (
    <div className="on-hover-menu right">
      <span className="always-visible">
        <RelevanceSelector isDiffItem />
        <FullscreenButton />
        <OpenInSplitPaneButton />
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
  const isInReferencedByView = useIsInReferencedByView();

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

  // Referenced By view: items are draggable but NOT droppable (don't register drop)
  if (!isInReferencedByView) {
    drop(ref);
  }

  const className = `${dragDirection === 1 ? "dragging-over-top" : ""} ${
    dragDirection === -1 ? "dragging-over-bottom" : ""
  }`;
  return (
    <div className="visible-on-hover">
      <Draggable ref={ref} className={className} />
      <div className="on-hover-menu right">
        <ToggleEditing />
        <span className="always-visible">
          <RelevanceSelector />
          <FullscreenButton />
          <OpenInSplitPaneButton />
        </span>
      </div>
    </div>
  );
}
