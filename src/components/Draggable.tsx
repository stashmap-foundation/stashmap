import React, { useRef } from "react";
import { ConnectableElement, useDrag } from "react-dnd";
import {
  ViewPath,
  useIsSuggestion,
  useIsInReferencedByView,
  useViewPath,
  useViewKey,
  useNodeID,
  useNode,
  useDisplayText,
  useIsViewingOtherUserContent,
} from "../ViewContext";
import { isEmptyNodeID, isAbstractRefId } from "../connections";
import { NOTE_TYPE, Node, INDENTATION } from "./Node";
import { useDroppable } from "./DroppableContainer";
import { isMutableNode, useIsEditingOn } from "./TemporaryViewContext";
import { isEditableElement, KeyboardMode } from "./keyboardNavigation";

export type DragItemType = {
  path: ViewPath;
};

type DraggableProps = {
  className?: string;
  rowViewKey?: string;
  rowIndex?: number;
  rowDepth?: number;
  isActiveRow?: boolean;
  onRowFocus?: (key: string, index: number, mode: KeyboardMode) => void;
};

const Draggable = React.forwardRef<HTMLDivElement, DraggableProps>(
  (
    {
      className,
      rowViewKey = "",
      rowIndex = 0,
      rowDepth = 0,
      isActiveRow = false,
      onRowFocus = () => {},
    }: DraggableProps,
    ref
  ): JSX.Element => {
    const path = useViewPath();
    const isNodeBeeingEdited = useIsEditingOn();
    const [nodeID] = useNodeID();
    const [node] = useNode();
    const displayText = useDisplayText();
    const isEmptyNode = isEmptyNodeID(nodeID);
    const disableDrag = isNodeBeeingEdited || isEmptyNode;

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
    const handleRowMouseEnter = (e: React.MouseEvent<HTMLDivElement>): void => {
      if (isEditableElement(document.activeElement)) {
        return;
      }
      onRowFocus(rowViewKey, rowIndex, "normal");
      const row = e.currentTarget;
      if (document.activeElement !== row) {
        row.focus();
      }
    };

    return (
      <div
        ref={ref}
        className={`item ${isDragging ? "is-dragging" : ""}`}
        data-row-focusable="true"
        data-view-key={rowViewKey}
        data-row-index={rowIndex}
        data-row-depth={rowDepth}
        data-node-id={nodeID}
        data-node-text={displayText}
        data-node-mutable={isMutableNode(node) ? "true" : "false"}
        role="treeitem"
        aria-label={displayText}
        aria-selected={isActiveRow}
        tabIndex={isActiveRow ? 0 : -1}
        onMouseMove={handleRowMouseEnter}
        onFocusCapture={(e) =>
          onRowFocus(
            rowViewKey,
            rowIndex,
            isEditableElement(e.target) ? "insert" : "normal"
          )
        }
      >
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

function DraggableSuggestion({
  className,
  rowViewKey,
  rowIndex,
  rowDepth,
  isActiveRow,
  onRowFocus,
}: {
  className?: string;
  rowViewKey: string;
  rowIndex: number;
  rowDepth: number;
  isActiveRow: boolean;
  onRowFocus: (key: string, index: number, mode: KeyboardMode) => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const path = useViewPath();
  const [nodeID] = useNodeID();
  const [node] = useNode();
  const displayText = useDisplayText();
  const isAbstractRef = isAbstractRefId(nodeID);

  const [{ isDragging }, drag] = useDrag({
    type: NOTE_TYPE,
    item: () => {
      return { path, isSuggestion: true };
    },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  });

  if (!isAbstractRef) {
    drag(ref as ConnectableElement);
  }

  const handleRowMouseEnter = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (isEditableElement(document.activeElement)) {
      return;
    }
    onRowFocus(rowViewKey, rowIndex, "normal");
    const row = e.currentTarget;
    if (document.activeElement !== row) {
      row.focus();
    }
  };

  return (
    <div
      ref={ref}
      className={`item suggestion-item ${isDragging ? "is-dragging" : ""} ${
        className || ""
      }`}
      data-row-focusable="true"
      data-view-key={rowViewKey}
      data-row-index={rowIndex}
      data-row-depth={rowDepth}
      data-node-id={nodeID}
      data-node-text={displayText}
      data-node-mutable={isMutableNode(node) ? "true" : "false"}
      role="treeitem"
      aria-label={displayText}
      aria-selected={isActiveRow}
      tabIndex={isActiveRow ? 0 : -1}
      onMouseMove={handleRowMouseEnter}
      onFocusCapture={(e) =>
        onRowFocus(
          rowViewKey,
          rowIndex,
          isEditableElement(e.target) ? "insert" : "normal"
        )
      }
    >
      <Node className={className} isSuggestion />
    </div>
  );
}

export function ListItem({
  index,
  treeViewPath,
  prevDepth,
  nextDepth,
  activeRowKey,
  onRowFocus,
}: {
  index: number;
  treeViewPath: ViewPath;
  prevDepth?: number;
  nextDepth?: number;
  activeRowKey: string;
  onRowFocus: (key: string, index: number, mode: KeyboardMode) => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const viewKey = useViewKey();
  const viewPath = useViewPath();
  const isSuggestion = useIsSuggestion();
  const isInReferencedByView = useIsInReferencedByView();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const rowDepth = viewPath.length - 1;
  const isActiveRow = activeRowKey === viewKey;

  const isReadonly = isInReferencedByView || isViewingOtherUserContent;

  const isRoot = index === 0;

  const [{ dragDirection, targetDepth }, drop] = useDroppable({
    destination: treeViewPath,
    index,
    ref,
    isRoot,
    prevDepth,
    nextDepth,
  });

  if (isSuggestion) {
    return (
      <div className="visible-on-hover suggestion-item-container">
        <DraggableSuggestion
          rowViewKey={viewKey}
          rowIndex={index}
          rowDepth={rowDepth}
          isActiveRow={isActiveRow}
          onRowFocus={onRowFocus}
        />
      </div>
    );
  }

  if (!isReadonly) {
    drop(ref);
  }

  const className = `${dragDirection === 1 ? "dragging-over-top" : ""} ${
    dragDirection === -1 ? "dragging-over-bottom" : ""
  }`;
  const dropIndentLeft =
    targetDepth !== undefined ? 5 + (targetDepth - 1) * INDENTATION : undefined;
  const style =
    dropIndentLeft !== undefined
      ? ({ "--drop-indent-left": `${dropIndentLeft}px` } as React.CSSProperties)
      : undefined;
  return (
    <div className="visible-on-hover" style={style}>
      <Draggable
        ref={ref}
        className={className}
        rowViewKey={viewKey}
        rowIndex={index}
        rowDepth={rowDepth}
        isActiveRow={isActiveRow}
        onRowFocus={onRowFocus}
      />
    </div>
  );
}
