import React, { useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useEditorText } from "./EditorTextContext";
import { isEditableElement } from "./keyboardNavigation";
import { useEntityLabels } from "../EntityLabelContext";
import { ParsedLine, parseClipboardText } from "../planner";
import { spansText } from "../core/nodeSpans";
import { parseInlineSpans } from "../core/markdownTree";
import { argumentColor, relevanceColor } from "./referenceDisplay";
import { INCOMING_ARROW, argumentChar, relevanceChar } from "./referenceText";
import {
  createEditableLinkMark,
  deleteSelection,
  editableTextBeforeSelection,
  replaceEditorTextRangeWithSpans,
  replaceSelectionWithSpans,
  selectionMarkdown,
  spansFromEditor,
} from "./editorDom";
import {
  EntityPickerCandidate,
  browserEntityLabelLanguages,
  defaultEntityMetadataFetcher,
  entityLabelLanguageOrder,
  responsePayload,
  wikidataSearchCandidatesFromResponse,
  wikidataSearchUrl,
} from "../entityLabels";

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

type EntityPickerConfig = {
  fetchEntityMetadata?: (url: string) => Promise<Response>;
};

type MiniEditorProps = {
  initialSpans: InlineSpan[];
  reciprocalLinks: ReciprocalLink[];
  deadLinkIndexes: number[];
  externalLinkIndexes: number[];
  calendarLinkIndexes: number[];
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
  entityPicker?: EntityPickerConfig;
};

type EntityPickerTrigger = {
  start: number;
  end: number;
  query: string;
};

type EntityPickerPosition = {
  top: number;
  left: number;
  minWidth: number;
};

const ENTITY_PICKER_DEBOUNCE_MS = 200;

function entityLinkHref(id: string): string {
  return `#${id}`;
}

function responseOk(response: Response): boolean {
  return !(response.status < 200 || response.status >= 300);
}

async function fetchWikidataCandidates(
  query: string,
  languages: readonly string[],
  fetcher: (url: string) => Promise<Response>,
  shouldContinue: () => boolean
): Promise<EntityPickerCandidate[]> {
  const searchUrl = wikidataSearchUrl(query, languages);
  if (!searchUrl || !shouldContinue()) {
    return [];
  }
  const searchResponse = await fetcher(searchUrl);
  if (!shouldContinue() || !responseOk(searchResponse)) {
    return [];
  }
  return wikidataSearchCandidatesFromResponse(
    await responsePayload(searchResponse)
  ).map((hit) => ({
    id: `wd:${hit.qid}`,
    label: hit.label,
    description: hit.description || hit.qid,
    source: "wikidata",
  }));
}

function pickerPositionFromEditor(
  editor: HTMLElement | null
): EntityPickerPosition | undefined {
  if (!editor) {
    return undefined;
  }
  const rect = editor.getBoundingClientRect();
  return {
    top: rect.bottom + 4,
    left: rect.left,
    minWidth: Math.max(280, rect.width),
  };
}

function samePickerTrigger(
  left: EntityPickerTrigger | undefined,
  right: EntityPickerTrigger | undefined
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    left.start === right.start &&
    left.end === right.end &&
    left.query === right.query
  );
}

function pickerTriggerFromEditor(
  editor: HTMLElement | null
): EntityPickerTrigger | undefined {
  if (!editor) {
    return undefined;
  }
  const text = editableTextBeforeSelection(editor);
  if (text === undefined) {
    return undefined;
  }
  const at = text.lastIndexOf("@");
  if (at < 0) {
    return undefined;
  }
  const previous = at === 0 ? "" : text[at - 1];
  const query = text.slice(at + 1);
  if (previous && /[\p{Letter}\p{Number}_]/u.test(previous)) {
    return undefined;
  }
  return { start: at, end: text.length, query };
}

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

function createDeadFurniture(): HTMLElement {
  const furniture = document.createElement("sup");
  furniture.setAttribute("class", "incoming-part dead-link-part");
  furniture.setAttribute("data-link-furniture", "dead");
  furniture.setAttribute("contenteditable", "false");
  furniture.setAttribute("aria-hidden", "true");
  furniture.replaceChildren(document.createTextNode("†"));
  return furniture;
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
  deadLinkIndexes,
  externalLinkIndexes,
  calendarLinkIndexes,
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
  entityPicker,
}: MiniEditorProps): JSX.Element {
  const editorRef = React.useRef<HTMLSpanElement>(null);
  const [lastSavedSpans, setLastSavedSpans] = React.useState(initialSpans);
  const [pickerTrigger, setPickerTrigger] = React.useState<
    EntityPickerTrigger | undefined
  >(undefined);
  const [remoteCandidates, setRemoteCandidates] = React.useState<
    EntityPickerCandidate[]
  >([]);
  const [remotePending, setRemotePending] = React.useState(false);
  const [activeCandidateIndex, setActiveCandidateIndex] = React.useState(0);
  const [pickerPosition, setPickerPosition] = React.useState<
    EntityPickerPosition | undefined
  >(undefined);
  const [dismissedPickerStart, setDismissedPickerStart] = React.useState<
    number | undefined
  >(undefined);

  const editorTextContext = useEditorText();
  const { localEntityCandidates } = useEntityLabels();
  const entityPickerEnabled = entityPicker !== undefined;
  const pickerFetch = entityPicker?.fetchEntityMetadata;
  const languages = React.useMemo(
    () => entityLabelLanguageOrder(browserEntityLabelLanguages()),
    []
  );
  const entityFetch = React.useMemo(
    () => pickerFetch ?? defaultEntityMetadataFetcher(),
    [pickerFetch]
  );
  const localCandidates = React.useMemo(
    () => (pickerTrigger ? localEntityCandidates(pickerTrigger.query) : []),
    [localEntityCandidates, pickerTrigger]
  );
  const pickerCandidates = React.useMemo(
    () =>
      pickerTrigger
        ? [
            ...localCandidates,
            ...remoteCandidates.filter(
              (candidate) =>
                !localCandidates.some((local) => local.id === candidate.id)
            ),
          ]
        : [],
    [localCandidates, pickerTrigger, remoteCandidates]
  );

  useEffect(() => {
    setLastSavedSpans(initialSpans);
  }, [initialSpans]);

  useEffect(() => {
    if (
      !pickerTrigger ||
      !entityPickerEnabled ||
      pickerTrigger.query.trim() === ""
    ) {
      setRemoteCandidates([]);
      setRemotePending(false);
      return undefined;
    }
    const { query } = pickerTrigger;
    const abort = new AbortController();
    const shouldContinue = (): boolean => !abort.signal.aborted;
    setRemoteCandidates([]);
    setRemotePending(true);
    const timeout = window.setTimeout(() => {
      fetchWikidataCandidates(query, languages, entityFetch, shouldContinue)
        .then((candidates) => {
          if (shouldContinue()) {
            setRemoteCandidates(candidates);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (shouldContinue()) {
            setRemotePending(false);
          }
        });
    }, ENTITY_PICKER_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timeout);
      abort.abort();
    };
  }, [entityPickerEnabled, languages, pickerTrigger]);

  useEffect(() => {
    if (activeCandidateIndex >= pickerCandidates.length) {
      setActiveCandidateIndex(0);
    }
  }, [activeCandidateIndex, pickerCandidates.length]);

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
        const dead = deadLinkIndexes.includes(index);
        const external = externalLinkIndexes.includes(index);
        const mark = createEditableLinkMark(
          span,
          dead,
          external,
          !calendarLinkIndexes.includes(index)
        );
        const externalFurniture = external ? [createExternalFurniture()] : [];
        const deadFurniture = dead ? [createDeadFurniture()] : [];
        const reciprocal = reciprocalLinks.find(
          (candidate) => candidate.spanIndex === index
        );
        if (!reciprocal) {
          return [...children, mark, ...externalFurniture, ...deadFurniture];
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
        return [
          ...children,
          mark,
          ...externalFurniture,
          ...deadFurniture,
          furniture,
        ];
      }, noChildren),
      ...continuation
    );
  }, [
    initialSpans,
    deadLinkIndexes.join(","),
    externalLinkIndexes.join(","),
    calendarLinkIndexes.join(","),
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

  const refreshPicker = (): void => {
    if (!entityPicker) {
      return;
    }
    const nextTrigger = pickerTriggerFromEditor(editorRef.current);
    if (
      dismissedPickerStart !== undefined &&
      (!nextTrigger || nextTrigger.start !== dismissedPickerStart)
    ) {
      setDismissedPickerStart(undefined);
    }
    const visibleTrigger =
      nextTrigger?.start === dismissedPickerStart ? undefined : nextTrigger;
    if (samePickerTrigger(pickerTrigger, visibleTrigger)) {
      return;
    }
    setPickerTrigger(visibleTrigger);
    setPickerPosition(
      visibleTrigger ? pickerPositionFromEditor(editorRef.current) : undefined
    );
    setActiveCandidateIndex(0);
    if (visibleTrigger) {
      return;
    }
    setRemoteCandidates([]);
    setRemotePending(false);
  };

  const chooseEntityCandidate = (
    candidate: EntityPickerCandidate | undefined
  ): void => {
    const editor = editorRef.current;
    if (!editor || !pickerTrigger || !candidate) {
      return;
    }
    const inserted = replaceEditorTextRangeWithSpans(
      editor,
      pickerTrigger.start,
      pickerTrigger.end,
      [
        {
          kind: "link",
          href: entityLinkHref(candidate.id),
          text: candidate.label,
        },
        { kind: "text", text: " " },
      ]
    );
    if (!inserted) {
      return;
    }
    setPickerTrigger(undefined);
    setPickerPosition(undefined);
    setDismissedPickerStart(undefined);
    setRemoteCandidates([]);
    setRemotePending(false);
    editorTextContext?.setSpans(getSpans());
  };

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
    refreshPicker();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (pickerTrigger) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveCandidateIndex((index) =>
          pickerCandidates.length === 0
            ? 0
            : (index + 1) % pickerCandidates.length
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveCandidateIndex((index) =>
          pickerCandidates.length === 0
            ? 0
            : (index + pickerCandidates.length - 1) % pickerCandidates.length
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        const candidate = pickerCandidates[activeCandidateIndex];
        if (candidate) {
          e.preventDefault();
          chooseEntityCandidate(candidate);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPickerTrigger(undefined);
        setPickerPosition(undefined);
        setDismissedPickerStart(pickerTrigger.start);
        setRemoteCandidates([]);
        setRemotePending(false);
        return;
      }
    }
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
    if (!(e.target instanceof Element) || !onActivateLink) {
      refreshPicker();
      return;
    }
    const mark = e.target.closest("[data-href]");
    if (!(mark instanceof HTMLElement) || !editorRef.current?.contains(mark)) {
      refreshPicker();
      return;
    }
    const href = mark.getAttribute("data-href");
    if (
      href === null ||
      !mark.classList.contains("inline-link") ||
      mark.getAttribute("data-link-dead") === "true"
    ) {
      refreshPicker();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const spans = getSpans();
    if (!spansEqual(spans, lastSavedSpans)) setLastSavedSpans(spans);
    onActivateLink(href, spans);
  };

  const pickerStatus = remotePending ? "Searching Wikidata…" : "No entities";
  const picker =
    pickerTrigger && entityPicker && pickerPosition
      ? createPortal(
          <span
            className="entity-picker"
            role="listbox"
            aria-label="entity suggestions"
            style={{
              top: pickerPosition.top,
              left: pickerPosition.left,
              minWidth: pickerPosition.minWidth,
            }}
          >
            {pickerCandidates.map((candidate, index) => {
              const active = index === activeCandidateIndex;
              return (
                <button
                  key={`${candidate.source}:${candidate.id}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  aria-label={`Insert entity ${candidate.label} ${candidate.id}`}
                  className={`entity-picker-option${
                    active ? " entity-picker-option-active" : ""
                  }`}
                  onMouseDown={preventEditorBlur}
                  onClick={() => chooseEntityCandidate(candidate)}
                >
                  <span className="entity-picker-line">
                    <span className="entity-picker-label">
                      {candidate.label}
                    </span>
                    <span className="entity-picker-id">{candidate.id}</span>
                    <span className="entity-picker-source">
                      {candidate.source}
                    </span>
                  </span>
                  <span className="entity-picker-description">
                    {candidate.description}
                  </span>
                </button>
              );
            })}
            {pickerCandidates.length === 0 && (
              <span className="entity-picker-empty">{pickerStatus}</span>
            )}
          </span>,
          document.body
        )
      : null;

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
      {picker}
    </span>
  );
}
