import React, { useEffect, useLayoutEffect } from "react";
import { useEditorText } from "./EditorTextContext";
import { isEditableElement } from "./keyboardNavigation";
import { ParsedLine, parseClipboardText } from "../planner";

export function preventEditorBlur(e: React.MouseEvent): void {
  if (isEditableElement(document.activeElement)) {
    e.preventDefault();
  }
}

type MiniEditorProps = {
  initialSpans: InlineSpan[];
  onSave: (spans: InlineSpan[], submitted?: boolean) => void;
  style?: React.CSSProperties;
  onClose?: () => void;
  onTab?: (spans: InlineSpan[]) => void;
  onShiftTab?: (spans: InlineSpan[]) => void;
  autoFocus?: boolean;
  ariaLabel?: string;
  onEscape?: () => void;
  onRequestRowFocus?: (target: {
    viewKey?: string;
    nodeId?: string;
    rowIndex?: number;
  }) => void;
  onDelete?: () => void;
  onPasteMultiLine?: (
    children: ParsedLine[],
    currentSpans: InlineSpan[]
  ) => void;
  onActivateLink?: (href: string, spans: InlineSpan[]) => void;
};

function appendSpan(spans: InlineSpan[], span: InlineSpan): InlineSpan[] {
  if (span.text === "") return spans;
  const previous = spans[spans.length - 1];
  if (previous?.kind === "text" && span.kind === "text") {
    return [
      ...spans.slice(0, -1),
      { kind: "text", text: previous.text + span.text },
    ];
  }
  return [...spans, span];
}

function spansFromDomNode(node: ChildNode): InlineSpan[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ? [{ kind: "text", text: node.textContent }] : [];
  }
  if (!(node instanceof HTMLElement)) return [];
  const href = node.getAttribute("data-href");
  if (href !== null) {
    const text = node.textContent ?? "";
    return text === "" ? [] : [{ kind: "link", href, text }];
  }
  return Array.from(node.childNodes).reduce(
    (spans, child) => spansFromDomNode(child).reduce(appendSpan, spans),
    [] as InlineSpan[]
  );
}

function trimSpans(spans: InlineSpan[]): InlineSpan[] {
  if (spans.length === 0) return spans;
  const trimText = (text: string, index: number): string => {
    if (spans.length === 1) return text.trim();
    if (index === 0) return text.trimStart();
    if (index === spans.length - 1) return text.trimEnd();
    return text;
  };
  return spans
    .map((span, index) => ({ ...span, text: trimText(span.text, index) }))
    .filter((span) => span.text !== "");
}

function spansFromEditor(editor: HTMLElement | null): InlineSpan[] {
  return trimSpans(
    Array.from(editor?.childNodes ?? []).reduce(
      (spans, child) => spansFromDomNode(child).reduce(appendSpan, spans),
      [] as InlineSpan[]
    )
  );
}

function spansEqual(left: InlineSpan[], right: InlineSpan[]): boolean {
  return (
    left.length === right.length &&
    left.every((span, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        span.kind === other.kind &&
        span.text === other.text &&
        (span.kind === "text" ||
          (other.kind === "link" && span.href === other.href))
      );
    })
  );
}

export function MiniEditor({
  initialSpans,
  onSave,
  style,
  onClose,
  onTab,
  onShiftTab,
  autoFocus = true,
  ariaLabel,
  onEscape,
  onRequestRowFocus,
  onDelete,
  onPasteMultiLine,
  onActivateLink,
}: MiniEditorProps): JSX.Element {
  const editorRef = React.useRef<HTMLSpanElement>(null);
  const [lastSavedSpans, setLastSavedSpans] = React.useState(initialSpans);
  const editorTextContext = useEditorText();

  useEffect(() => {
    setLastSavedSpans(initialSpans);
  }, [initialSpans]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    if (spansEqual(spansFromEditor(editor), initialSpans)) return;
    editor.replaceChildren(
      ...initialSpans.map((span) => {
        if (span.kind === "text") return document.createTextNode(span.text);
        const mark = document.createElement("span");
        mark.setAttribute("role", "link");
        mark.setAttribute("class", "inline-link");
        mark.setAttribute("data-href", span.href);
        mark.setAttribute("data-target", span.href);
        mark.replaceChildren(document.createTextNode(span.text));
        return mark;
      })
    );
  }, [initialSpans]);

  useLayoutEffect(() => {
    if (!autoFocus || !editorRef.current) return;
    editorRef.current.focus();
    const range = document.createRange();
    range.selectNodeContents(editorRef.current);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [autoFocus]);

  const getSpans = (): InlineSpan[] => spansFromEditor(editorRef.current);

  const saveIfChanged = (): void => {
    const spans = getSpans();
    if (spans.length === 0 || spansEqual(spans, lastSavedSpans)) return;
    setLastSavedSpans(spans);
    onSave(spans);
  };

  const handleInput = (): void => {
    editorTextContext?.setSpans(getSpans());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      const currentRow = editorRef.current?.closest(
        '[data-row-focusable="true"]'
      );
      const rowElement = currentRow instanceof HTMLElement ? currentRow : null;
      const rowKey = rowElement?.getAttribute("data-view-key") ?? undefined;
      const rowIndex = rowElement?.getAttribute("data-row-index");
      const nodeId = rowElement?.getAttribute("data-node-id") ?? undefined;
      onEscape?.();
      const spans = getSpans();
      const hasChanges = spans.length > 0 && !spansEqual(spans, lastSavedSpans);
      if (hasChanges) {
        setLastSavedSpans(spans);
        onSave(spans);
      } else if (spans.length === 0 && lastSavedSpans.length > 0 && onDelete) {
        onDelete();
      } else {
        onRequestRowFocus?.({
          viewKey: rowKey,
          nodeId,
          rowIndex: rowIndex === null ? undefined : Number(rowIndex),
        });
        onClose?.();
      }
      editorRef.current?.blur();
      if (rowElement?.isConnected) rowElement.focus();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const spans = getSpans();
      if (spans.length === 0) {
        if (lastSavedSpans.length > 0 && onDelete) {
          onDelete();
          return;
        }
        if (onShiftTab) {
          onShiftTab(spans);
          return;
        }
        onClose?.();
        return;
      }
      setLastSavedSpans(spans);
      onSave(spans, true);
      return;
    }
    if (e.key === "Tab" && !e.shiftKey && onTab) {
      e.preventDefault();
      onTab(getSpans());
      return;
    }
    if (e.key === "Tab" && e.shiftKey && onShiftTab) {
      e.preventDefault();
      onShiftTab(getSpans());
    }
  };

  const handleBlur = (e: React.FocusEvent): void => {
    if (!e.relatedTarget) return;
    const currentRow = editorRef.current?.closest(
      '[data-row-focusable="true"]'
    );
    const sameRowTreeItem =
      e.relatedTarget instanceof HTMLElement &&
      e.relatedTarget.getAttribute("role") === "treeitem" &&
      e.relatedTarget.closest('[data-row-focusable="true"]') === currentRow;
    if (sameRowTreeItem) return;
    if (
      e.relatedTarget instanceof HTMLElement &&
      e.relatedTarget.closest(".modal")
    ) {
      return;
    }
    const spans = getSpans();
    if (spans.length === 0) {
      if (lastSavedSpans.length > 0 && onDelete) onDelete();
      else onClose?.();
      return;
    }
    saveIfChanged();
  };

  const handlePaste = (e: React.ClipboardEvent): void => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    const children = parseClipboardText(text);
    if (children.length <= 1 || !onPasteMultiLine) {
      document.execCommand("insertText", false, text);
      return;
    }
    document.execCommand("insertText", false, children[0].text);
    onPasteMultiLine(children.slice(1), getSpans());
  };

  const moveCursorToEnd = (): void => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    const range = document.createRange();
    range.selectNodeContents(editorRef.current);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const handleWrapperClick = (e: React.MouseEvent): void => {
    if (e.target === e.currentTarget) moveCursorToEnd();
  };

  const handleEditorClick = (e: React.MouseEvent): void => {
    if (!(e.target instanceof Element) || !onActivateLink) return;
    const mark = e.target.closest("[data-href]");
    if (!(mark instanceof HTMLElement) || !editorRef.current?.contains(mark)) {
      return;
    }
    const href = mark.getAttribute("data-href");
    if (href === null) return;
    e.preventDefault();
    e.stopPropagation();
    const spans = getSpans();
    if (!spansEqual(spans, lastSavedSpans)) setLastSavedSpans(spans);
    onActivateLink(href, spans);
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
        style={style}
        contentEditable
        suppressContentEditableWarning
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onPaste={handlePaste}
        onInput={handleInput}
        onClick={handleEditorClick}
        aria-label={ariaLabel || "note editor"}
      />
    </span>
  );
}
