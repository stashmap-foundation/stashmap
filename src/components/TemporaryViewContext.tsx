import React, { useState } from "react";
import { OrderedSet, Set } from "immutable";
import { Selectbox } from "../commons/Ui";
import {
  parseViewPath,
  useViewKey,
  getParentKey,
  useNode,
  useParentNode,
  useRelationIndex,
  getRelationIndex,
} from "../ViewContext";
import { getRelations, splitID } from "../connections";
import { useData } from "../DataContext";
import { usePaneNavigation } from "../SplitPanesContext";

type MultiSelectionState = {
  selection: OrderedSet<string>;
  multiselectBtns: Set<string>;
};

type MultiSelection = MultiSelectionState & {
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

type SiblingEditor = {
  siblingEditorAfterViewKey: string | null;
  setSiblingEditorAfterViewKey: (viewKey: string | null) => void;
};

type TemporaryView = MultiSelection & Editing & EditorOpen & SiblingEditor;

type SetSelected = (selected: boolean) => void;
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

function useSetSelected(): SetSelected {
  const { selection, setState, multiselectBtns } = useTemporaryView();
  const viewKey = useViewKey();
  return (selected: boolean): void => {
    if (!selected) {
      setState({ selection: selection.remove(viewKey), multiselectBtns });
    } else {
      setState({ selection: selection.add(viewKey), multiselectBtns });
    }
  };
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
  viewKey: string,
  stack: (LongID | ID)[]
): OrderedSet<number> {
  return getSelectedInView(selection, viewKey)
    .map((key) => {
      const path = parseViewPath(key);
      return getRelationIndex(data, path, stack);
    })
    .filter((n) => n !== undefined) as OrderedSet<number>;
}

export function useSelectedIndices(): OrderedSet<number> {
  const { selection } = useTemporaryView();
  const data = useData();
  const { stack } = usePaneNavigation();
  const viewKey = useViewKey();
  return getSelectedIndices(data, selection, viewKey, stack);
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
  const { selection, setState, multiselectBtns } = useTemporaryView();
  return (viewKey) =>
    setState({
      selection: deselectAllChildren(selection, viewKey),
      multiselectBtns,
    });
}

function isMultiselectBtnOn(
  multiselectBtns: Set<string>,
  viewKey: string
): boolean {
  return multiselectBtns.has(viewKey);
}

export function useIsParentMultiselectBtnOn(): boolean {
  const { multiselectBtns } = useTemporaryView();
  const viewKey = useViewKey();
  return isMultiselectBtnOn(multiselectBtns, getParentKey(viewKey));
}

export function switchOffMultiselect(
  multiselectBtns: Set<string>,
  selection: OrderedSet<string>,
  viewKey: string
): MultiSelectionState {
  return {
    selection: deselectAllChildren(selection, viewKey),
    multiselectBtns: multiselectBtns.remove(viewKey),
  };
}

function toggleMultiselect(
  multiselectBtns: Set<string>,
  selection: OrderedSet<string>,
  viewKey: string
): MultiSelectionState {
  return {
    selection: deselectAllChildren(selection, viewKey),
    multiselectBtns: isMultiselectBtnOn(multiselectBtns, viewKey)
      ? multiselectBtns.remove(viewKey)
      : multiselectBtns.add(viewKey),
  };
}

export function ToggleMultiselect(): JSX.Element {
  const [node] = useNode();
  const ariaLabel = node ? `toggle multiselect ${node.text}` : undefined;
  const { selection, setState, multiselectBtns } = useTemporaryView();
  const viewKey = useViewKey();
  const onClick = (): void =>
    setState(toggleMultiselect(multiselectBtns, selection, viewKey));

  return (
    <button
      type="button"
      className="btn btn-borderless"
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <span className="iconsminds-check" />
    </button>
  );
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

export function isMutableNode(node: KnowNode | undefined, user: User): boolean {
  return (
    !!node && node.type === "text" && splitID(node.id)[0] === user.publicKey
  );
}

export function ToggleEditing(): JSX.Element | null {
  const { user } = useData();
  const [node] = useNode();
  const ariaLabel = node ? `edit ${node.text}` : undefined;
  const { editingViews, setEditingState } = useTemporaryView();
  const viewKey = useViewKey();
  if (!isMutableNode(node, user)) {
    return null;
  }
  const onClick = (): void =>
    setEditingState(toggleEditing(editingViews, viewKey));

  return (
    <button
      type="button"
      className="btn btn-borderless p-0"
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <span className="iconsminds-pen-2" />
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
  const [multiselectState, setMultiselectState] = useState<MultiSelectionState>(
    {
      multiselectBtns: Set<string>(),
      selection: OrderedSet<string>(),
    }
  );
  const [isEditingState, setEditingState] = useState<EditingState>({
    editingViews: Set<string>(),
  });
  const [isEditorOpenState, setEditorOpenState] = useState<EditorOpenState>({
    editorOpenViews: Set<string>(),
  });
  const [siblingEditorAfterViewKey, setSiblingEditorAfterViewKey] = useState<
    string | null
  >(null);
  return (
    <TemporaryViewContext.Provider
      value={{
        multiselectBtns: multiselectState.multiselectBtns,
        selection: multiselectState.selection,
        setState: setMultiselectState,
        editingViews: isEditingState.editingViews,
        setEditingState,
        editorOpenViews: isEditorOpenState.editorOpenViews,
        setEditorOpenState,
        siblingEditorAfterViewKey,
        setSiblingEditorAfterViewKey,
      }}
    >
      {children}
    </TemporaryViewContext.Provider>
  );
}

export function NodeSelectbox(): JSX.Element | null {
  const [node] = useNode();
  const { knowledgeDBs, user } = useData();
  const [parentNode, parentView] = useParentNode();
  const relationIndex = useRelationIndex();
  const checked = useIsSelected();
  const setSelected = useSetSelected();
  if (!parentView) {
    return null;
  }

  const relations = getRelations(
    knowledgeDBs,
    parentView.relations,
    user.publicKey,
    parentNode.id
  );
  if (!relations) {
    return null;
  }

  const isSubjectNode =
    parentNode &&
    relationIndex !== undefined &&
    relationIndex >= relations.items.size;

  const ariaLabel = node
    ? `${checked ? "deselect" : "select"} ${node.text}`
    : undefined;

  if (isSubjectNode) {
    return null;
  }
  return (
    <Selectbox
      checked={checked}
      setSelected={setSelected}
      ariaLabel={ariaLabel}
    />
  );
}
