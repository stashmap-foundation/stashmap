import type { CSSProperties } from "react";
import { classifyLinkHref, externalLinkUrl } from "../core/linkPath";
import { spansText, spansToMarkdown } from "../core/nodeSpans";

function appendSpan(spans: InlineSpan[], span: InlineSpan): InlineSpan[] {
  if (span.text === "") return spans;
  const previous = spans[spans.length - 1];
  if (previous?.kind === "text" && span.kind === "text") {
    return [
      ...spans.slice(0, -1),
      { kind: "text", text: previous.text + span.text },
    ];
  }
  if (
    previous?.kind === "link" &&
    span.kind === "link" &&
    previous.href === span.href
  ) {
    return [
      ...spans.slice(0, -1),
      { ...previous, text: previous.text + span.text },
    ];
  }
  return [...spans, span];
}

function domText(node: Node): string {
  return (node.textContent ?? "").replace(/\u00a0/gu, " ");
}

function spansFromDomNode(
  node: Node,
  inheritedHref: string | null
): InlineSpan[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = domText(node);
    if (text === "") return [];
    return inheritedHref === null
      ? [{ kind: "text", text }]
      : [{ kind: "link", href: inheritedHref, text }];
  }
  if (node instanceof HTMLElement && node.hasAttribute("data-link-furniture")) {
    return [];
  }
  const href =
    node instanceof HTMLElement
      ? node.getAttribute("data-href") ?? inheritedHref
      : inheritedHref;
  return Array.from(node.childNodes).reduce<InlineSpan[]>(
    (spans, child) => spansFromDomNode(child, href).reduce(appendSpan, spans),
    []
  );
}

function trimSpans(spans: InlineSpan[]): InlineSpan[] {
  if (spans.length === 0) return spans;
  return spans
    .map((span, index) => {
      const withoutLeading = index === 0 ? span.text.trimStart() : span.text;
      const text =
        index === spans.length - 1 ? withoutLeading.trimEnd() : withoutLeading;
      return { ...span, text };
    })
    .filter((span) => span.text !== "");
}

function containingMark(node: Node, editor: HTMLElement): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  const mark = element?.closest("[data-href]");
  return mark instanceof HTMLElement && editor.contains(mark) ? mark : null;
}

export function spansFromEditor(editor: HTMLElement | null): InlineSpan[] {
  if (!editor) return [];
  return trimSpans(spansFromDomNode(editor, null));
}

function editableTextNodes(node: Node): Text[] {
  if (node instanceof HTMLElement && node.hasAttribute("data-link-furniture")) {
    return [];
  }
  if (node instanceof Text) {
    return [node];
  }
  return Array.from(node.childNodes).flatMap(editableTextNodes);
}

function textPointAtOffset(
  editor: HTMLElement,
  targetOffset: number
): { node: Node; offset: number } | undefined {
  if (targetOffset < 0) return undefined;
  const textNodes = editableTextNodes(editor);
  const found = textNodes.reduce<{
    remaining: number;
    point?: { node: Node; offset: number };
  }>(
    (state, node) => {
      const { point, remaining } = state;
      if (point) return state;
      const { length } = domText(node);
      if (remaining <= length) {
        return { remaining: 0, point: { node, offset: remaining } };
      }
      return { remaining: remaining - length };
    },
    { remaining: targetOffset }
  );
  if (found.point) return found.point;
  return found.remaining === 0
    ? { node: editor, offset: editor.childNodes.length }
    : undefined;
}

export function selectionMarkdown(editor: HTMLElement): string | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (
    !editor.contains(range.startContainer) ||
    !editor.contains(range.endContainer)
  ) {
    return null;
  }
  const startMark = containingMark(range.startContainer, editor);
  const endMark = containingMark(range.endContainer, editor);
  if (startMark && startMark === endMark) {
    const href = startMark.getAttribute("data-href");
    const text = domText(range.cloneContents());
    return href !== null && text !== ""
      ? spansToMarkdown([{ kind: "link", href, text }])
      : null;
  }
  return spansToMarkdown(spansFromDomNode(range.cloneContents(), null));
}

export function linkStyleForHref(href: string, dead: boolean): CSSProperties {
  if (dead) return { color: "var(--base01)", cursor: "default" };
  const targetClass = classifyLinkHref(href);
  if (targetClass === "entity") return { color: "var(--violet)" };
  if (targetClass === "website" || targetClass === "feed") {
    return { textDecoration: "underline" };
  }
  if (targetClass === "unsupported") return {};
  return {
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textDecorationThickness: "1px",
    textUnderlineOffset: "3px",
    textDecorationColor: "var(--base01)",
  };
}

function styleAttribute(style: CSSProperties): string {
  return Object.entries(style)
    .map(
      ([property, value]) =>
        `${property.replace(
          /[A-Z]/gu,
          (letter) => `-${letter.toLowerCase()}`
        )}: ${String(value)}`
    )
    .join("; ");
}

export function createEditableLinkMark(
  span: Extract<InlineSpan, { kind: "link" }>,
  dead: boolean,
  external: boolean,
  interactive: boolean
): HTMLSpanElement {
  const mark = document.createElement("span");
  mark.setAttribute("data-href", span.href);
  mark.setAttribute("data-target", span.href);
  if (interactive) {
    mark.setAttribute("role", "link");
    mark.setAttribute("class", "inline-link");
  }
  if (dead) {
    mark.setAttribute("data-link-dead", "true");
    mark.setAttribute("aria-disabled", "true");
    mark.setAttribute("aria-label", `${span.text}. Target no longer exists`);
  } else if (external) {
    mark.setAttribute("aria-label", `${span.text} (opens externally)`);
  }
  const style = styleAttribute(
    interactive ? linkStyleForHref(span.href, dead) : {}
  );
  if (style) mark.setAttribute("style", style);
  mark.replaceChildren(document.createTextNode(span.text));
  return mark;
}

function nodeForEditableSpan(span: InlineSpan): Node {
  return span.kind === "text"
    ? document.createTextNode(span.text)
    : createEditableLinkMark(
        span,
        false,
        externalLinkUrl(span.href) !== undefined,
        true
      );
}

function htmlForSpans(spans: InlineSpan[]): string {
  const container = document.createElement("div");
  container.replaceChildren(...spans.map(nodeForEditableSpan));
  return container.innerHTML;
}

function executeCommand(command: string, value: string): boolean {
  if (typeof document.execCommand !== "function") return false;
  return document.execCommand(command, false, value);
}

function selectionRange(editor: HTMLElement): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  return editor.contains(range.startContainer) &&
    editor.contains(range.endContainer)
    ? range
    : null;
}

export function editableTextBeforeSelection(
  editor: HTMLElement
): string | undefined {
  const range = selectionRange(editor);
  if (!range || !range.collapsed) return undefined;
  const before = document.createRange();
  before.selectNodeContents(editor);
  before.setEnd(range.startContainer, range.startOffset);
  return spansText(spansFromDomNode(before.cloneContents(), null));
}

function markTextBefore(mark: HTMLElement, range: Range): string {
  const before = document.createRange();
  before.selectNodeContents(mark);
  before.setEnd(range.startContainer, range.startOffset);
  return domText(before.cloneContents());
}

function markTextAfter(mark: HTMLElement, range: Range): string {
  const after = document.createRange();
  after.selectNodeContents(mark);
  after.setStart(range.endContainer, range.endOffset);
  return domText(after.cloneContents());
}

function followingLinkMarks(node: ChildNode | null): HTMLElement[] {
  if (!(node instanceof HTMLElement) || !node.hasAttribute("data-href")) {
    return [];
  }
  return [node, ...followingLinkMarks(node.nextSibling)];
}

function spanFromMark(mark: HTMLElement): InlineSpan[] {
  const href = mark.getAttribute("data-href");
  const text = domText(mark);
  return href === null || text === "" ? [] : [{ kind: "link", href, text }];
}

function placeBeforeAfterSpans(
  parent: Node,
  next: ChildNode | null,
  afterCount: number
): void {
  const children = Array.from(parent.childNodes);
  const end = next === null ? children.length : children.indexOf(next);
  const firstAfter = children[end - afterCount];
  if (!firstAfter) return;
  const range = document.createRange();
  range.setStartBefore(firstAfter);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function replaceSelectionWithSpans(
  editor: HTMLElement,
  spans: InlineSpan[]
): boolean {
  if (spans.length === 0) return false;
  const range = selectionRange(editor);
  if (!range) return false;
  const startMark = containingMark(range.startContainer, editor);
  const endMark = containingMark(range.endContainer, editor);
  const insertsLink = spans.some((span) => span.kind === "link");
  if (!insertsLink || (!startMark && !endMark)) {
    return executeCommand("insertHTML", htmlForSpans(spans));
  }
  const startHref = startMark?.getAttribute("data-href") ?? null;
  const endHref = endMark?.getAttribute("data-href") ?? null;
  if ((startMark && !startHref) || (endMark && !endHref)) return false;
  const beforeText = startMark ? markTextBefore(startMark, range) : "";
  const afterText = endMark ? markTextAfter(endMark, range) : "";
  const before: InlineSpan[] =
    beforeText === "" || startHref === null
      ? []
      : [{ kind: "link", href: startHref, text: beforeText }];
  const following = followingLinkMarks(endMark?.nextSibling ?? null);
  const remainder: InlineSpan[] =
    afterText === "" || endHref === null
      ? []
      : [{ kind: "link", href: endHref, text: afterText }];
  const after = [...remainder, ...following.flatMap(spanFromMark)];
  const lastFollowing = following[following.length - 1];
  const trailingMark = lastFollowing ?? endMark;
  const trailingParent = trailingMark?.parentNode ?? null;
  const next = trailingMark?.nextSibling ?? null;
  if (startMark && startMark === endMark) {
    range.selectNode(startMark);
  } else if (startMark) {
    range.setStartBefore(startMark);
  }
  if (lastFollowing) range.setEndAfter(lastFollowing);
  else if (endMark && startMark !== endMark) range.setEndAfter(endMark);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  const inserted = executeCommand(
    "insertHTML",
    htmlForSpans([...before, ...spans, ...after])
  );
  if (inserted && after.length > 0 && trailingParent) {
    placeBeforeAfterSpans(trailingParent, next, after.length);
  }
  return inserted;
}

function replaceRangeContentsWithSpans(
  editor: HTMLElement,
  range: Range,
  spans: InlineSpan[]
): boolean {
  const nodes = spans.map(nodeForEditableSpan);
  const lastNode = nodes[nodes.length - 1];
  if (!lastNode) return false;
  const selection = window.getSelection();
  range.deleteContents();
  const fragment = document.createDocumentFragment();
  fragment.replaceChildren(...nodes);
  range.insertNode(fragment);
  const after = document.createRange();
  if (lastNode instanceof Text) {
    after.setStart(lastNode, lastNode.data.length);
  } else {
    after.setStartAfter(lastNode);
  }
  after.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(after);
  return editor.contains(lastNode);
}

export function replaceEditorTextRangeWithSpans(
  editor: HTMLElement,
  startOffset: number,
  endOffset: number,
  spans: InlineSpan[]
): boolean {
  const start = textPointAtOffset(editor, startOffset);
  const end = textPointAtOffset(editor, endOffset);
  const lastSpan = spans[spans.length - 1];
  if (!start || !end || !lastSpan || endOffset < startOffset) return false;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  if (
    (containingMark(range.startContainer, editor) ||
      containingMark(range.endContainer, editor)) &&
    replaceSelectionWithSpans(editor, spans)
  ) {
    return true;
  }
  return replaceRangeContentsWithSpans(editor, range, spans);
}

export function deleteSelection(editor: HTMLElement): boolean {
  const range = selectionRange(editor);
  if (!range || range.collapsed) return false;
  return executeCommand("delete", "");
}
