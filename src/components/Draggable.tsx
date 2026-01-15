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
  addNodeToPathWithRelations,
  viewPathToString,
} from "../ViewContext";
import { NOTE_TYPE, Node, Indent } from "./Node";
import { LeftMenu } from "./LeftMenu";
import { useDroppable } from "./DroppableContainer";
import { useIsEditingOn, useTemporaryView } from "./TemporaryViewContext";
import { MiniEditor } from "./AddNode";
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

type CreateNodeEditorProps = {
  position: 'afterSibling' | 'asFirstChild';
  insertAtIndex: number;
  levels: number;
};

function CreateNodeEditor({
  position,
  insertAtIndex,
  levels,
}: CreateNodeEditorProps): JSX.Element | null {
  const viewPath = useViewPath();
  const { stack } = usePaneNavigation();
  const { createPlan, executePlan } = usePlanner();
  const { openCreateNodeEditor, closeCreateNodeEditor } = useTemporaryView();

  // Determine target path based on position:
  // - afterSibling: insert into parent's relations
  // - asFirstChild: insert into current node's relations
  const parentPath = getParentView(viewPath);
  const targetPath = position === 'afterSibling' ? parentPath : viewPath;

  if (!targetPath) {
    return null;
  }

  const onCreateNode = async (
    text: string,
    imageUrl?: string,
    submitted?: boolean
  ): Promise<void> => {
    const trimmedText = text.trim();
    if (!trimmedText) {
      closeCreateNodeEditor();
      return;
    }

    const plan = createPlan();
    const n = newNode(text, plan.user.publicKey, imageUrl);
    const planWithNode = planUpsertNode(plan, n);

    // Capture the updated relations to construct the proper viewKey
    let updatedRelations: Relations;
    const updatedRelationsPlan = upsertRelations(
      planWithNode,
      targetPath,
      stack,
      (relations) => {
        updatedRelations = addRelationToRelations(
          relations,
          n.id,
          "", // Default to "relevant"
          undefined, // No argument
          insertAtIndex
        );
        return updatedRelations;
      }
    );
    // Update view paths when inserting at specific position
    const updatedViews = updateViewPathsAfterAddRelation(
      updatedRelationsPlan,
      targetPath,
      insertAtIndex
    );
    executePlan(planUpdateViews(updatedRelationsPlan, updatedViews));

    // If user pressed Enter, open another editor after the newly created node
    if (submitted) {
      // Construct the proper viewKey using ViewContext functions
      // @ts-expect-error updatedRelations is assigned in the callback above
      const newNodePath = addNodeToPathWithRelations(targetPath, updatedRelations, insertAtIndex);
      const newNodeViewKey = viewPathToString(newNodePath);
      // Chain to next sibling (new node is not expanded)
      openCreateNodeEditor(newNodeViewKey);
    }
  };

  return (
    <NodeCard className="hover-light-bg" cardBodyClassName="ps-0 pt-0 pb-0">
      <LeftMenu />
      {levels > 0 && <Indent levels={levels} />}
      <div className="expand-collapse-toggle" style={{ color: "black" }}>
        <span className="triangle collapsed">▶</span>
      </div>
      <div className="flex-column w-100" style={{ paddingTop: 10 }}>
        <MiniEditor onSave={onCreateNode} onClose={closeCreateNodeEditor} />
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
  const { createNodeEditorState } = useTemporaryView();

  // Check if we should show a create node editor after this node
  const showEditor = createNodeEditorState?.viewKey === viewKey;
  const editorPosition = createNodeEditorState?.position;

  // Calculate values based on position
  const currentLevels = viewPath.length - 1;
  // afterSibling: same level, insert at relationIndex + 1
  // asFirstChild: +1 level, insert at 0
  const editorLevels =
    editorPosition === 'asFirstChild' ? currentLevels + 1 : currentLevels;
  const insertAtIndex =
    editorPosition === 'asFirstChild'
      ? 0
      : relationIndex !== undefined
        ? relationIndex + 1
        : 0;

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
      {showEditor && editorPosition && (
        <CreateNodeEditor
          position={editorPosition}
          insertAtIndex={insertAtIndex}
          levels={editorLevels}
        />
      )}
    </>
  );
}
