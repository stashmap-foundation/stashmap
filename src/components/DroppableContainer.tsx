import React, { RefObject, useEffect, useRef } from "react";
import { List, OrderedSet } from "immutable";
import { ConnectDropTarget, DropTargetMonitor, useDrop } from "react-dnd";
import { NativeTypes } from "react-dnd-html5-backend";
import { dnd, getDropDestinationFromTreeView } from "../dnd";
import { isEmptyNodeID, shortID } from "../connections";
import { deselectAllChildren, useTemporaryView } from "./TemporaryViewContext";
import {
  Plan,
  planAddToParent,
  planSetTemporarySelectionState,
  planUpdatePanes,
  usePlanner,
} from "../planner";
import {
  ViewPath,
  getContext,
  getNodeIDFromView,
  getParentKey,
  useViewPath,
  viewPathToString,
} from "../ViewContext";
import { NOTE_TYPE, INDENTATION } from "./Node";
import { usePaneStack, useCurrentPane } from "../SplitPanesContext";
import {
  buildRootTreeForEmptyRootDrop,
  MarkdownImportFile,
  parseMarkdownImportFiles,
  planCreateNodesFromMarkdownTrees,
} from "./FileDropZone";

export type DragItemType = {
  path: ViewPath;
  isSuggestion?: boolean;
  isCopyDrag?: boolean;
};

type NativeFileDropItem = {
  files?: File[] | FileList;
};

type DropItemType = DragItemType | NativeFileDropItem;

type DroppableContainerProps = {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
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

function planMaterializeImportedRoot(
  plan: Plan,
  paneIndex: number,
  rootNodeID: ID
): Plan {
  const updatedPanes = plan.panes.map((paneState, idx) => {
    if (idx !== paneIndex) {
      return paneState;
    }
    return {
      ...paneState,
      stack: [rootNodeID],
      rootRelation: undefined,
    };
  });
  return planUpdatePanes(plan, updatedPanes);
}

function calcDragDirection(
  ref: RefObject<HTMLElement>,
  monitor: DropTargetMonitor<DropItemType>,
  path: ViewPath
): number | undefined {
  if (!monitor.isOver({ shallow: true })) {
    return undefined;
  }
  if (!ref.current) {
    return undefined;
  }
  const item = monitor.getItem() as DragItemType | undefined;
  if (item?.path) {
    const sourceStr = viewPathToString(item.path);
    const targetStr = viewPathToString(path);
    if (targetStr === sourceStr || targetStr.startsWith(`${sourceStr}:`)) {
      return undefined;
    }
  }
  return -1;
}

function calcIndex(
  index: number | undefined,
  direction: number | undefined
): number | undefined {
  if (index === undefined || direction === undefined) {
    return undefined;
  }
  return direction === 1 ? index : index + 1;
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
  nextViewPathStr: string | undefined,
  sourcePathStr: string | undefined,
  rootDepth: number
): { minDepth: number; maxDepth: number } {
  const maxDepth = currentDepth + 1;
  if (nextDepth === undefined) {
    return { minDepth: rootDepth + 1, maxDepth };
  }
  if (
    sourcePathStr &&
    nextViewPathStr &&
    (nextViewPathStr === sourcePathStr ||
      nextViewPathStr.startsWith(`${sourcePathStr}:`))
  ) {
    return { minDepth: rootDepth + 1, maxDepth };
  }
  return { minDepth: nextDepth, maxDepth };
}

export function useDroppable({
  destination,
  index,
  ref,
  nextDepth,
  nextViewPathStr,
}: {
  destination: ViewPath;
  index?: number;
  ref: RefObject<HTMLElement>;
  nextDepth?: number;
  nextViewPathStr?: string;
}): [
  { dragDirection: number | undefined; isOver: boolean },
  ConnectDropTarget
] {
  const { selection, anchor } = useTemporaryView();
  const { createPlan, executePlan } = usePlanner();
  const stack = usePaneStack();
  const pane = useCurrentPane();
  const path = useViewPath();
  const invertCopyModeRef = useRef(false);

  const isListItem = index !== undefined;

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

  const currentDepth = path.length - 1;

  const rootDepth = destination.length - 1;

  const calcDepthLimits = (
    sourcePathStr?: string
  ): { minDepth: number; maxDepth: number } =>
    computeDepthLimits(
      currentDepth,
      nextDepth,
      nextViewPathStr,
      sourcePathStr,
      rootDepth
    );

  const updateTargetDepth = (
    monitor: DropTargetMonitor<DropItemType>
  ): void => {
    const direction = calcDragDirection(ref, monitor, path);
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

    const dragItem = monitor.getItem() as DragItemType | undefined;
    const sourcePathStr = dragItem?.path
      ? viewPathToString(dragItem.path)
      : undefined;
    const { minDepth, maxDepth } = calcDepthLimits(sourcePathStr);

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
      const rawDirection = calcDragDirection(ref, monitor, path);
      const direction = rawDirection;
      const isOver = monitor.isOver({ shallow: true });
      if (isOver && direction !== undefined) {
        const parentEl = ref.current?.parentElement;
        if (parentEl) {
          /* eslint-disable functional/immutable-data */
          if (globalDragIndent.targetDepth === undefined) {
            const collectDragItem = monitor.getItem() as
              | DragItemType
              | undefined;
            const collectSourcePath = collectDragItem?.path
              ? viewPathToString(collectDragItem.path)
              : undefined;
            const { minDepth, maxDepth } = calcDepthLimits(collectSourcePath);
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
      const { targetDepth } = globalDragIndent;
      clearDropIndent();
      const rawDirection = calcDragDirection(ref, monitor, path);
      const direction = rawDirection;
      if (isListItem && direction === undefined) {
        return item;
      }

      if (monitor.getItemType() === NativeTypes.FILE) {
        const fileDropItem = item as NativeFileDropItem;
        const destinationIndex = calcIndex(index, direction);
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
          const importedTrees = parseMarkdownImportFiles(markdownFiles);
          if (importedTrees.length === 0) {
            return;
          }

          const plan = createPlan();
          const [dropParentPath, insertAtIndex] =
            destinationIndex === undefined
              ? [destination, undefined]
              : getDropDestinationFromTreeView(
                  plan,
                  destination,
                  stack,
                  destinationIndex,
                  pane.rootRelation
                );
          const [dropParentNodeID] = getNodeIDFromView(plan, dropParentPath);

          if (isEmptyNodeID(dropParentNodeID)) {
            const rootTree = buildRootTreeForEmptyRootDrop(importedTrees);
            if (!rootTree) {
              return;
            }
            const [planWithMarkdown, topNodeIDs] =
              planCreateNodesFromMarkdownTrees(plan, [rootTree], List<ID>());
            const rootNodeID = topNodeIDs[0];
            if (!rootNodeID) {
              return;
            }
            await executePlan(
              planMaterializeImportedRoot(planWithMarkdown, path[0], rootNodeID)
            );
            return;
          }

          const parentContext = getContext(plan, dropParentPath, stack);
          const markdownContext = parentContext.push(
            shortID(dropParentNodeID) as ID
          );
          const [planWithMarkdown, topNodeIDs] =
            planCreateNodesFromMarkdownTrees(
              plan,
              importedTrees,
              markdownContext
            );
          if (topNodeIDs.length === 0) {
            return;
          }
          await executePlan(
            planAddToParent(
              planWithMarkdown,
              topNodeIDs,
              dropParentPath,
              stack,
              insertAtIndex
            )
          );
        })();
        return item;
      }

      const dragItem = item as DragItemType;
      const plan = createPlan();
      const [destinationRootNodeID] = getNodeIDFromView(plan, destination);

      if (isEmptyNodeID(destinationRootNodeID)) {
        const [sourceNodeID] = getNodeIDFromView(plan, dragItem.path);
        const targetPaneIndex = destination[0] as number;
        const updatedPanes = plan.panes.map((p, idx) => {
          if (idx !== targetPaneIndex) return p;
          return {
            ...p,
            stack: [shortID(sourceNodeID) as ID],
            rootRelation: undefined,
          };
        });
        executePlan(planUpdatePanes(plan, updatedPanes));
        return dragItem;
      }

      const dropped = dnd(
        plan,
        selection,
        viewPathToString(dragItem.path),
        destination,
        stack,
        calcIndex(index, direction),
        pane.rootRelation,
        dragItem.isSuggestion,
        invertCopyModeRef.current,
        targetDepth,
        dragItem.isCopyDrag
      );
      const parentKey = getParentKey(viewPathToString(dragItem.path));
      executePlan(
        planSetTemporarySelectionState(dropped, {
          baseSelection: deselectAllChildren(selection, parentKey),
          shiftSelection: OrderedSet<string>(),
          anchor,
        })
      );
      return dragItem;
    },
  });
}

export function DroppableContainer({
  children,
  className: extraClassName,
  disabled,
}: DroppableContainerProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const path = useViewPath();
  const [{ isOver }, drop] = useDroppable({
    destination: path,
    ref,
  });
  const className = [!disabled && isOver ? "dimmed" : "", extraClassName]
    .filter(Boolean)
    .join(" ");
  drop(disabled ? null : ref);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
