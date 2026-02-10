import React, { useEffect } from "react";
import { useEditorText } from "./EditorTextContext";
import { isEditableElement } from "./keyboardNavigation";

export function preventEditorBlur(e: React.MouseEvent): void {
  if (isEditableElement(document.activeElement)) {
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
  onShiftTab?: (text: string, cursorPosition: number) => void;
  autoFocus?: boolean;
  ariaLabel?: string;
  onEscape?: () => void;
  onRequestRowFocus?: (target: {
    viewKey?: string;
    nodeId?: string;
    rowIndex?: number;
  }) => void;
};

export function MiniEditor({
  initialText,
  initialCursorPosition,
  onSave,
  onClose,
  onTab,
  onShiftTab,
  autoFocus = true,
  ariaLabel,
  onEscape,
  onRequestRowFocus,
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
      const currentRow = editorRef.current?.closest(
        '[data-row-focusable="true"]'
      );
      const rowElement = currentRow instanceof HTMLElement ? currentRow : null;
      const rowKey = rowElement?.getAttribute("data-view-key") || null;
      const rowIndex = rowElement?.getAttribute("data-row-index") || null;
      const nodeId = rowElement?.getAttribute("data-node-id") || null;
      // eslint-disable-next-line functional/immutable-data
      handlingKeyRef.current = true;
      onEscape?.();
      const text = getText().trim();
      const hasChanges = Boolean(text && text !== lastSavedTextRef.current);
      if (hasChanges) {
        // Save changes - onSave will close the editor
        // eslint-disable-next-line functional/immutable-data
        lastSavedTextRef.current = text; // Update immediately to prevent duplicate saves
        const imageUrl = await getImageUrlFromText(text);
        onSave(text, imageUrl);
      } else {
        onRequestRowFocus?.({
          viewKey: rowKey || undefined,
          nodeId: nodeId || undefined,
          rowIndex: rowIndex !== null ? Number(rowIndex) : undefined,
        });
        // No changes, just close
        onClose?.();
      }
      editorRef.current?.blur();
      if (rowElement?.isConnected) {
        rowElement.focus();
      }
      // eslint-disable-next-line functional/immutable-data
      handlingKeyRef.current = false;
    } else if (e.key === "Enter") {
      e.preventDefault();
      const text = getText().trim();
      if (!text) {
        if (onShiftTab) {
          onShiftTab(text, getCursorPosition());
          return;
        }
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
    } else if (
      e.key === "Tab" &&
      e.shiftKey &&
      onShiftTab &&
      isCursorAtStart()
    ) {
      e.preventDefault();
      onShiftTab(getText().trim(), getCursorPosition());
    }
  };

  const handleBlur = (e: React.FocusEvent): void => {
    if (handlingKeyRef.current) {
      return;
    }

    const { relatedTarget } = e;
    if (!relatedTarget) {
      return;
    }
    if (
      relatedTarget instanceof HTMLElement &&
      relatedTarget.closest(".modal")
    ) {
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
      className="mini-editor-wrapper"
      onClick={handleWrapperClick}
      onKeyDown={() => {}}
    >
      <span
        ref={editorRef}
        role="textbox"
        tabIndex={0}
        className="mini-editor"
        contentEditable
        suppressContentEditableWarning
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onPaste={handlePaste}
        onInput={handleInput}
        aria-label={ariaLabel || "note editor"}
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
