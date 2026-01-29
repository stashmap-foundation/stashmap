import React, { useEffect } from "react";
import {
  useViewPath,
  useDisplayText,
  useNextInsertPosition,
  useIsInReferencedByView,
} from "../ViewContext";
import { useEditorText } from "./EditorTextContext";
import {
  usePlanner,
  planSetEmptyNodePosition,
  planSaveNodeAndEnsureRelations,
} from "../planner";
import { usePaneStack, useIsViewingOtherUserContent } from "../SplitPanesContext";

/**
 * Prevents a button from stealing focus from an editor in the same node row.
 * Use as onMouseDown handler on buttons that should not blur the editor.
 *
 * - If the active element (editor) is in the same .inner-node container, prevents default
 * - If the active element is in a different row, allows normal focus behavior
 */
export function preventEditorBlurIfSameNode(e: React.MouseEvent): void {
  const nodeContainer = (e.currentTarget as HTMLElement).closest(".inner-node");
  if (nodeContainer?.contains(document.activeElement)) {
    e.preventDefault();
  }
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
  initialCursorPosition?: number;
  onSave: (text: string, imageUrl?: string, submitted?: boolean) => void;
  onClose?: () => void;
  onTab?: (text: string, cursorPosition: number) => void;
  autoFocus?: boolean;
  ariaLabel?: string;
};

export function MiniEditor({
  initialText,
  initialCursorPosition,
  onSave,
  onClose,
  onTab,
  autoFocus = true,
  ariaLabel,
}: MiniEditorProps): JSX.Element {
  const editorRef = React.useRef<HTMLSpanElement>(null);
  // Track last saved text to prevent duplicate saves when blur fires multiple times
  // before React re-renders with updated initialText
  const lastSavedTextRef = React.useRef(initialText);

  // Reset when initialText prop changes (e.g., navigating to different node)
  useEffect(() => {
    // eslint-disable-next-line functional/immutable-data
    lastSavedTextRef.current = initialText;
  }, [initialText]);

  useEffect(() => {
    if (autoFocus && editorRef.current) {
      editorRef.current.focus();
      const range = document.createRange();
      const textNode = editorRef.current.firstChild;
      if (textNode && initialCursorPosition !== undefined) {
        // Set cursor at specific position
        const pos = Math.min(
          initialCursorPosition,
          textNode.textContent?.length || 0
        );
        range.setStart(textNode, pos);
        range.setEnd(textNode, pos);
      } else {
        // Move cursor to end
        range.selectNodeContents(editorRef.current);
        range.collapse(false);
      }
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [autoFocus]);

  const getText = (): string => {
    return editorRef.current?.textContent || "";
  };

  const editorTextContext = useEditorText();

  const handleInput = (): void => {
    editorTextContext?.setText(getText());
  };

  const saveIfChanged = async (): Promise<void> => {
    const text = getText().trim();
    if (text && text !== lastSavedTextRef.current) {
      // eslint-disable-next-line functional/immutable-data
      lastSavedTextRef.current = text; // Update immediately to prevent duplicate saves
      const imageUrl = await getImageUrlFromText(text);
      onSave(text, imageUrl);
    }
  };

  const getCursorPosition = (): number => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    const range = sel.getRangeAt(0);
    return range.startOffset;
  };

  const isCursorAtStart = (): boolean => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    // Check if cursor is at the very beginning (offset 0, collapsed)
    return range.collapsed && range.startOffset === 0;
  };

  // Track if we're handling a key event to prevent blur from re-triggering save
  const handlingKeyRef = React.useRef(false);

  const handleKeyDown = async (
    e: React.KeyboardEvent<HTMLSpanElement>
  ): Promise<void> => {
    if (e.key === "Escape") {
      e.preventDefault();
      // eslint-disable-next-line functional/immutable-data
      handlingKeyRef.current = true;
      const text = getText().trim();
      if (text && text !== lastSavedTextRef.current) {
        // Save changes - onSave will close the editor
        // eslint-disable-next-line functional/immutable-data
        lastSavedTextRef.current = text; // Update immediately to prevent duplicate saves
        const imageUrl = await getImageUrlFromText(text);
        onSave(text, imageUrl);
      } else {
        // No changes, just close
        onClose?.();
      }
      editorRef.current?.blur();
      // eslint-disable-next-line functional/immutable-data
      handlingKeyRef.current = false;
    } else if (e.key === "Enter") {
      e.preventDefault();
      const text = getText().trim();
      if (!text) {
        onClose?.();
        return;
      }
      // eslint-disable-next-line functional/immutable-data
      lastSavedTextRef.current = text; // Update immediately to prevent duplicate saves
      const imageUrl = await getImageUrlFromText(text);
      onSave(text, imageUrl, true);
    } else if (e.key === "Tab" && !e.shiftKey && onTab && isCursorAtStart()) {
      e.preventDefault();
      onTab(getText().trim(), getCursorPosition());
    }
  };

  const handleBlur = (e: React.FocusEvent): void => {
    // Skip if we're handling a key event (ESC/Enter already handled save/close)
    if (handlingKeyRef.current) {
      return;
    }

    // Skip if focus moved to a modal (e.g., search modal opened from same row)
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (relatedTarget?.closest(".modal")) {
      return;
    }

    const text = getText().trim();
    if (!text) {
      onClose?.();
      return;
    }
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
      role="presentation"
      onClick={handleWrapperClick}
      onKeyDown={() => {}}
      style={{
        paddingRight: "30px",
        cursor: "text",
      }}
    >
      <span
        ref={editorRef}
        role="textbox"
        tabIndex={0}
        contentEditable
        suppressContentEditableWarning
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onPaste={handlePaste}
        onInput={handleInput}
        aria-label={ariaLabel || "note editor"}
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
  onCreateNode: (text: string) => void;
  onClose: () => void;
};

export function Editor({ onCreateNode, onClose }: EditorProps): JSX.Element {
  return <MiniEditor onSave={(text) => onCreateNode(text)} onClose={onClose} />;
}

export function AddSiblingButton(): JSX.Element | null {
  const versionedDisplayText = useDisplayText();
  const nextInsertPosition = useNextInsertPosition();
  const stack = usePaneStack();
  const { createPlan, executePlan } = usePlanner();
  const viewPath = useViewPath();
  const editorTextContext = useEditorText();
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const isInReferencedByView = useIsInReferencedByView();

  const editorText = editorTextContext?.text ?? "";
  const displayText = editorText.trim() || versionedDisplayText;

  if (!nextInsertPosition || isViewingOtherUserContent || isInReferencedByView) {
    return null;
  }

  const handleClick = (): void => {
    const [targetPath, insertIndex] = nextInsertPosition;
    const basePlan = createPlan();

    const currentEditorText = editorTextContext?.text ?? "";
    const planWithSave = currentEditorText.trim()
      ? planSaveNodeAndEnsureRelations(
          basePlan,
          currentEditorText,
          viewPath,
          stack
        )
      : basePlan;

    const plan = planSetEmptyNodePosition(
      planWithSave,
      targetPath,
      stack,
      insertIndex
    );
    executePlan(plan);
  };

  return (
    <span
      role="button"
      tabIndex={0}
      className="btn btn-borderless p-0"
      onClick={handleClick}
      onMouseDown={preventEditorBlurIfSameNode}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      aria-label={`add to ${displayText}`}
      title="Add note"
    >
      <span aria-hidden="true">+</span>
    </span>
  );
}
