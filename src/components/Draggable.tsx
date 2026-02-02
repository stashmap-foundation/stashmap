import React, { useRef } from "react";
import { ConnectableElement, useDrag } from "react-dnd";
import {
  ViewPath,
  useIsDiffItem,
  useIsInReferencedByView,
  useViewPath,
  useNodeID,
} from "../ViewContext";
import { useIsViewingOtherUserContent } from "../SplitPanesContext";
import { isEmptyNodeID, isAbstractRefId } from "../connections";
import { NOTE_TYPE, Node } from "./Node";
import { useDroppable } from "./DroppableContainer";
import { useIsEditingOn } from "./TemporaryViewContext";

export type DragItemType = {
  path: ViewPath;
};

type DraggableProps = {
  className?: string;
};

const Draggable = React.forwardRef<HTMLDivElement, DraggableProps>(
  ({ className }: DraggableProps, ref): JSX.Element => {
    const path = useViewPath();
    const isNodeBeeingEdited = useIsEditingOn();
    const [nodeID] = useNodeID();
    const isEmptyNode = isEmptyNodeID(nodeID);
    const isAbstractRef = isAbstractRefId(nodeID);
    const disableDrag = isNodeBeeingEdited || isEmptyNode || isAbstractRef;

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
      className={`item diff-item ${isDragging ? "is-dragging" : ""} ${className || ""
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
  const isViewingOtherUserContent = useIsViewingOtherUserContent();

  const isReadonly = isInReferencedByView || isViewingOtherUserContent;

  // Root node (index 0) can't have siblings above it
  const isRoot = index === 0;

  const [{ dragDirection }, drop] = useDroppable({
    destination: treeViewPath,
    index,
    ref,
    isRoot,
  });

  if (isDiffItem) {
    // Diff items: draggable but NOT droppable
    return (
      <div className="visible-on-hover diff-item-container">
        <DraggableDiffItem />
      </div>
    );
  }

  // Readonly views: items are draggable but NOT droppable (don't register drop)
  if (!isReadonly) {
    drop(ref);
  }

  const className = `${dragDirection === 1 ? "dragging-over-top" : ""} ${dragDirection === -1 ? "dragging-over-bottom" : ""
    }`;
  return (
    <div className="visible-on-hover">
      <Draggable ref={ref} className={className} />
    </div>
  );
}
