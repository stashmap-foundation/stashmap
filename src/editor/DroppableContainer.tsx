import React, { RefObject, useEffect, useRef } from "react";
import { List, OrderedSet } from "immutable";
import { ConnectDropTarget, DropTargetMonitor, useDrop } from "react-dnd";
import { NativeTypes } from "react-dnd-html5-backend";
import { dnd, getDropDestinationFromRows } from "../dnd";
import { planMaterializeComputedRow } from "../core/plan";
import { calendarFeedUrl } from "../core/ical";
import { getWorkspaceNode } from "../core/knowledge";
import {
  Plan,
  AddToParentTarget,
  planSetTemporarySelectionState,
  planUpdatePanes,
  usePlanner,
} from "../planner";
import { useTemporaryView } from "./temporaryViewState";
import { buildPaneTarget } from "../rowModel";
import { NOTE_TYPE, INDENTATION } from "./Node";
import { usePaneIndex } from "../SplitPanesContext";
import {
  MarkdownImportFile,
  parseMarkdownImportFiles,
  planImportMarkdownFilesAtEmptyRoot,
  planPasteMarkdownTrees,
} from "./FileDropZone";

type DragItemType = {
  row: Row;
  draggedRows: Row[];
  sourcePaneIndex: number;
  isSuggestion?: boolean;
  isCopyDrag?: boolean;
  virtualType: Row["virtualType"];
  nodeId?: ID;
  targetId?: ID;
  linkText?: string;
  insertTarget?: AddToParentTarget;
};

type NativeFileDropItem = {
  files?: File[] | FileList;
};

type DropItemType = DragItemType | NativeFileDropItem;

function isDragItem(
  item: DropItemType | null | undefined
): item is DragItemType {
  return item !== null && item !== undefined && "row" in item;
}

function isNativeFileDropItem(item: DropItemType): item is NativeFileDropItem {
  return "files" in item;
}

type DroppableContainerProps = {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
};

function isMarkdownFile(file: File): boolean {
  return /\.(md|markdown)$/iu.test(file.name);
}

function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    /* eslint-disable functional/immutable-data */
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
    /* eslint-enable functional/immutable-data */
  });
}

function getFilesFromNativeDrop(item: NativeFileDropItem): File[] {
  const { files } = item;
  if (!files) {
    return [];
  }
  if (Array.isArray(files)) {
    return files;
  }
  return Array.from(files);
}

function calcDragDirection(
  ref: RefObject<HTMLElement>,
  monitor: DropTargetMonitor<DropItemType>,
  row: Row
): number | undefined {
  if (!monitor.isOver({ shallow: true })) {
    return undefined;
  }
  if (!ref.current) {
    return undefined;
  }
  const item = monitor.getItem();
  if (isDragItem(item)) {
    const sourceStr = item.row.viewKey;
    const targetStr = row.viewKey;
    if (targetStr === sourceStr || targetStr.startsWith(`${sourceStr}:`)) {
      return undefined;
    }
  }
  return -1;
}

const INDICATOR_GUTTER_WIDTH = 20;
const INDENT_MARGIN = 5;

const DEPTH_STEP = INDENTATION;

/* eslint-disable functional/immutable-data */
const globalDragIndent = {
  anchorX: undefined as number | undefined,
  targetDepth: undefined as number | undefined,
  lastDirection: undefined as number | undefined,
  activeElement: undefined as HTMLElement | undefined,
};

function applyDropIndent(el: HTMLElement, depth: number): void {
  const TOGGLE_WIDTH = 20;
  const left =
    INDICATOR_GUTTER_WIDTH +
    INDENT_MARGIN +
    (depth - 1) * INDENTATION +
    TOGGLE_WIDTH;
  el.style.setProperty("--drop-indent-left", `${left}px`);
  const innerNode = el.querySelector(".inner-node");
  if (innerNode instanceof HTMLElement) {
    innerNode.style.setProperty("--drop-indent-left", `${left}px`);
  }
}

export function setDropIndentDepth(depth: number): void {
  // eslint-disable-next-line functional/immutable-data
  globalDragIndent.targetDepth = depth;
}

export function clearDropIndent(): void {
  const prev = globalDragIndent.activeElement;
  if (prev) {
    prev.style.removeProperty("--drop-indent-left");
    const innerNode = prev.querySelector(".inner-node");
    if (innerNode instanceof HTMLElement) {
      innerNode.style.removeProperty("--drop-indent-left");
    }
  }
  globalDragIndent.anchorX = undefined;
  globalDragIndent.targetDepth = undefined;
  globalDragIndent.lastDirection = undefined;
  globalDragIndent.activeElement = undefined;
}
/* eslint-enable functional/immutable-data */

export function computeDepthLimits(
  currentDepth: number,
  nextDepth: number | undefined,
  nextViewKey: string | undefined,
  sourceViewKey: string | undefined,
  rootDepth: number
): { minDepth: number; maxDepth: number } {
  const maxDepth = currentDepth + 1;
  if (nextDepth === undefined) {
    return { minDepth: rootDepth + 1, maxDepth };
  }
  if (
    sourceViewKey &&
    nextViewKey &&
    (nextViewKey === sourceViewKey ||
      nextViewKey.startsWith(`${sourceViewKey}:`))
  ) {
    return { minDepth: rootDepth + 1, maxDepth };
  }
  return { minDepth: nextDepth, maxDepth };
}

function getRootDepth(rows: List<Row>): number {
  const firstRow = rows.first();
  if (!firstRow) {
    return 0;
  }
  return firstRow.parentRef ? firstRow.depth - 1 : firstRow.depth;
}

export function useDroppable({
  row,
  ref,
  nextRow,
  rows,
  paneIndex,
}: {
  row: Row;
  ref: RefObject<HTMLElement>;
  nextRow: Row | undefined;
  rows: List<Row>;
  paneIndex: number;
}): [
  { dragDirection: number | undefined; isOver: boolean },
  ConnectDropTarget
] {
  const { anchor } = useTemporaryView();
  const { createPlan, executePlan } = usePlanner();
  const invertCopyModeRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // eslint-disable-next-line functional/immutable-data
      invertCopyModeRef.current = e.altKey || e.key === "Alt";
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === "Alt" || !e.altKey) {
        // eslint-disable-next-line functional/immutable-data
        invertCopyModeRef.current = false;
      }
    };
    const onWindowBlur = (): void => {
      // eslint-disable-next-line functional/immutable-data
      invertCopyModeRef.current = false;
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onWindowBlur);
      // eslint-disable-next-line functional/immutable-data
      invertCopyModeRef.current = false;
    };
  }, []);

  const currentDepth = row.depth;

  const rootDepth = getRootDepth(rows);

  const calcDepthLimits = (
    sourceViewKey?: string
  ): { minDepth: number; maxDepth: number } =>
    computeDepthLimits(
      currentDepth,
      nextRow?.depth,
      nextRow?.viewKey,
      sourceViewKey,
      rootDepth
    );

  const updateTargetDepth = (
    monitor: DropTargetMonitor<DropItemType>
  ): void => {
    const direction = calcDragDirection(ref, monitor, row);
    const clientOffset = monitor.getClientOffset();
    if (!clientOffset || !ref.current || direction === undefined) {
      return;
    }

    const parentEl = ref.current.parentElement;
    if (!parentEl) {
      return;
    }

    /* eslint-disable functional/immutable-data */
    if (globalDragIndent.activeElement !== parentEl) {
      const prev = globalDragIndent.activeElement;
      if (prev) {
        prev.style.removeProperty("--drop-indent-left");
        const prevInner = prev.querySelector(".inner-node");
        if (prevInner instanceof HTMLElement) {
          prevInner.style.removeProperty("--drop-indent-left");
        }
      }
      globalDragIndent.activeElement = parentEl;
    }

    const dragItem = monitor.getItem();
    const { minDepth, maxDepth } = calcDepthLimits(
      isDragItem(dragItem) ? dragItem.row.viewKey : undefined
    );

    if (globalDragIndent.anchorX === undefined) {
      globalDragIndent.anchorX = clientOffset.x;
      globalDragIndent.targetDepth = Math.max(
        minDepth,
        Math.min(maxDepth, currentDepth)
      );
    }
    globalDragIndent.lastDirection = direction;

    const clamped = Math.max(
      minDepth,
      Math.min(maxDepth, globalDragIndent.targetDepth ?? currentDepth)
    );
    if (clamped !== globalDragIndent.targetDepth) {
      globalDragIndent.anchorX = clientOffset.x;
    }
    globalDragIndent.targetDepth = clamped;

    const deltaX = clientOffset.x - globalDragIndent.anchorX;

    if (deltaX > DEPTH_STEP) {
      if (clamped < maxDepth) {
        globalDragIndent.targetDepth = clamped + 1;
      }
      globalDragIndent.anchorX = clientOffset.x;
    } else if (deltaX < -DEPTH_STEP) {
      if (clamped > minDepth) {
        globalDragIndent.targetDepth = clamped - 1;
      }
      globalDragIndent.anchorX = clientOffset.x;
    }
    /* eslint-enable functional/immutable-data */

    const depth = globalDragIndent.targetDepth;
    if (depth !== undefined) {
      applyDropIndent(parentEl, depth);
    }
  };

  return useDrop<
    DropItemType,
    DropItemType,
    { dragDirection: number | undefined; isOver: boolean }
  >({
    accept: [NOTE_TYPE, NativeTypes.FILE],
    collect(monitor) {
      const rawDirection = calcDragDirection(ref, monitor, row);
      const direction = rawDirection;
      const isOver = monitor.isOver({ shallow: true });
      if (isOver && direction !== undefined) {
        const parentEl = ref.current?.parentElement;
        if (parentEl) {
          /* eslint-disable functional/immutable-data */
          if (globalDragIndent.targetDepth === undefined) {
            const collectDragItem = monitor.getItem();
            const collectSourceViewKey = isDragItem(collectDragItem)
              ? collectDragItem.row.viewKey
              : undefined;
            const { minDepth, maxDepth } =
              calcDepthLimits(collectSourceViewKey);
            globalDragIndent.targetDepth = Math.max(
              minDepth,
              Math.min(maxDepth, currentDepth)
            );
            globalDragIndent.anchorX =
              monitor.getClientOffset()?.x ?? globalDragIndent.anchorX;
          }
          /* eslint-enable functional/immutable-data */
          applyDropIndent(parentEl, globalDragIndent.targetDepth);
        }
      }
      return {
        dragDirection: direction,
        isOver,
      };
    },
    hover(_item: DropItemType, monitor: DropTargetMonitor<DropItemType>) {
      updateTargetDepth(monitor);
    },
    drop(item: DropItemType, monitor: DropTargetMonitor<DropItemType>) {
      if (monitor.didDrop()) {
        return item;
      }
      const { targetDepth } = globalDragIndent;
      clearDropIndent();
      const rawDirection = calcDragDirection(ref, monitor, row);
      const direction = rawDirection;
      if (direction === undefined) {
        return item;
      }

      if (monitor.getItemType() === NativeTypes.FILE) {
        if (!isNativeFileDropItem(item)) {
          return item;
        }
        const fileDropItem = item;
        (async () => {
          const markdownFiles = await Promise.all(
            getFilesFromNativeDrop(fileDropItem)
              .filter(isMarkdownFile)
              .map(async (file): Promise<MarkdownImportFile> => {
                return {
                  name: file.name,
                  markdown: await readFileAsText(file),
                };
              })
          );
          if (markdownFiles.length === 0) {
            return;
          }

          const plan = createPlan();
          const dropDestination = getDropDestinationFromRows(
            rows,
            row,
            undefined,
            []
          );
          if (!dropDestination) {
            return;
          }

          const importedTrees = parseMarkdownImportFiles(markdownFiles);
          if (importedTrees.length === 0) {
            return;
          }

          await executePlan(
            planPasteMarkdownTrees(
              plan,
              importedTrees,
              dropDestination.parentRow.node,
              dropDestination.insertAtIndex
            )
          );
        })();
        return item;
      }

      if (!isDragItem(item)) {
        return item;
      }
      const dragItem = item;
      const dropDestination = getDropDestinationFromRows(
        rows,
        row,
        targetDepth,
        dragItem.draggedRows.length ? dragItem.draggedRows : [dragItem.row]
      );
      if (!dropDestination) {
        return item;
      }
      // Arranging something relative to a computed row touches it. A
      // reorder WITHIN a source-ordered projection materializes the
      // entire displayed sequence first (document order becomes
      // authoritative — idea.md, Ordered projections); otherwise only
      // the anchor row the drop lands after materializes.
      const dragRows = dragItem.draggedRows.length
        ? dragItem.draggedRows
        : [dragItem.row];
      const parentId = dropDestination.parentRow.node.id;
      const isProjectionReorder =
        calendarFeedUrl(dropDestination.parentRow.node) !== undefined &&
        dragRows.some((dragged) => dragged.parentRef?.id === parentId);
      const [plan, dropIndex] = ((): [Plan, number] => {
        const base = createPlan();
        const withSequence = isProjectionReorder
          ? rows
              .filter(
                (displayRow) =>
                  displayRow.parentRef?.id === parentId &&
                  displayRow.materialize !== undefined
              )
              .reduce(
                (accPlan: Plan, displayRow) =>
                  planMaterializeComputedRow(accPlan, displayRow)[0],
                base
              )
          : base;
        const { anchorRow } = dropDestination;
        if (!anchorRow?.materialize && !isProjectionReorder) {
          return [withSequence, dropDestination.insertAtIndex];
        }
        const anchored = anchorRow
          ? planMaterializeComputedRow(withSequence, anchorRow)
          : undefined;
        const planWithAnchor = anchored ? anchored[0] : withSequence;
        const anchorNode = anchored?.[1];
        const parent = getWorkspaceNode(planWithAnchor.knowledgeDBs, parentId);
        const anchorIndex =
          parent && anchorNode ? parent.children.indexOf(anchorNode.id) : -1;
        return [
          planWithAnchor,
          anchorIndex >= 0 ? anchorIndex + 1 : dropDestination.insertAtIndex,
        ];
      })();
      const dropped = dnd(
        plan,
        dragItem,
        paneIndex,
        dropDestination.parentRow,
        dropIndex,
        invertCopyModeRef.current
      );
      executePlan(
        planSetTemporarySelectionState(dropped, {
          baseSelection: OrderedSet<string>(),
          shiftSelection: OrderedSet<string>(),
          anchor,
        })
      );
      (document.activeElement as HTMLElement | null)?.blur();
      return dragItem;
    },
  });
}

function useEmptyPaneDrop({
  paneIndex,
}: {
  paneIndex: number;
}): [{ isOver: boolean }, ConnectDropTarget] {
  const { createPlan, executePlan } = usePlanner();
  return useDrop<DropItemType, DropItemType, { isOver: boolean }>({
    accept: [NOTE_TYPE, NativeTypes.FILE],
    collect(monitor) {
      return { isOver: monitor.isOver({ shallow: true }) };
    },
    drop(item: DropItemType, monitor: DropTargetMonitor<DropItemType>) {
      if (monitor.didDrop()) {
        return item;
      }

      if (monitor.getItemType() === NativeTypes.FILE) {
        if (!isNativeFileDropItem(item)) {
          return item;
        }
        const fileDropItem = item;
        (async () => {
          const markdownFiles = await Promise.all(
            getFilesFromNativeDrop(fileDropItem)
              .filter(isMarkdownFile)
              .map(async (file): Promise<MarkdownImportFile> => {
                return {
                  name: file.name,
                  markdown: await readFileAsText(file),
                };
              })
          );
          if (markdownFiles.length === 0) {
            return;
          }
          const plan = createPlan();
          await executePlan(
            planImportMarkdownFilesAtEmptyRoot(plan, markdownFiles, paneIndex)
          );
        })();
        return item;
      }

      if (!isDragItem(item)) {
        return item;
      }
      const dragItem = item;
      const plan = createPlan();
      const paneTarget = buildPaneTarget(plan, dragItem.row);
      const updatedPanes = plan.panes.map((p, idx) => {
        if (idx !== paneIndex) return p;
        return {
          id: p.id,
          sourceId: paneTarget.sourceId,
          documentId: paneTarget.documentId,
          rootNodeId: paneTarget.rootNodeId,
          scrollToId: paneTarget.scrollToId,
        };
      });
      executePlan(planUpdatePanes(plan, updatedPanes));
      return dragItem;
    },
  });
}

export function DroppableContainer({
  children,
  className: extraClassName,
  disabled,
  ariaLabel,
}: DroppableContainerProps): JSX.Element {
  const paneIndex = usePaneIndex();
  const ref = useRef<HTMLDivElement>(null);
  const [{ isOver }, drop] = useEmptyPaneDrop({ paneIndex });
  const className = [!disabled && isOver ? "dimmed" : "", extraClassName]
    .filter(Boolean)
    .join(" ");
  drop(disabled ? null : ref);

  return (
    <div ref={ref} className={className} aria-label={ariaLabel}>
      {children}
    </div>
  );
}
