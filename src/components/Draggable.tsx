import React, { useRef } from "react";
import { ConnectableElement, useDrag } from "react-dnd";
import {
  ViewPath,
  useIsAddToNode,
  useIsDiffItem,
  useIsInReferencedByView,
  useViewPath,
  useViewKey,
  useRelationIndex,
  getParentView,
  upsertRelations,
  updateViewPathsAfterAddRelation,
} from "../ViewContext";
import { NOTE_TYPE, Node, Indent } from "./Node";
import { LeftMenu } from "./LeftMenu";
import { useDroppable } from "./DroppableContainer";
import { useIsEditingOn, useTemporaryView } from "./TemporaryViewContext";
import { Editor } from "./AddNode";
import { NodeCard } from "../commons/Ui";
import { newNode, addRelationToRelations } from "../connections";
import { planUpsertNode, planUpdateViews, usePlanner } from "../planner";
import { usePaneNavigation } from "../SplitPanesContext";

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

function SiblingEditor({
  insertAtIndex,
  levels,
}: {
  insertAtIndex: number;
  levels: number;
}): JSX.Element | null {
  const viewPath = useViewPath();
  const { stack } = usePaneNavigation();
  const { createPlan, executePlan } = usePlanner();
  const { setSiblingEditorAfterViewKey } = useTemporaryView();

  // Get parent view - that's where we insert the sibling
  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    return null;
  }

  const onClose = (): void => {
    setSiblingEditorAfterViewKey(null);
  };

  const onCreateNode = async (text: string, imageUrl?: string): Promise<void> => {
    const trimmedText = text.trim();
    if (!trimmedText) {
      onClose();
      return;
    }

    const plan = createPlan();
    const n = newNode(text, plan.user.publicKey, imageUrl);
    const planWithNode = planUpsertNode(plan, n);

    // Use addRelationToRelations which handles insertion at specific index
    const updatedRelationsPlan = upsertRelations(
      planWithNode,
      parentPath,
      stack,
      (relations) =>
        addRelationToRelations(
          relations,
          n.id,
          "", // Default to "relevant"
          undefined, // No argument
          insertAtIndex
        )
    );
    // Update view paths when inserting at specific position
    const updatedViews = updateViewPathsAfterAddRelation(
      updatedRelationsPlan,
      parentPath,
      insertAtIndex
    );
    executePlan(planUpdateViews(updatedRelationsPlan, updatedViews));
    onClose();
  };

  return (
    <NodeCard className="hover-light-bg" cardBodyClassName="ps-0 pt-0 pb-0">
      <LeftMenu />
      {levels > 0 && <Indent levels={levels} />}
      <div className="flex-column w-100">
        <Editor onCreateNode={onCreateNode} onClose={onClose} />
      </div>
    </NodeCard>
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
  const viewPath = useViewPath();
  const viewKey = useViewKey();
  const relationIndex = useRelationIndex();
  const { siblingEditorAfterViewKey } = useTemporaryView();

  // Check if we should show a sibling editor after this node
  const showSiblingEditor = siblingEditorAfterViewKey === viewKey;
  // Insert at the position after this node
  const siblingInsertIndex =
    relationIndex !== undefined ? relationIndex + 1 : undefined;
  // Calculate indentation level (same as the current node)
  const levels = viewPath.length - 1;

  const [{ dragDirection }, drop] = useDroppable({
    destination: treeViewPath,
    index,
    ref,
  });

  if (isDiffItem) {
    // Diff items: draggable but NOT droppable
    return (
      <div className="visible-on-hover diff-item-container">
        <DraggableDiffItem />
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
    <>
      <div className="visible-on-hover">
        <Draggable ref={ref} className={className} />
      </div>
      {showSiblingEditor && siblingInsertIndex !== undefined && (
        <SiblingEditor insertAtIndex={siblingInsertIndex} levels={levels} />
      )}
    </>
  );
}
