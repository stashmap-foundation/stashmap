import React, { useEffect, useLayoutEffect } from "react";
import { useEditorText } from "./EditorTextContext";
import { isEditableElement } from "./keyboardNavigation";
import { ParsedLine, parseClipboardText } from "../planner";
import { spansText } from "../core/nodeSpans";
import { parseInlineSpans } from "../core/markdownTree";
import { externalLinkUrl } from "../core/linkPath";
import { argumentColor, relevanceColor } from "./referenceDisplay";
import { INCOMING_ARROW, argumentChar, relevanceChar } from "./referenceText";
import {
  createEditableLinkMark,
  deleteSelection,
  replaceSelectionWithSpans,
  selectionMarkdown,
  spansFromEditor,
} from "./editorDom";

export function preventEditorBlur(e: React.MouseEvent): void {
  if (isEditableElement(document.activeElement)) {
    e.preventDefault();
  }
}

export type ReciprocalLink = {
  spanIndex: number;
  relevance?: Relevance;
  argument?: Argument;
};

type MiniEditorProps = {
  initialSpans: InlineSpan[];
  reciprocalLinks: ReciprocalLink[];
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

function recoverRewrittenLink(
  initialSpans: InlineSpan[],
  currentSpans: InlineSpan[]
): InlineSpan[] {
  const linkIndex = initialSpans.findIndex((span) => span.kind === "link");
  const link = initialSpans[linkIndex];
  const current = currentSpans[0];
  if (
    link?.kind !== "link" ||
    initialSpans.filter((span) => span.kind === "link").length !== 1 ||
    currentSpans.length !== 1 ||
    current?.kind !== "text"
  ) {
    return currentSpans;
  }
  const prefix = spansText(initialSpans.slice(0, linkIndex));
  const suffix = spansText(initialSpans.slice(linkIndex + 1));
  const comparable = current.text.replace(/\u00a0/gu, " ");
  if (!comparable.startsWith(prefix) || !comparable.endsWith(suffix)) {
    return currentSpans;
  }
  const end = comparable.length - suffix.length;
  const text = current.text.slice(prefix.length, end);
  if (text === "") return currentSpans;
  const before: InlineSpan[] =
    prefix === "" ? [] : [{ kind: "text", text: prefix }];
  const recovered: InlineSpan = { kind: "link", href: link.href, text };
  const after: InlineSpan[] =
    suffix === "" ? [] : [{ kind: "text", text: suffix }];
  return [...before, recovered, ...after];
}

function createExternalFurniture(): HTMLElement {
  const furniture = document.createElement("sup");
  furniture.setAttribute("class", "incoming-part external-link-part");
  furniture.setAttribute("data-link-furniture", "external");
  furniture.setAttribute("contenteditable", "false");
  furniture.setAttribute("aria-hidden", "true");
  furniture.replaceChildren(document.createTextNode("↗"));
  return furniture;
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
  reciprocalLinks,
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
    const noChildren: Node[] = [];
    const lastSpan = initialSpans[initialSpans.length - 1];
    const continuation =
      lastSpan?.kind === "link" ? [document.createTextNode("\u00a0")] : [];
    editor.replaceChildren(
      ...initialSpans.reduce((children, span, index) => {
        if (span.kind === "text") {
          return [...children, document.createTextNode(span.text)];
        }
        const mark = createEditableLinkMark(span);
        const externalFurniture = externalLinkUrl(span.href)
          ? [createExternalFurniture()]
          : [];
        const reciprocal = reciprocalLinks.find(
          (candidate) => candidate.spanIndex === index
        );
        if (!reciprocal) {
          return [...children, mark, ...externalFurniture];
        }
        const furniture = document.createElement("sup");
        furniture.setAttribute("class", "incoming-part");
        furniture.setAttribute("data-link-furniture", "reciprocal");
        furniture.setAttribute("contenteditable", "false");
        furniture.setAttribute("aria-hidden", "true");
        const relChar = relevanceChar(reciprocal.relevance);
        const argChar = argumentChar(reciprocal.argument);
        const relationParts = [
          ...(relChar
            ? [{ text: relChar, color: relevanceColor(reciprocal.relevance) }]
            : []),
          ...(argChar
            ? [{ text: argChar, color: argumentColor(reciprocal.argument) }]
            : []),
        ].map(({ text, color }) => {
          const part = document.createElement("span");
          if (color) part.setAttribute("style", `color: ${color}`);
          part.replaceChildren(document.createTextNode(text));
          return part;
        });
        furniture.replaceChildren(
          ...relationParts,
          document.createTextNode(INCOMING_ARROW)
        );
        return [...children, mark, ...externalFurniture, furniture];
      }, noChildren),
      ...continuation
    );
  }, [
    initialSpans,
    reciprocalLinks
      .map(
        ({ spanIndex, relevance, argument }) =>
          `${spanIndex}:${relevance ?? ""}:${argument ?? ""}`
      )
      .join(","),
  ]);

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

  const getSpans = (): InlineSpan[] =>
    recoverRewrittenLink(lastSavedSpans, spansFromEditor(editorRef.current));

  const saveIfChanged = (): void => {
    const spans = getSpans();
    if (spans.length === 0 || spansEqual(spans, lastSavedSpans)) return;
    setLastSavedSpans(spans);
    onSave(spans);
  };

  const handleInput = (e: React.FormEvent<HTMLSpanElement>): void => {
    const inputType =
      e.nativeEvent instanceof InputEvent ? e.nativeEvent.inputType : "";
    if (inputType === "historyUndo" || inputType === "historyRedo") return;
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

  const handleCopy = (e: React.ClipboardEvent): void => {
    if (!editorRef.current) return;
    const markdown = selectionMarkdown(editorRef.current);
    if (markdown === null) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", markdown);
  };

  const handleCut = (e: React.ClipboardEvent): void => {
    if (!editorRef.current) return;
    const markdown = selectionMarkdown(editorRef.current);
    if (markdown === null) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", markdown);
    deleteSelection(editorRef.current);
  };

  const handlePaste = (e: React.ClipboardEvent): void => {
    if (!editorRef.current) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    const children = parseClipboardText(text);
    if (children.length <= 1 || !onPasteMultiLine) {
      replaceSelectionWithSpans(editorRef.current, parseInlineSpans(text));
      return;
    }
    const inserted = replaceSelectionWithSpans(
      editorRef.current,
      parseInlineSpans(children[0].text)
    );
    if (inserted) onPasteMultiLine(children.slice(1), getSpans());
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
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
        onInput={handleInput}
        onClick={handleEditorClick}
        aria-label={ariaLabel || "note editor"}
      />
    </span>
  );
}
