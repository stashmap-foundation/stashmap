import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  getLastChild,
  getRelationForView,
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
  initialPosition: "afterSibling" | "asFirstChild";
  baseInsertAtIndex: number;
  baseLevels: number;
  initialPortalTarget: string;
};

export function CreateNodeEditor({
  initialPosition,
  baseInsertAtIndex,
  baseLevels,
  initialPortalTarget,
}: CreateNodeEditorProps): JSX.Element | null {
  const data = useData();
  const viewPath = useViewPath();
  const { stack } = usePaneNavigation();
  const { createPlan, executePlan } = usePlanner();

  // Helper to close the editor via planner
  const closeEditor = (): void => {
    executePlan(planCloseCreateNodeEditor(createPlan()));
  };

  // Internal state for position - can change when Tab is pressed
  const [position, setPosition] = useState(initialPosition);
  // Track if Tab was pressed to change position (affects insert index)
  const [tabPressed, setTabPressed] = useState(false);
  // Portal target viewKey - always use portal to preserve state when target changes
  const [portalTargetKey, setPortalTargetKey] =
    useState<string>(initialPortalTarget);
  // Text to preserve across portal changes (which cause remount)
  const [editorText, setEditorText] = useState("");

  // Compute derived values based on current position
  const levels = position === "asFirstChild" ? baseLevels + 1 : baseLevels;
  // When asFirstChild from Enter (initial): insert at 0 (beginning)
  // When asFirstChild from Tab: insert at end (undefined)
  // When afterSibling: insert at baseInsertAtIndex
  const insertAtIndex =
    position === "asFirstChild"
      ? tabPressed
        ? undefined // Tab indent: add at end of new parent's children
        : 0 // Enter on expanded: add at beginning
      : baseInsertAtIndex;

  // Determine target path based on position:
  // - afterSibling: insert into parent's relations
  // - asFirstChild: insert into current node's relations
  const parentPath = getParentView(viewPath);
  const targetPath = position === "afterSibling" ? parentPath : viewPath;

  if (!targetPath) {
    return null;
  }

  const onCreateNode = (
    text: string,
    imageUrl?: string,
    submitted?: boolean
  ): void => {
    const trimmedText = text.trim();
    if (!trimmedText) {
      closeEditor();
      return;
    }

    let plan = createPlan();
    const n = newNode(text, plan.user.publicKey, imageUrl);
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

  const onTab = (text: string): void => {
    // Tab indents the editor - changes from sibling to child position
    // Don't create the node yet, just move the editor
    if (position === "asFirstChild") {
      // Already at max indent level for this context
      return;
    }

    // Preserve text before portal change (portal change causes remount)
    setEditorText(text);

    // Expand the current node (ensure it has relations for children)
    const [nodeID, view] = getNodeIDFromView(data, viewPath);
    const context = getContextFromStackAndViewPath(stack, viewPath);
    const plan = planExpandNode(createPlan(), nodeID, context, view, viewPath);
    executePlan(plan);

    // Find the last child to portal to (if any)
    // Use plan data since we just expanded
    const lastChild = getLastChild(plan, viewPath, stack);
    if (lastChild) {
      setPortalTargetKey(viewPathToString(lastChild));
    }

    // Update internal position state - editor stays mounted, text preserved
    setPosition("asFirstChild");
    setTabPressed(true); // Mark that Tab was pressed, so insert at end
  };

  const editorContent = (
    <NodeCard className="hover-light-bg" cardBodyClassName="ps-0 pt-0 pb-0">
      <LeftMenu />
      {levels > 0 && <Indent levels={levels} />}
      <div className="expand-collapse-toggle" style={{ color: "black" }}>
        <span className="triangle collapsed">▶</span>
      </div>
      <div className="flex-column w-100" style={{ paddingTop: 10 }}>
        <MiniEditor
          initialText={editorText}
          onSave={onCreateNode}
          onClose={closeEditor}
          onTab={onTab}
          ariaLabel="new node editor"
        />
      </div>
    </NodeCard>
  );

  // Always render via portal to preserve state when target changes
  const portalTarget = document.getElementById(
    `editor-portal-${portalTargetKey}`
  );
  if (portalTarget) {
    return createPortal(editorContent, portalTarget);
  }

  // Fallback if portal target doesn't exist yet
  return editorContent;
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

  // Base values for editor - CreateNodeEditor will adjust based on its internal position state
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
      {/* Portal target for CreateNodeEditor - placed after each node's children */}
      <div id={`editor-portal-${viewKey}`} />
      {showEditor && editorPosition && (
        <CreateNodeEditor
          initialPosition={editorPosition}
          baseInsertAtIndex={baseInsertAtIndex}
          baseLevels={baseLevels}
          initialPortalTarget={viewKey}
        />
      )}
    </>
  );
}
