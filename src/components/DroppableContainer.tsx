import React, { RefObject, useRef } from "react";
import { ConnectDropTarget, DropTargetMonitor, useDrop } from "react-dnd";
import { dnd } from "../dnd";
import { deselectAllChildren, useTemporaryView } from "./TemporaryViewContext";
import { usePlanner } from "../planner";
import {
  ViewPath,
  getParentKey,
  useViewPath,
  viewPathToString,
} from "../ViewContext";
import { NOTE_TYPE } from "./Node";
import { usePaneNavigation } from "../SplitPanesContext";

export type DragItemType = {
  path: ViewPath;
  isDiffItem?: boolean;
};

type DroppableContainerProps = {
  children: React.ReactNode;
};

function calcDragDirection(
  ref: RefObject<HTMLElement>,
  monitor: DropTargetMonitor<DragItemType>,
  path: ViewPath
): number | undefined {
  if (!monitor.isOver({ shallow: true })) {
    return undefined;
  }
  if (!ref.current) {
    return undefined;
  }
  const item = monitor.getItem();
  if (item && viewPathToString(item.path) === viewPathToString(path)) {
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
}: {
  destination: ViewPath;
  index?: number;
  ref: RefObject<HTMLElement>;
}): [
  { dragDirection: number | undefined; isOver: boolean },
  ConnectDropTarget
] {
  const { setState, selection, multiselectBtns } = useTemporaryView();
  const { createPlan, executePlan } = usePlanner();
  const { stack } = usePaneNavigation();
  const path = useViewPath();

  const isListItem = index !== undefined;

  return useDrop<
    DragItemType,
    DragItemType,
    { dragDirection: number | undefined; isOver: boolean }
  >({
    accept: NOTE_TYPE,
    collect(monitor) {
      return {
        dragDirection: calcDragDirection(ref, monitor, path),
        isOver: monitor.isOver({ shallow: true }),
      };
    },
    drop(
      item: DragItemType,
      monitor: DropTargetMonitor<DragItemType, DragItemType>
    ) {
      const direction = calcDragDirection(ref, monitor, path);
      if (isListItem && direction === undefined) {
        return item;
      }

      executePlan(
        dnd(
          createPlan(),
          selection,
          viewPathToString(item.path), // TODO: change parameter to path instead of string
          destination,
          stack,
          calcIndex(index, direction),
          item.isDiffItem
        )
      );
      const parentKey = getParentKey(viewPathToString(item.path));
      setState({
        selection: deselectAllChildren(selection, parentKey),
        multiselectBtns: multiselectBtns.remove(parentKey),
      });
      return item;
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
