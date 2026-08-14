import React, { useEffect, useRef } from "react";
import { List } from "immutable";
import { ConnectableElement, useDrag } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import {
  useIsInSearchView,
  useDisplayText,
  useIsViewingOtherUserContent,
  useRow,
  rowID,
  viewPathToString,
} from "../rowModel";
import { useData } from "../DataContext";
import { isEmptyNodeID } from "../core/connections";
import { searchInsertTarget } from "../localSearch";
import { NOTE_TYPE, Node } from "./Node";
import { useDroppable, clearDropIndent } from "./DroppableContainer";
import {
  useIsEditingOn,
  useIsSelected,
  useTemporaryView,
} from "./temporaryViewState";
import { isEditableElement, KeyboardMode } from "./keyboardNavigation";
import { usePaneIndex } from "../SplitPanesContext";

function markDragDescendants(source: Row, rows: List<Row>): void {
  const descendants = new globalThis.Set(
    rows
      .slice(source.index + 1)
      .takeWhile((row) => row.depth > source.depth)
      .map((row) => row.viewKey)
      .toArray()
  );
  document.querySelectorAll(".item").forEach((element) => {
    const key = element.getAttribute("data-view-key");
    if (key && descendants.has(key)) {
      element.classList.add("is-dragging-child");
    }
  });
}

function clearDragDescendants(): void {
  document.querySelectorAll(".is-dragging-child").forEach((el) => {
    el.classList.remove("is-dragging-child");
  });
}

type DraggableProps = {
  className?: string;
  copyDrag?: boolean;
  rowViewKey?: string;
  rowIndex?: number;
  rowDepth?: number;
  rows: List<Row>;
  isActiveRow?: boolean;
  isSelected?: boolean;
  onRowFocus?: (key: string, index: number, mode: KeyboardMode) => void;
  onRowClick?: (e: React.MouseEvent, viewKey: string) => void;
};

const Draggable = React.forwardRef<HTMLDivElement, DraggableProps>(
  (
    {
      className,
      copyDrag = false,
      rowViewKey = "",
      rowIndex = 0,
      rowDepth = 0,
      rows,
      isActiveRow = false,
      isSelected = false,
      onRowFocus = () => {},
      onRowClick,
    }: DraggableProps,
    ref
  ): JSX.Element => {
    const row = useRow();
    const paneIndex = usePaneIndex();
    const { selection } = useTemporaryView();
    const data = useData();
    const isNodeBeeingEdited = useIsEditingOn();
    const { virtualType, viewKey } = row;
    const displayText = useDisplayText();
    const isEmptyNode = isEmptyNodeID(rowID(row));
    const disableDrag = isNodeBeeingEdited || isEmptyNode;

    const [{ isDragging }, drag, preview] = useDrag({
      type: NOTE_TYPE,
      item: () => {
        clearDropIndent();
        markDragDescendants(row, rows);
        const draggedRows = selection.has(viewKey)
          ? rows
              .filter((candidate) => selection.has(candidate.viewKey))
              .toArray()
          : [row];
        const dragNodeId =
          row.rowType === "occurrence" ? row.occurrence.id : row.node.id;
        return {
          row,
          draggedRows,
          sourcePaneIndex: paneIndex,
          text: displayText,
          isCopyDrag: copyDrag || undefined,
          nodeId: dragNodeId,
          targetId:
            row.rowType === "occurrence"
              ? row.occurrence.target ?? row.occurrence.id
              : undefined,
          insertTarget:
            row.incomingTarget ??
            (virtualType === "search"
              ? searchInsertTarget(data, row.node, row.sourceId)
              : undefined),
        };
      },
      collect: (monitor) => ({
        isDragging: !!monitor.isDragging(),
      }),
      canDrag: () => !disableDrag,
      end: () => {
        clearDragDescendants();
      },
    });

    useEffect(() => {
      preview(getEmptyImage(), { captureDraggingState: true });
    }, [preview]);

    drag(ref as ConnectableElement);

    const handleClick = (e: React.MouseEvent): void => {
      if (!onRowClick) {
        return;
      }
      const target = e.target as HTMLElement;
      if (isEditableElement(target)) {
        return;
      }
      if (
        target.closest(
          "button, a, input, textarea, select, [role='button'], [data-node-action], [data-pane-action]"
        )
      ) {
        return;
      }
      onRowClick(e, rowViewKey);
    };

    return (
      <div
        ref={ref}
        className={`item ${isDragging ? "is-dragging" : ""}`}
        data-row-focusable="true"
        data-view-key={rowViewKey}
        data-view-path={viewPathToString(row.viewPath)}
        data-row-index={rowIndex}
        data-row-depth={rowDepth}
        data-node-id={
          row.rowType === "occurrence" ? row.occurrence.id : row.node.id
        }
        data-node-text={displayText}
        data-node-mutable="true"
        data-selected={isSelected ? "true" : undefined}
        role="treeitem"
        aria-label={displayText}
        aria-selected={isActiveRow}
        tabIndex={isActiveRow ? 0 : -1}
        onFocusCapture={(e) =>
          onRowFocus(
            rowViewKey,
            rowIndex,
            isEditableElement(e.target) ? "insert" : "normal"
          )
        }
        onClick={handleClick}
        onKeyDown={() => {}}
      >
        <Node className={className} rows={rows} />
      </div>
    );
  }
);

export function ListItem({
  row,
  rows,
  nextRow,
  activeRowKey,
  onRowFocus,
  onRowClick,
}: {
  row: Row;
  rows: List<Row>;
  nextRow: Row | undefined;
  activeRowKey: string;
  onRowFocus: (key: string, index: number, mode: KeyboardMode) => void;
  onRowClick?: (e: React.MouseEvent, viewKey: string) => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const { viewKey, virtualType } = row;
  const isCopyDrag = virtualType === "incoming" || virtualType === "search";
  const isInSearchView = useIsInSearchView();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const selected = useIsSelected();
  const rowDepth = row.depth;
  const isActiveRow = activeRowKey === viewKey;
  const isEmptyNode = isEmptyNodeID(rowID(row));

  const isReadonly = isInSearchView || isViewingOtherUserContent;

  const [{ dragDirection }, drop] = useDroppable({
    row,
    ref,
    nextRow,
    rows,
  });

  if (row.action) {
    return (
      <div
        className={`visible-on-hover${
          row.isFirstVirtual ? " first-virtual" : ""
        }`}
      >
        <Node rows={rows} />
      </div>
    );
  }

  if (!isReadonly && !isCopyDrag && !isEmptyNode) {
    drop(ref);
  }

  const className =
    dragDirection === -1 && !isEmptyNode ? "dragging-over-bottom" : "";
  return (
    <div
      className={`visible-on-hover${
        row.isFirstVirtual ? " first-virtual" : ""
      }`}
    >
      <Draggable
        ref={ref}
        className={className}
        copyDrag={isCopyDrag}
        rowViewKey={viewKey}
        rowIndex={row.index}
        rowDepth={rowDepth}
        rows={rows}
        isActiveRow={isActiveRow}
        isSelected={selected}
        onRowFocus={onRowFocus}
        onRowClick={onRowClick}
      />
    </div>
  );
}
