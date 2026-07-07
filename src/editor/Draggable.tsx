import React, { useEffect, useRef } from "react";
import { List } from "immutable";
import { ConnectableElement, useDrag } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import {
  useIsInSearchView,
  useCurrentRowID,
  useCurrentNode,
  useDisplayText,
  useIsViewingOtherUserContent,
  useCurrentEdge,
  getCurrentReferenceForRow,
  useRow,
} from "../rowModel";
import { useData } from "../DataContext";
import { isEmptySemanticID, nodePathLabel } from "../core/connections";
import { getBlockLink } from "../core/blockLink";
import { linkToInsertTarget } from "./linkOperations";
import { NOTE_TYPE, Node } from "./Node";
import { useDroppable, clearDropIndent } from "./DroppableContainer";
import {
  isEditableNode,
  useIsEditingOn,
  useIsSelected,
  useTemporaryView,
} from "./temporaryViewState";
import { isEditableElement, KeyboardMode } from "./keyboardNavigation";
import { usePaneIndex } from "../SplitPanesContext";

function nodePathText(
  data: Data,
  node: GraphNode | undefined,
  sourceId: SourceId
): string | undefined {
  if (!node) {
    return undefined;
  }
  return nodePathLabel(data.knowledgeDBs, node, sourceId);
}

function markDragDescendants(sourceViewKey: string): void {
  const prefix = `${sourceViewKey}:`;
  document.querySelectorAll(".item").forEach((el) => {
    const key = el.getAttribute("data-view-key");
    if (key && key.startsWith(prefix)) {
      el.classList.add("is-dragging-child");
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
    const [rowID] = useCurrentRowID();
    const node = useCurrentNode();
    const currentRow = useCurrentEdge();
    const { virtualType, viewKey } = row;
    const currentReference = getCurrentReferenceForRow(data, row);
    const displayText = useDisplayText();
    const isEmptyNode = isEmptySemanticID(rowID);
    const disableDrag = isNodeBeeingEdited || isEmptyNode;

    const [{ isDragging }, drag, preview] = useDrag({
      type: NOTE_TYPE,
      item: () => {
        clearDropIndent();
        markDragDescendants(rowViewKey);
        const draggedRows = selection.has(viewKey)
          ? rows
              .filter((candidate) => selection.has(candidate.viewKey))
              .toArray()
          : [row];
        const dragNode = node || currentRow;
        const dragNodeId =
          virtualType === "incoming" && currentReference
            ? currentReference.id
            : dragNode?.id;
        const blockLink =
          virtualType === "incoming"
            ? undefined
            : getBlockLink(currentRow, row.sourceId) ||
              getBlockLink(dragNode, row.sourceId);
        const insertTarget = linkToInsertTarget(data, blockLink);
        return {
          row,
          draggedRows,
          sourcePaneIndex: paneIndex,
          text: displayText,
          virtualType,
          isCopyDrag: copyDrag || undefined,
          nodeId: dragNodeId,
          linkText: nodePathText(data, dragNode, row.sourceId),
          insertTarget,
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
        data-row-index={rowIndex}
        data-row-depth={rowDepth}
        data-node-id={rowID}
        data-node-text={displayText}
        data-node-mutable={isEditableNode(node) ? "true" : "false"}
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

function DraggableSuggestion({
  className,
  rowViewKey,
  rowIndex,
  rowDepth,
  rows,
  isActiveRow,
  isSelected = false,
  onRowFocus,
  onRowClick,
}: {
  className?: string;
  rowViewKey: string;
  rowIndex: number;
  rowDepth: number;
  rows: List<Row>;
  isActiveRow: boolean;
  isSelected?: boolean;
  onRowFocus: (key: string, index: number, mode: KeyboardMode) => void;
  onRowClick?: (e: React.MouseEvent, viewKey: string) => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const row = useRow();
  const paneIndex = usePaneIndex();
  const { viewKey } = row;
  const { selection } = useTemporaryView();
  const currentRow = useCurrentEdge();
  const node = useCurrentNode();
  const displayText = useDisplayText();
  const data = useData();

  const [{ isDragging }, drag, preview] = useDrag({
    type: NOTE_TYPE,
    item: () => {
      clearDropIndent();
      const draggedRows = selection.has(viewKey)
        ? rows.filter((candidate) => selection.has(candidate.viewKey)).toArray()
        : [row];
      const blockLink = getBlockLink(currentRow, row.sourceId);
      return {
        row,
        draggedRows,
        sourcePaneIndex: paneIndex,
        text: displayText,
        virtualType: row.virtualType,
        isSuggestion: true,
        nodeId: node?.id,
        insertTarget: linkToInsertTarget(data, blockLink),
      };
    },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
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
      className={`item suggestion-item ${isDragging ? "is-dragging" : ""} ${
        className || ""
      }`}
      data-row-focusable="true"
      data-view-key={rowViewKey}
      data-row-index={rowIndex}
      data-row-depth={rowDepth}
      data-node-id={currentRow?.id || node?.id}
      data-node-text={displayText}
      data-node-mutable={isEditableNode(node) ? "true" : "false"}
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
      <Node className={className} isSuggestion rows={rows} />
    </div>
  );
}

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
  const [rowID] = useCurrentRowID();
  const isSuggestion = virtualType === "suggestion";
  const isCopyDrag =
    virtualType === "incoming" ||
    virtualType === "version" ||
    virtualType === "search";
  const isInSearchView = useIsInSearchView();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const selected = useIsSelected();
  const rowDepth = row.depth;
  const paneIndex = usePaneIndex();
  const isActiveRow = activeRowKey === viewKey;
  const isEmptyNode = isEmptySemanticID(rowID);

  const isReadonly = isInSearchView || isViewingOtherUserContent;

  const [{ dragDirection }, drop] = useDroppable({
    row,
    ref,
    nextRow,
    rows,
    paneIndex,
  });

  // Action rows are buttons in row position: one interaction (click) —
  // no drag, no drop, no keyboard row focus. As the first virtual row
  // they carry the footer's dotted separator.
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

  if (isSuggestion) {
    return (
      <div
        className={`visible-on-hover suggestion-item-container${
          row.isFirstVirtual ? " first-virtual" : ""
        }`}
      >
        <DraggableSuggestion
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
