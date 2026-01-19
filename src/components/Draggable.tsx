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
  addNodeToPath,
  viewPathToString,
  getContextFromStackAndViewPath,
  getNodeIDFromView,
  getRelationForView,
  getLastChild,
} from "../ViewContext";
import { useData } from "../DataContext";
import { planExpandNode } from "./RelationTypes";
import { NOTE_TYPE, Node, Indent } from "./Node";
import { LeftMenu } from "./LeftMenu";
import { useDroppable } from "./DroppableContainer";
import { useIsEditingOn, useTemporaryView } from "./TemporaryViewContext";
import { MiniEditor } from "./AddNode";
import { NodeCard } from "../commons/Ui";
import { newNode, addRelationToRelations } from "../connections";
import {
  planUpsertNode,
  planUpdateViews,
  usePlanner,
  planOpenCreateNodeEditor,
  planCloseCreateNodeEditor,
} from "../planner";
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
  position: CreateNodeEditorPosition;
  text: string;
  cursorPosition: number;
  baseInsertAtIndex: number;
  baseLevels: number;
};

export function CreateNodeEditor({
  position,
  text,
  cursorPosition,
  baseInsertAtIndex,
  baseLevels,
}: CreateNodeEditorProps): JSX.Element | null {
  const data = useData();
  const viewPath = useViewPath();
  const { stack } = usePaneNavigation();
  const { createPlan, executePlan } = usePlanner();

  // Helper to close the editor via planner
  const closeEditor = (): void => {
    executePlan(planCloseCreateNodeEditor(createPlan()));
  };

  // Compute derived values based on current position
  const isChildPosition = position === "asFirstChild";
  const levels = isChildPosition ? baseLevels + 1 : baseLevels;
  // asFirstChild: insert at 0 (beginning)
  // afterSibling: insert at baseInsertAtIndex
  const insertAtIndex = position === "asFirstChild" ? 0 : baseInsertAtIndex;

  // Determine target path based on position:
  // - afterSibling: insert into parent's relations
  // - asFirstChild: insert into current node's relations
  const parentPath = getParentView(viewPath);
  const targetPath = position === "afterSibling" ? parentPath : viewPath;

  if (!targetPath) {
    return null;
  }

  const onCreateNode = (
    nodeText: string,
    imageUrl?: string,
    submitted?: boolean
  ): void => {
    const trimmedText = nodeText.trim();
    if (!trimmedText) {
      closeEditor();
      return;
    }

    let plan = createPlan();
    const n = newNode(nodeText);
    plan = planUpsertNode(plan, n);

    // Get current relations to determine actual insert index before modifying
    const currentRelations = getRelationForView(plan, targetPath, stack);
    const currentSize = currentRelations?.items.size ?? 0;
    // When insertAtIndex is undefined, add at end (use current size)
    const actualInsertIndex = insertAtIndex ?? currentSize;

    plan = upsertRelations(plan, targetPath, stack, (relations) =>
      addRelationToRelations(
        relations,
        n.id,
        "", // Default to "relevant"
        undefined, // No argument
        actualInsertIndex
      )
    );
    // Update view paths when inserting at specific position
    const updatedViews = updateViewPathsAfterAddRelation(
      plan,
      targetPath,
      insertAtIndex
    );
    plan = planUpdateViews(plan, updatedViews);

    // If user pressed Enter, open another editor after the newly created node
    // Otherwise (blur), just close the editor
    if (submitted) {
      // Construct the path to the newly created node using the computed index
      const newNodePath = addNodeToPath(plan, targetPath, actualInsertIndex);
      const newNodeViewKey = viewPathToString(newNodePath);
      // Chain to next sibling (new node is not expanded)
      plan = planOpenCreateNodeEditor(plan, newNodeViewKey, "afterSibling");
    } else {
      plan = planCloseCreateNodeEditor(plan);
    }

    executePlan(plan);
  };

  const onTab = (tabText: string, tabCursorPosition: number): void => {
    // Tab indents the editor - changes from sibling to child position
    // Don't create the node yet, just move the editor
    if (isChildPosition) {
      // Already at max indent level for this context
      return;
    }

    // Expand the current node (ensure it has relations for children)
    const [nodeID, view] = getNodeIDFromView(data, viewPath);
    const context = getContextFromStackAndViewPath(stack, viewPath);
    let plan = planExpandNode(createPlan(), nodeID, context, view, viewPath);

    // Find the last child (if any) - use plan data since we just expanded
    const lastChild = getLastChild(plan, viewPath, stack);

    // Open editor at the correct position:
    // - If there's a last child: open after it (afterSibling)
    // - If no children: open as first child of current node
    if (lastChild) {
      plan = planOpenCreateNodeEditor(
        plan,
        viewPathToString(lastChild),
        "afterSibling",
        tabText,
        tabCursorPosition
      );
    } else {
      plan = planOpenCreateNodeEditor(
        plan,
        viewPathToString(viewPath),
        "asFirstChild",
        tabText,
        tabCursorPosition
      );
    }
    executePlan(plan);
  };

  return (
    <NodeCard className="hover-light-bg" cardBodyClassName="ps-0 pt-0 pb-0">
      <LeftMenu />
      {levels > 0 && <Indent levels={levels} />}
      <div className="expand-collapse-toggle" style={{ color: "black" }}>
        <span className="triangle collapsed">▶</span>
      </div>
      <div className="flex-column w-100" style={{ paddingTop: 10 }}>
        <MiniEditor
          initialText={text}
          initialCursorPosition={cursorPosition}
          onSave={onCreateNode}
          onClose={closeEditor}
          onTab={onTab}
          ariaLabel="new node editor"
        />
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

  // Base values for editor
  const baseLevels = viewPath.length - 1;
  const baseInsertAtIndex = relationIndex !== undefined ? relationIndex + 1 : 0;

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
      {showEditor && createNodeEditorState && (
        <CreateNodeEditor
          position={createNodeEditorState.position}
          text={createNodeEditorState.text}
          cursorPosition={createNodeEditorState.cursorPosition}
          baseInsertAtIndex={baseInsertAtIndex}
          baseLevels={baseLevels}
        />
      )}
    </>
  );
}
