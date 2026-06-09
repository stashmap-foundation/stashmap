import React, { useState } from "react";
import { OrderedSet, Set } from "immutable";
import { useRow } from "../rowModel";
import { useData } from "../DataContext";
import { isRefNode } from "../core/connections";
import { isBlockFileLink } from "../core/nodeSpans";
import { deselectAllChildren } from "../core/selection";

export { deselectAllChildren };

type MultiSelection = {
  selection: OrderedSet<string>;
  baseSelection: OrderedSet<string>;
  shiftSelection: OrderedSet<string>;
  anchor: string;
};

type EditingState = {
  editingViews: Set<string>;
};

type Editing = EditingState & {
  setEditingState: (editingState: EditingState) => void;
};

type EditorOpenState = {
  editorOpenViews: Set<string>;
};

type EditorOpen = EditorOpenState & {
  setEditorOpenState: (editorOpenState: EditorOpenState) => void;
};

type TemporaryView = MultiSelection & Editing & EditorOpen;

const TemporaryViewStateContext = React.createContext<
  TemporaryView | undefined
>(undefined);

function getTemporaryViewStateContextOrThrow(): TemporaryView {
  const context = React.useContext(TemporaryViewStateContext);
  if (context === undefined) {
    throw new Error("TemporaryViewStateContext not provided");
  }
  return context;
}

export function useTemporaryView(): TemporaryView {
  return getTemporaryViewStateContextOrThrow();
}

export function useIsSelected(): boolean {
  const { selection } = useTemporaryView();
  const { viewKey } = useRow();
  return selection.contains(viewKey);
}

function isEditingOn(editingViews: Set<string>, viewKey: string): boolean {
  return editingViews.has(viewKey);
}

export function useIsEditingOn(): boolean {
  const { editingViews } = useTemporaryView();
  const { viewKey } = useRow();
  return isEditingOn(editingViews, viewKey);
}

export function isEditableNode(node: GraphNode | undefined): boolean {
  return !!node && !isRefNode(node) && !isBlockFileLink(node);
}

export function TemporaryViewProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { publishEventsStatus } = useData();

  const { baseSelection, shiftSelection, anchor } =
    publishEventsStatus.temporaryView;

  const [isEditingState, setEditingState] = useState<EditingState>({
    editingViews: Set<string>(),
  });
  const [isEditorOpenState, setEditorOpenState] = useState<EditorOpenState>({
    editorOpenViews: Set<string>(),
  });

  return (
    <TemporaryViewStateContext.Provider
      value={{
        selection: baseSelection.union(shiftSelection),
        baseSelection,
        shiftSelection,
        anchor,
        editingViews: isEditingState.editingViews,
        setEditingState,
        editorOpenViews: isEditorOpenState.editorOpenViews,
        setEditorOpenState,
      }}
    >
      {children}
    </TemporaryViewStateContext.Provider>
  );
}
