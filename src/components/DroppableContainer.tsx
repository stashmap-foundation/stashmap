import React, { RefObject, useRef } from "react";
import { List } from "immutable";
import { ConnectDropTarget, DropTargetMonitor, useDrop } from "react-dnd";
import { NativeTypes } from "react-dnd-html5-backend";
import { dnd, getDropDestinationFromTreeView } from "../dnd";
import {
  addRelationToRelations,
  createAbstractRefId,
  isEmptyNodeID,
  LOG_NODE_ID,
  shortID,
} from "../connections";
import { deselectAllChildren, useTemporaryView } from "./TemporaryViewContext";
import {
  Plan,
  planAddToParent,
  planUpdatePanes,
  planUpsertNode,
  planUpsertRelations,
  usePlanner,
} from "../planner";
import {
  ViewPath,
  getContext,
  getNodeIDFromView,
  getRelationsForContext,
  getParentKey,
  newRelations,
  useViewPath,
  viewPathToString,
} from "../ViewContext";
import { NOTE_TYPE } from "./Node";
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
};

type NativeFileDropItem = {
  files?: File[] | FileList;
};

type DropItemType = DragItemType | NativeFileDropItem;

type DroppableContainerProps = {
  children: React.ReactNode;
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
  const logNode: KnowNode = {
    id: LOG_NODE_ID,
    text: "~Log",
    type: "text",
  };
  const withLogNode = planUpsertNode(plan, logNode);
  const existingLogRelations = getRelationsForContext(
    withLogNode.knowledgeDBs,
    withLogNode.user.publicKey,
    LOG_NODE_ID,
    List<ID>(),
    undefined,
    false
  );
  const logRelations =
    existingLogRelations ||
    newRelations(LOG_NODE_ID, List<ID>(), withLogNode.user.publicKey);
  const withUpdatedLogRelations = planUpsertRelations(
    withLogNode,
    addRelationToRelations(
      logRelations,
      createAbstractRefId(List<ID>(), rootNodeID),
      undefined,
      undefined,
      0
    )
  );
  const updatedPanes = withUpdatedLogRelations.panes.map((paneState, idx) => {
    if (idx !== paneIndex) {
      return paneState;
    }
    return {
      ...paneState,
      stack: [rootNodeID],
      rootRelation: undefined,
    };
  });
  return planUpdatePanes(withUpdatedLogRelations, updatedPanes);
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
  if (item?.path && viewPathToString(item.path) === viewPathToString(path)) {
    return undefined;
  }
  const hoverBoundingRect = ref.current.getBoundingClientRect();
  const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
  const clientOffset = monitor.getClientOffset();
  if (!clientOffset || clientOffset.y === undefined) {
    // This should only happen in test environment, therefore we assume dragging upwards
    return 1;
  }
  const hoverClientY = clientOffset.y - hoverBoundingRect.top;

  // Dragging upwards
  if (hoverClientY < hoverMiddleY) {
    return 1;
  }
  // Dragging downwards
  if (hoverClientY > hoverMiddleY) {
    return -1;
  }
  return undefined;
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

export function useDroppable({
  destination,
  index,
  ref,
  isRoot,
}: {
  destination: ViewPath;
  index?: number;
  ref: RefObject<HTMLElement>;
  isRoot?: boolean;
}): [
  { dragDirection: number | undefined; isOver: boolean },
  ConnectDropTarget
] {
  const { setState, selection, multiselectBtns } = useTemporaryView();
  const { createPlan, executePlan } = usePlanner();
  const stack = usePaneStack();
  const pane = useCurrentPane();
  const path = useViewPath();

  const isListItem = index !== undefined;

  // Helper to adjust direction for root node (can't drop above root)
  const adjustDirectionForRoot = (
    direction: number | undefined
  ): number | undefined => {
    if (isRoot && direction === 1) {
      return -1; // Treat top drop on root as bottom drop
    }
    return direction;
  };

  return useDrop<
    DropItemType,
    DropItemType,
    { dragDirection: number | undefined; isOver: boolean }
  >({
    accept: [NOTE_TYPE, NativeTypes.FILE],
    collect(monitor) {
      const rawDirection = calcDragDirection(ref, monitor, path);
      return {
        dragDirection: adjustDirectionForRoot(rawDirection),
        isOver: monitor.isOver({ shallow: true }),
      };
    },
    drop(item: DropItemType, monitor: DropTargetMonitor<DropItemType>) {
      const rawDirection = calcDragDirection(ref, monitor, path);
      const direction = adjustDirectionForRoot(rawDirection);
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
      executePlan(
        dnd(
          createPlan(),
          selection,
          viewPathToString(dragItem.path), // TODO: change parameter to path instead of string
          destination,
          stack,
          calcIndex(index, direction),
          pane.rootRelation,
          dragItem.isSuggestion
        )
      );
      const parentKey = getParentKey(viewPathToString(dragItem.path));
      setState({
        selection: deselectAllChildren(selection, parentKey),
        multiselectBtns: multiselectBtns.remove(parentKey),
      });
      return dragItem;
    },
  });
}

export function DroppableContainer({
  children,
}: DroppableContainerProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const path = useViewPath();
  const [{ isOver }, drop] = useDroppable({
    destination: path,
    ref,
  });
  const className = isOver ? "dimmed" : "";
  drop(ref);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
