import React, { useEffect } from "react";
import { useMediaQuery } from "react-responsive";
import { NodeCard } from "../commons/Ui";
import { useInputElementFocus } from "../commons/FocusContextProvider";
import { shorten } from "../KnowledgeDataContext";
import { newNode, addRelationToRelations } from "../connections";
import {
  useIsAddToNode,
  useParentNode,
  useNode,
  useViewPath,
  getParentView,
  useViewKey,
  upsertRelations,
  updateViewPathsAfterAddRelation,
} from "../ViewContext";
import useModal from "./useModal";
import { SearchModal } from "./SearchModal";
import { IS_MOBILE } from "./responsive";
import { Indent } from "./Node";
import {
  openEditor,
  closeEditor,
  useTemporaryView,
  useIsEditorOpen,
} from "./TemporaryViewContext";
import { Plan, planUpsertNode, planUpdateViews, usePlanner } from "../planner";
import { usePaneNavigation } from "../SplitPanesContext";

function AddNodeButton({
  onClick,
  ariaLabel,
}: {
  onClick: () => void;
  ariaLabel: string;
}): JSX.Element {
  const isInline = useIsAddToNode() || useMediaQuery(IS_MOBILE);
  const className = isInline
    ? "add-node-button black-dimmed hover-black-dimmed"
    : "add-node-button background-transparent";
  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {!isInline && <span className="simple-icon-plus me-2" />}
      <span>Add Note</span>
      <span>{}</span>
    </button>
  );
}

function SearchButton({ onClick }: { onClick: () => void }): JSX.Element {
  const isAddToNode = useIsAddToNode();
  const [node] = isAddToNode ? useParentNode() : useNode();
  const ariaLabel = node ? `search and attach to ${node.text}` : "search";
  return (
    <button
      className="btn btn-borderless p-0"
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <span className="simple-icon-magnifier" />
      <span className="visually-hidden">Search</span>
    </button>
  );
}

function getUrlFromText(text: string): string | undefined {
  const urlRegex = /(https?:\/\/[^\s/$.?#].[^\s]*|www\.[^\s/$.?#].[^\s]*)/i;
  const match = text.match(urlRegex);
  return match ? match[0] : undefined;
}

export async function getImageUrlFromText(
  text: string
): Promise<string | undefined> {
  const url = getUrlFromText(text);
  if (!url) {
    return Promise.resolve(undefined);
  }
  /* eslint-disable functional/immutable-data */
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(url);
    img.onerror = () => resolve(undefined);
    img.src = url;
  });
  /* eslint-enable functional/immutable-data */
}

type MiniEditorProps = {
  initialText?: string;
  onSave: (text: string, imageUrl?: string) => void;
  onClose?: () => void;
  onEnterCreateSibling?: () => void;
  autoFocus?: boolean;
};

export function MiniEditor({
  initialText,
  onSave,
  onClose,
  onEnterCreateSibling,
  autoFocus = true,
}: MiniEditorProps): JSX.Element {
  const editorRef = React.useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (autoFocus && editorRef.current) {
      editorRef.current.focus();
      // Move cursor to end
      const range = document.createRange();
      range.selectNodeContents(editorRef.current);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [autoFocus]);

  const getText = (): string => {
    return editorRef.current?.textContent || "";
  };

  const saveIfChanged = async (): Promise<void> => {
    const text = getText().trim();
    if (text && text !== initialText) {
      const imageUrl = await getImageUrlFromText(text);
      onSave(text, imageUrl);
    }
  };

  const handleKeyDown = async (
    e: React.KeyboardEvent<HTMLSpanElement>
  ): Promise<void> => {
    if (e.key === "Escape") {
      // Reset to initial text and blur
      if (editorRef.current) {
        editorRef.current.textContent = initialText || "";
      }
      editorRef.current?.blur();
      onClose?.();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const text = getText().trim();
      if (!text) {
        onClose?.();
        return;
      }
      const imageUrl = await getImageUrlFromText(text);
      onSave(text, imageUrl);
      if (onEnterCreateSibling) {
        onEnterCreateSibling();
      }
    }
  };

  const handleBlur = (): void => {
    saveIfChanged();
  };

  const handlePaste = (e: React.ClipboardEvent): void => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  };

  const moveCursorToEnd = (): void => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    const range = document.createRange();
    range.selectNodeContents(editorRef.current);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const handleWrapperClick = (e: React.MouseEvent): void => {
    // Only handle clicks on the wrapper itself, not the contenteditable
    if (e.target === e.currentTarget) {
      moveCursorToEnd();
    }
  };

  return (
    <span
      onClick={handleWrapperClick}
      style={{
        paddingRight: "30px",
        cursor: "text",
      }}
    >
      <span
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onPaste={handlePaste}
        style={{
          outline: "none",
          minWidth: "1px",
        }}
      >
        {initialText}
      </span>
    </span>
  );
}

// Legacy Editor - wraps MiniEditor (kept for backward compatibility during transition)
type EditorProps = {
  onCreateNode: (
    text: string,
    imageUrl?: string,
    relationType?: RelationType
  ) => void;
  onClose: () => void;
};

export function Editor({ onCreateNode, onClose }: EditorProps): JSX.Element {
  return (
    <MiniEditor
      onSave={(text, imageUrl) => onCreateNode(text, imageUrl)}
      onClose={onClose}
    />
  );
}

type AddNodeProps = {
  onCreateNewNode: (text: string, imageUrl?: string) => void;
  onAddExistingNode: (nodeID: LongID) => void;
  ariaLabel: string;
  isSearchEnabledByShortcut?: boolean;
};

function AddNode({
  ariaLabel,
  onCreateNewNode,
  onAddExistingNode,
  isSearchEnabledByShortcut,
}: AddNodeProps): JSX.Element {
  const { openModal, closeModal, isOpen } = useModal();
  const { editorOpenViews, setEditorOpenState } = useTemporaryView();
  const { isInputElementInFocus, setIsInputElementInFocus } =
    useInputElementFocus();
  const viewKey = useViewKey();
  const isEditorOpen = useIsEditorOpen();
  const reset = (): void => {
    setIsInputElementInFocus(false);
    setEditorOpenState(closeEditor(editorOpenViews, viewKey));
  };
  useEffect((): (() => void) | undefined => {
    if (isSearchEnabledByShortcut && !isInputElementInFocus) {
      const handler = (event: KeyboardEvent): void => {
        if (event.key === "/" && !isOpen) {
          openModal();
        }
      };
      window.addEventListener("keyup", handler);
      return () => {
        window.removeEventListener("keyup", handler);
        if (isOpen) {
          closeModal();
        }
      };
    }
    return undefined;
  }, [isInputElementInFocus]);

  const createNewNode = (text: string, imageUrl?: string): void => {
    onCreateNewNode(text, imageUrl);
    reset();
  };

  const onAddExistingRepo = (id: LongID): void => {
    if (isOpen) {
      closeModal();
    }
    onAddExistingNode(id);
  };

  return (
    <>
      {isOpen && (
        <SearchModal
          onAddExistingNode={onAddExistingRepo}
          onHide={closeModal}
        />
      )}
      <div className="w-100">
        {!isEditorOpen && (
          <div className="d-flex">
            <AddNodeButton
              ariaLabel={ariaLabel}
              onClick={() => {
                setEditorOpenState(openEditor(editorOpenViews, viewKey));
              }}
            />
            <div className="flex-row-end">
              <SearchButton onClick={openModal} />
            </div>
          </div>
        )}
        {isEditorOpen && (
          <Editor onCreateNode={createNewNode} onClose={reset} />
        )}
      </div>
    </>
  );
}

export function AddColumn(): JSX.Element {
  const viewPath = useViewPath();
  const { stack } = usePaneNavigation();
  const { createPlan, executePlan } = usePlanner();

  const onAddNode = (plan: Plan, nodeID: LongID): void => {
    const updateRelationsPlan = upsertRelations(
      plan,
      viewPath,
      stack,
      (relations) => ({
        ...relations,
        items: relations.items.push({
          nodeID,
          relevance: "", // Default to "relevant"
        }),
      })
    );
    executePlan(updateRelationsPlan);
  };

  const onCreateNewNode = (text: string, imageUrl?: string): void => {
    const plan = createPlan();
    const node = newNode(text, plan.user.publicKey, imageUrl);
    onAddNode(planUpsertNode(plan, node), node.id);
  };

  return (
    <NodeCard className="hover-light-bg">
      <Indent levels={1} />
      <AddNode
        onCreateNewNode={onCreateNewNode}
        onAddExistingNode={(id) => onAddNode(createPlan(), id)}
        ariaLabel="add node"
        isSearchEnabledByShortcut
      />
    </NodeCard>
  );
}

export function AddNodeToNode({
  insertAtIndex,
}: {
  insertAtIndex?: number;
} = {}): JSX.Element | null {
  const isAddToNode = useIsAddToNode();
  const vContext = useViewPath();
  const { stack } = usePaneNavigation();
  const { createPlan, executePlan } = usePlanner();
  // When insertAtIndex is provided, we're adding a sibling - use parent's view
  // When isAddToNode is true, the current path is ADD_TO_NODE - use parent's view
  // Otherwise, we're adding children to current node - use current view
  const isSiblingInsert = insertAtIndex !== undefined;
  const viewContext =
    isAddToNode || isSiblingInsert ? getParentView(vContext) : vContext;
  const [node] = isAddToNode || isSiblingInsert ? useParentNode() : useNode();
  if (!node || !viewContext) {
    return null;
  }

  const onAddNode = (plan: Plan, nodeID: LongID): void => {
    // Use addRelationToRelations which handles insertion at specific index
    const updatedRelationsPlan = upsertRelations(
      plan,
      viewContext,
      stack,
      (relations) =>
        addRelationToRelations(
          relations,
          nodeID,
          "", // Default to "relevant"
          undefined, // No argument
          insertAtIndex
        )
    );
    // Update view paths when inserting at specific position
    const updatedViews = updateViewPathsAfterAddRelation(
      updatedRelationsPlan,
      viewContext,
      insertAtIndex
    );
    executePlan(planUpdateViews(updatedRelationsPlan, updatedViews));
  };

  const onCreateNewNode = (text: string, imageUrl?: string): void => {
    const plan = createPlan();
    const n = newNode(text, plan.user.publicKey, imageUrl);
    onAddNode(planUpsertNode(plan, n), n.id);
  };

  return (
    <AddNode
      onCreateNewNode={onCreateNewNode}
      onAddExistingNode={(id) => onAddNode(createPlan(), id)}
      ariaLabel={`add to ${shorten(node.text)}`}
      isSearchEnabledByShortcut={false}
    />
  );
}
