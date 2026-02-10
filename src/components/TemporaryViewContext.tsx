import React, { useState } from "react";
import { OrderedSet, Set } from "immutable";
import {
  parseViewPath,
  useViewKey,
  getRelationIndex,
  useDisplayText,
  useNode,
} from "../ViewContext";
import { useData } from "../DataContext";
import { usePlanner } from "../planner";

export type MultiSelectionState = {
  baseSelection: OrderedSet<string>;
  shiftSelection: OrderedSet<string>;
  anchor: string;
};

type MultiSelection = {
  selection: OrderedSet<string>;
  baseSelection: OrderedSet<string>;
  shiftSelection: OrderedSet<string>;
  anchor: string;
  setState: (multiselectionState: MultiSelectionState) => void;
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

type FindSelectedByPostfix = (postfix: string) => Set<string>;
type DeselectByPostfix = (postfix: string) => void;

const TemporaryViewContext = React.createContext<TemporaryView | undefined>(
  undefined
);

function getTemporaryViewContextOrThrow(): TemporaryView {
  const context = React.useContext(TemporaryViewContext);
  if (context === undefined) {
    throw new Error("TemporaryViewContext not provided");
  }
  return context;
}

export function useTemporaryView(): TemporaryView {
  return getTemporaryViewContextOrThrow();
}

export function useIsSelected(): boolean {
  const { selection } = useTemporaryView();
  const viewKey = useViewKey();
  return selection.contains(viewKey);
}

export function getSelectedInView(
  selection: OrderedSet<string>,
  viewKey: string
): OrderedSet<string> {
  return selection.filter((sel) => sel.startsWith(viewKey));
}

function getSelectedIndices(
  data: Data,
  selection: OrderedSet<string>,
  viewKey: string
): OrderedSet<number> {
  return getSelectedInView(selection, viewKey)
    .map((key) => {
      const path = parseViewPath(key);
      return getRelationIndex(data, path);
    })
    .filter((n) => n !== undefined) as OrderedSet<number>;
}

export function useSelectedIndices(): OrderedSet<number> {
  const { selection } = useTemporaryView();
  const data = useData();
  const viewKey = useViewKey();
  return getSelectedIndices(data, selection, viewKey);
}

export function useGetSelectedInView(): FindSelectedByPostfix {
  const { selection } = useTemporaryView();
  return (postfix) => getSelectedInView(selection, postfix);
}

export function deselectAllChildren(
  selection: OrderedSet<string>,
  viewKey: string
): OrderedSet<string> {
  return selection.filterNot((sel) => sel.startsWith(viewKey));
}

export function useDeselectAllInView(): DeselectByPostfix {
  const { baseSelection, shiftSelection, anchor, setState } =
    useTemporaryView();
  return (viewKey) =>
    setState({
      baseSelection: deselectAllChildren(baseSelection, viewKey),
      shiftSelection: deselectAllChildren(shiftSelection, viewKey),
      anchor,
    });
}

export function selectSingle(
  _state: MultiSelectionState,
  viewKey: string
): MultiSelectionState {
  return {
    baseSelection: OrderedSet<string>([viewKey]),
    shiftSelection: OrderedSet<string>(),
    anchor: viewKey,
  };
}

export function toggleSelect(
  state: MultiSelectionState,
  viewKey: string
): MultiSelectionState {
  const committed = state.baseSelection.union(state.shiftSelection);
  const withAnchor =
    committed.size === 0 && state.anchor && state.anchor !== viewKey
      ? committed.add(state.anchor)
      : committed;
  return {
    baseSelection: withAnchor.contains(viewKey)
      ? withAnchor.remove(viewKey)
      : withAnchor.add(viewKey),
    shiftSelection: OrderedSet<string>(),
    anchor: viewKey,
  };
}

export function shiftSelect(
  state: MultiSelectionState,
  orderedKeys: string[],
  target: string
): MultiSelectionState {
  const anchorIdx = orderedKeys.indexOf(state.anchor);
  const targetIdx = orderedKeys.indexOf(target);
  if (anchorIdx === -1 || targetIdx === -1) {
    return state;
  }
  const start = Math.min(anchorIdx, targetIdx);
  const end = Math.max(anchorIdx, targetIdx);
  const rangeKeys = orderedKeys.slice(start, end + 1);
  return {
    baseSelection: state.baseSelection,
    shiftSelection: OrderedSet<string>(rangeKeys),
    anchor: state.anchor,
  };
}

export function clearSelection(
  state: MultiSelectionState
): MultiSelectionState {
  return {
    baseSelection: OrderedSet<string>(),
    shiftSelection: OrderedSet<string>(),
    anchor: state.anchor,
  };
}

function isEditingOn(editingViews: Set<string>, viewKey: string): boolean {
  return editingViews.has(viewKey);
}

export function useIsEditingOn(): boolean {
  const { editingViews } = useTemporaryView();
  const viewKey = useViewKey();
  return isEditingOn(editingViews, viewKey);
}

export function toggleEditing(
  editingViews: Set<string>,
  viewKey: string
): EditingState {
  return {
    editingViews: isEditingOn(editingViews, viewKey)
      ? editingViews.remove(viewKey)
      : editingViews.add(viewKey),
  };
}

export function isMutableNode(node: KnowNode | undefined): boolean {
  return !!node && node.type === "text";
}

export function ToggleEditing(): JSX.Element | null {
  const [node] = useNode();
  const displayText = useDisplayText();
  const ariaLabel = displayText ? `edit ${displayText}` : undefined;
  const { editingViews, setEditingState } = useTemporaryView();
  const viewKey = useViewKey();
  if (!isMutableNode(node)) {
    return null;
  }
  const onClick = (): void =>
    setEditingState(toggleEditing(editingViews, viewKey));

  return (
    <button
      type="button"
      className="btn btn-icon"
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <span aria-hidden="true">✎</span>
    </button>
  );
}

function isEditorOpen(editorOpenViews: Set<string>, viewKey: string): boolean {
  return editorOpenViews.has(viewKey);
}

export function useIsEditorOpen(): boolean {
  const { editorOpenViews } = useTemporaryView();
  const viewKey = useViewKey();
  return isEditorOpen(editorOpenViews, viewKey);
}

export function closeEditor(
  editorOpenViews: Set<string>,
  viewKey: string
): EditorOpenState {
  return {
    editorOpenViews: isEditorOpen(editorOpenViews, viewKey)
      ? editorOpenViews.remove(viewKey)
      : editorOpenViews,
  };
}

export function openEditor(
  editorOpenViews: Set<string>,
  viewKey: string
): EditorOpenState {
  return {
    editorOpenViews: !isEditorOpen(editorOpenViews, viewKey)
      ? editorOpenViews.add(viewKey)
      : editorOpenViews,
  };
}

export function TemporaryViewProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { publishEventsStatus } = useData();
  const { setPublishEvents } = usePlanner();

  const { baseSelection, shiftSelection, anchor } =
    publishEventsStatus.temporaryView;

  const setMultiselectState = (state: MultiSelectionState): void => {
    setPublishEvents((prev) => ({
      ...prev,
      temporaryView: {
        ...prev.temporaryView,
        baseSelection: state.baseSelection,
        shiftSelection: state.shiftSelection,
        anchor: state.anchor,
      },
    }));
  };

  const [isEditingState, setEditingState] = useState<EditingState>({
    editingViews: Set<string>(),
  });
  const [isEditorOpenState, setEditorOpenState] = useState<EditorOpenState>({
    editorOpenViews: Set<string>(),
  });

  return (
    <TemporaryViewContext.Provider
      value={{
        selection: baseSelection.union(shiftSelection),
        baseSelection,
        shiftSelection,
        anchor,
        setState: setMultiselectState,
        editingViews: isEditingState.editingViews,
        setEditingState,
        editorOpenViews: isEditorOpenState.editorOpenViews,
        setEditorOpenState,
      }}
    >
      {children}
    </TemporaryViewContext.Provider>
  );
}
