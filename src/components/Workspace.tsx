import React, { useEffect, useRef, useState } from "react";
import { TemporaryViewProvider } from "./TemporaryViewContext";

import {
  getNodeFromID,
  useViewPath,
  useIsViewingOtherUserContent,
} from "../ViewContext";
import { useData } from "../DataContext";
import {
  useSplitPanes,
  useCurrentPane,
  usePaneStack,
  usePaneIndex,
} from "../SplitPanesContext";
import { useNavigationState } from "../NavigationStateContext";
import { TreeView } from "./TreeView";
import {
  PaneSearchButton,
  PaneSettingsMenu,
  ClosePaneButton,
} from "./SplitPaneLayout";
import { InlineFilterDots } from "./TypeFilterButton";
import { NewPaneButton } from "./OpenInSplitPaneButton";
import { PublishingStatusWrapper } from "./PublishingStatusWrapper";
import { SignInMenuBtn } from "../SignIn";
import { usePlanner, planForkPane } from "../planner";
import { LOG_NODE_ID } from "../connections";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import {
  focusRow,
  getFocusableRows,
  getRowDepth,
  getRowFromElement,
  getRowKey,
  isEditableElement,
} from "./keyboardNavigation";

function BreadcrumbItem({
  nodeID,
  onClick,
  isLast,
}: {
  nodeID: LongID | ID;
  onClick: () => void;
  isLast: boolean;
}): JSX.Element {
  const { knowledgeDBs, user } = useData();
  const node = getNodeFromID(knowledgeDBs, nodeID as string, user.publicKey);

  if (isLast) {
    return (
      <span className="breadcrumb-current">{node?.text || "Loading..."}</span>
    );
  }

  return (
    <>
      <button
        type="button"
        className="breadcrumb-link"
        onClick={onClick}
        aria-label={`Navigate to ${node?.text || "parent"}`}
      >
        {node?.text || "Loading..."}
      </button>
      <span className="breadcrumb-separator">/</span>
    </>
  );
}

function Breadcrumbs(): JSX.Element {
  const { setPane } = useSplitPanes();
  const pane = useCurrentPane();
  const stack = usePaneStack();

  const popTo = (index: number): void => {
    setPane({ ...pane, stack: stack.slice(0, index + 1) });
  };

  return (
    <nav className="breadcrumbs" aria-label="Navigation breadcrumbs">
      {stack.map((nodeID, index) => (
        <BreadcrumbItem
          key={nodeID as string}
          nodeID={nodeID}
          onClick={() => popTo(index)}
          isLast={index === stack.length - 1}
        />
      ))}
    </nav>
  );
}

function ForkButton(): JSX.Element | null {
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const viewPath = useViewPath();
  const stack = usePaneStack();
  const { createPlan, executePlan } = usePlanner();

  if (!isViewingOtherUserContent) {
    return null;
  }

  const handleFork = (): void => {
    const plan = planForkPane(createPlan(), viewPath, stack);
    executePlan(plan);
  };

  return (
    <button
      type="button"
      className="header-action-btn"
      onClick={handleFork}
      aria-label="fork to make your own copy"
    >
      fork
    </button>
  );
}

function HomeButton(): JSX.Element | null {
  const { setPane } = useSplitPanes();
  const pane = useCurrentPane();
  const { knowledgeDBs, user } = useData();

  const logNode = getNodeFromID(knowledgeDBs, LOG_NODE_ID, user.publicKey);
  if (!logNode) {
    return null;
  }

  const handleClick = (): void => {
    setPane({
      ...pane,
      author: user.publicKey,
      stack: [LOG_NODE_ID],
      rootRelation: undefined,
    });
  };

  return (
    <button
      type="button"
      className="btn btn-icon"
      onClick={handleClick}
      data-pane-action="home"
      aria-label="Navigate to Log"
      title="Log"
    >
      <span aria-hidden="true">⌂</span>
    </button>
  );
}

function NewNoteButton(): JSX.Element {
  const { setPane } = useSplitPanes();
  const pane = useCurrentPane();

  const handleClick = (): void => {
    setPane({ ...pane, stack: [], rootRelation: undefined });
  };

  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={handleClick}
      data-pane-action="new-note"
      aria-label="Create new note"
    >
      New
    </button>
  );
}

function useHomeShortcut(): void {
  const { setPane } = useSplitPanes();
  const pane = useCurrentPane();
  const { knowledgeDBs, user } = useData();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === "h") {
        const logNode = getNodeFromID(
          knowledgeDBs,
          LOG_NODE_ID,
          user.publicKey
        );
        if (logNode) {
          e.preventDefault();
          setPane({
            ...pane,
            author: user.publicKey,
            stack: [LOG_NODE_ID],
            rootRelation: undefined,
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setPane, pane, knowledgeDBs, user.publicKey]);
}

function BackButton(): JSX.Element | null {
  const { setPane } = useSplitPanes();
  const pane = useCurrentPane();
  const stack = usePaneStack();

  if (stack.length <= 1) {
    return null;
  }

  const handleBack = (): void => {
    setPane({ ...pane, stack: stack.slice(0, -1) });
  };

  return (
    <button
      type="button"
      className="btn btn-icon"
      onClick={handleBack}
      data-pane-action="back"
      aria-label="Go back"
      title="Back"
    >
      <span aria-hidden="true">&larr;</span>
    </button>
  );
}

function PaneHeader(): JSX.Element {
  const paneIndex = usePaneIndex();
  const isFirstPane = paneIndex === 0;
  useHomeShortcut();

  return (
    <header className="pane-header">
      <div className="pane-header-left">
        <BackButton />
        <Breadcrumbs />
        <ForkButton />
        {isFirstPane && <SignInMenuBtn />}
      </div>
      <div className="pane-header-right">
        <HomeButton />
        <NewNoteButton />
        <InlineFilterDots />
        <PaneSearchButton />
        <NewPaneButton />
        <ClosePaneButton />
      </div>
    </header>
  );
}

function CurrentNodeName(): JSX.Element {
  const { knowledgeDBs, user } = useData();
  const stack = usePaneStack();
  const currentNodeID = stack[stack.length - 1];

  if (!currentNodeID) {
    return <span>New Note</span>;
  }

  const node = getNodeFromID(
    knowledgeDBs,
    currentNodeID as string,
    user.publicKey
  );
  const displayName = node?.text || "...";
  const truncated =
    displayName.length > 20 ? `${displayName.slice(0, 20)}…` : displayName;

  return <span>{truncated}</span>;
}

function PaneStatusLine(): JSX.Element {
  const paneIndex = usePaneIndex();
  const isFirstPane = paneIndex === 0;
  const isViewingOtherUserContent = useIsViewingOtherUserContent();

  return (
    <footer className="pane-status-line">
      <div className="status-segment">
        <CurrentNodeName />
      </div>
      <div
        className={`status-spacer ${
          isViewingOtherUserContent ? "status-readonly" : ""
        }`}
      >
        {isViewingOtherUserContent && "READONLY"}
      </div>
      {isFirstPane && <PublishingStatusWrapper />}
      {isFirstPane && (
        <div className="status-segment">
          <PaneSettingsMenu />
        </div>
      )}
    </footer>
  );
}

const FILTER_ARIA_LABELS = {
  "1": "toggle Relevant filter",
  "2": "toggle Maybe Relevant filter",
  "3": "toggle Little Relevant filter",
  "4": "toggle Not Relevant filter",
  "5": "toggle Contains filter",
  "6": "toggle Confirms filter",
  "7": "toggle Contradicts filter",
  "8": "toggle Suggestions filter",
} as const;

const FILTER_SYMBOL_TO_KEY = {
  "!": "1",
  "?": "2",
  "~": "3",
  x: "4",
  o: "5",
  "+": "6",
  "-": "7",
  "@": "8",
} as const;

type Evidence = "none" | "confirms" | "contra";

function getActiveRow(root: HTMLElement): HTMLElement | undefined {
  const rows = getFocusableRows(root);
  const active = rows.find((row) => row.tabIndex === 0);
  return active || rows[0];
}

function focusRowAt(root: HTMLElement, index: number): void {
  const rows = getFocusableRows(root);
  const target = rows[index];
  focusRow(target);
}

function focusParentRow(root: HTMLElement, activeRow: HTMLElement): void {
  const rows = getFocusableRows(root);
  const activeIndex = rows.findIndex(
    (row) => getRowKey(row) === getRowKey(activeRow)
  );
  if (activeIndex <= 0) {
    return;
  }
  const activeDepth = getRowDepth(activeRow);
  const parent = rows
    .slice(0, activeIndex)
    .reverse()
    .find((row) => getRowDepth(row) < activeDepth);
  focusRow(parent);
}

function focusFirstChildRow(root: HTMLElement, activeRow: HTMLElement): void {
  const rows = getFocusableRows(root);
  const activeIndex = rows.findIndex(
    (row) => getRowKey(row) === getRowKey(activeRow)
  );
  if (activeIndex < 0 || activeIndex >= rows.length - 1) {
    return;
  }
  const activeDepth = getRowDepth(activeRow);
  const child = rows
    .slice(activeIndex + 1)
    .find((row) => getRowDepth(row) === activeDepth + 1);
  focusRow(child);
}

function focusRowEditor(activeRow: HTMLElement): void {
  const editor = activeRow.querySelector(
    '[role="textbox"][aria-label^="edit "], [role="textbox"][aria-label="new node editor"]'
  );
  if (editor instanceof HTMLElement) {
    editor.focus();
    if (
      editor instanceof HTMLInputElement ||
      editor instanceof HTMLTextAreaElement
    ) {
      const end = editor.value.length;
      editor.setSelectionRange(end, end);
      return;
    }
    if (editor.isContentEditable) {
      const selection = window.getSelection();
      if (!selection) {
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
}

function focusAdjacentRowEditor(
  root: HTMLElement,
  currentRow: HTMLElement,
  delta: -1 | 1
): void {
  const currentIndex = Number(currentRow.getAttribute("data-row-index") || "0");
  const targetIndex = currentIndex + delta;
  const rows = getFocusableRows(root);
  const targetRow = rows[targetIndex];
  if (!targetRow) {
    return;
  }
  focusRow(targetRow);
  focusRowEditor(targetRow);
}

function toggleRowOpenInSplitPane(activeRow: HTMLElement): void {
  const button = activeRow.querySelector(
    '[data-node-action="open-split-pane"], button[aria-label="open in split pane"]'
  );
  if (button instanceof HTMLElement) {
    button.click();
  }
}

function toggleRowOpenFullscreen(activeRow: HTMLElement): void {
  const button = activeRow.querySelector(
    '[data-node-action="open-fullscreen"], button[aria-label*="in fullscreen"], button[aria-label="open fullscreen"]'
  );
  if (button instanceof HTMLElement) {
    button.click();
  }
}

function togglePaneFilter(root: HTMLElement, key: string): void {
  const ariaLabel = FILTER_ARIA_LABELS[key as keyof typeof FILTER_ARIA_LABELS];
  if (!ariaLabel) {
    return;
  }
  const button = root.querySelector(`button[aria-label="${ariaLabel}"]`);
  if (button instanceof HTMLElement) {
    button.click();
  }
}

function triggerPaneHome(root: HTMLElement): void {
  const homeButton = root.querySelector('[data-pane-action="home"]');
  if (homeButton instanceof HTMLElement) {
    homeButton.click();
  }
}

function getPaneWrappers(): HTMLElement[] {
  return Array.from(document.querySelectorAll(".pane-wrapper")).filter(
    (el): el is HTMLElement => el instanceof HTMLElement
  );
}

function getSelectedPaneRoot(): HTMLElement | null {
  return (
    getPaneWrappers().find(
      (pane) => pane.getAttribute("data-keyboard-pane-selected") === "true"
    ) || null
  );
}

function setSelectedPane(targetPane: HTMLElement): void {
  getPaneWrappers().forEach((pane) =>
    pane.removeAttribute("data-keyboard-pane-selected")
  );
  targetPane.setAttribute("data-keyboard-pane-selected", "true");
}

function triggerRowRelevanceSymbol(
  activeRow: HTMLElement,
  symbol: "x" | "~" | "?" | "!"
): void {
  const buttons = Array.from(
    activeRow.querySelectorAll(".relevance-selector [role='button']")
  ).filter((el): el is HTMLElement => el instanceof HTMLElement);
  const target = buttons.find(
    (button) => button.textContent?.trim().toLowerCase() === symbol
  );
  if (target) {
    target.click();
  }
}

function getCurrentEvidence(activeRow: HTMLElement): Evidence {
  const button = activeRow.querySelector(".evidence-selector[role='button']");
  if (!(button instanceof HTMLElement)) {
    return "none";
  }
  const ariaLabel = (button.getAttribute("aria-label") || "").toLowerCase();
  if (ariaLabel.includes("confirms")) {
    return "confirms";
  }
  if (ariaLabel.includes("contradicts")) {
    return "contra";
  }
  return "none";
}

function getEvidenceSteps(from: Evidence, to: Evidence): number {
  if (from === to) return 0;
  if (from === "none" && to === "confirms") return 1;
  if (from === "none" && to === "contra") return 2;
  if (from === "confirms" && to === "contra") return 1;
  if (from === "confirms" && to === "none") return 2;
  if (from === "contra" && to === "none") return 1;
  return 2;
}

function setEvidenceSymbol(activeRow: HTMLElement, target: Evidence): void {
  const button = activeRow.querySelector(".evidence-selector[role='button']");
  if (!(button instanceof HTMLElement)) {
    return;
  }
  const current = getCurrentEvidence(activeRow);
  const steps = getEvidenceSteps(current, target);
  Array.from({ length: steps }).forEach(() => button.click());
}

function refocusPaneAfterRowMutation(root: HTMLElement): void {
  window.setTimeout(() => {
    const { activeElement } = document;
    if (activeElement instanceof HTMLElement && root.contains(activeElement)) {
      return;
    }
    const activeRow = getActiveRow(root);
    if (activeRow) {
      focusRow(activeRow);
      return;
    }
    root.focus();
  }, 0);
}

function usePaneKeyboardNavigation(paneIndex: number): {
  wrapperRef: React.RefObject<HTMLDivElement>;
  onKeyDownCapture: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaneMouseEnter: () => void;
  onPaneMouseMove: () => void;
  onPaneFocusCapture: () => void;
  showShortcuts: boolean;
  setShowShortcuts: React.Dispatch<React.SetStateAction<boolean>>;
} {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const { setActivePaneIndex } = useNavigationState();

  const setKeyboardNavActive = (active: boolean): void => {
    const root = wrapperRef.current;
    if (!root) {
      return;
    }
    root.classList.toggle("keyboard-nav-active", active);
  };

  const activatePaneKeyboardContext = (targetPane: HTMLElement): void => {
    setSelectedPane(targetPane);
    getPaneWrappers().forEach((pane) =>
      pane.classList.remove("keyboard-nav-active")
    );
    targetPane.classList.add("keyboard-nav-active");
  };

  const switchPane = (direction: -1 | 1): void => {
    const root = wrapperRef.current;
    if (!root) {
      return;
    }
    const allPanes = getPaneWrappers();
    const currentIndex = allPanes.findIndex((pane) => pane === root);
    if (currentIndex < 0) {
      return;
    }
    const targetIndex = Math.max(
      0,
      Math.min(allPanes.length - 1, currentIndex + direction)
    );
    if (targetIndex === currentIndex) {
      return;
    }
    const targetPane = allPanes[targetIndex];
    activatePaneKeyboardContext(targetPane);
    targetPane.focus();
    setActivePaneIndex(targetIndex);
    const targetRow = getActiveRow(targetPane);
    if (targetRow) {
      focusRow(targetRow);
    }
  };

  useEffect(() => {
    const root = wrapperRef.current;
    if (!root) {
      return () => {};
    }
    if (paneIndex === 0 && !getSelectedPaneRoot()) {
      setSelectedPane(root);
    }
    const { activeElement } = document;
    const hasFocusInsidePane =
      activeElement instanceof HTMLElement && root.contains(activeElement);
    if (hasFocusInsidePane) {
      return () => {};
    }
    if (activeElement && activeElement !== document.body) {
      return () => {};
    }
    const id = window.setTimeout(() => {
      if (document.activeElement === document.body || !document.activeElement) {
        root.focus();
      }
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, [paneIndex]);

  useEffect(() => {
    const root = wrapperRef.current;
    if (!root) {
      return () => {};
    }
    const onGlobalKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) {
        return;
      }
      if (showShortcuts) {
        if (e.key === "Escape") {
          e.preventDefault();
          setShowShortcuts(false);
        }
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "j" && e.key !== "Escape") {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      if (isEditableElement(e.target)) {
        return;
      }
      if (e.target instanceof HTMLElement && e.target.closest(".modal")) {
        return;
      }
      const selectedPane =
        getSelectedPaneRoot() || (paneIndex === 0 ? root : null);
      if (selectedPane !== root) {
        return;
      }
      const { activeElement } = document;
      if (
        activeElement instanceof HTMLElement &&
        root.contains(activeElement)
      ) {
        return;
      }
      const activeRow = getActiveRow(root);
      if (!activeRow) {
        return;
      }
      e.preventDefault();
      setKeyboardNavActive(true);
      focusRow(activeRow);
    };
    window.addEventListener("keydown", onGlobalKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onGlobalKeyDown, true);
    };
  }, [paneIndex, showShortcuts]);

  const onPaneMouseEnter = (): void => {
    if (!wrapperRef.current) {
      return;
    }
    setSelectedPane(wrapperRef.current);
    setKeyboardNavActive(false);
    setActivePaneIndex(paneIndex);
  };

  const onPaneMouseMove = (): void => {
    setKeyboardNavActive(false);
  };

  const onPaneFocusCapture = (): void => {
    if (!wrapperRef.current) {
      return;
    }
    setSelectedPane(wrapperRef.current);
    setActivePaneIndex(paneIndex);
  };

  const onKeyDownCapture = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const root = wrapperRef.current;
    if (!root) {
      return;
    }

    const now = Date.now();
    const lastSequenceKey = root.dataset.keyboardSequenceKey as
      | "g"
      | "d"
      | "f"
      | undefined;
    const lastSequenceTs = Number(root.dataset.keyboardSequenceTs || "0");
    const setLastSequence = (key: "g" | "d" | "f" | null, ts: number): void => {
      if (!key) {
        root.removeAttribute("data-keyboard-sequence-key");
        root.removeAttribute("data-keyboard-sequence-ts");
        return;
      }
      root.setAttribute("data-keyboard-sequence-key", key);
      root.setAttribute("data-keyboard-sequence-ts", String(ts));
    };
    const editable = isEditableElement(e.target);
    const focusedRow = getRowFromElement(document.activeElement);

    if (editable) {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const isMiniEditor =
        target?.classList.contains("mini-editor") ||
        target?.closest(".mini-editor") !== null;
      if (
        isMiniEditor &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        (e.key === "ArrowDown" || e.key === "ArrowUp")
      ) {
        const currentRow = getRowFromElement(e.target);
        if (!currentRow) {
          return;
        }
        e.preventDefault();
        setKeyboardNavActive(true);
        focusAdjacentRowEditor(
          root,
          currentRow,
          e.key === "ArrowDown" ? 1 : -1
        );
      }
      return;
    }

    if (showShortcuts && e.key === "Escape") {
      e.preventDefault();
      setShowShortcuts(false);
      return;
    }

    if (
      e.key === "F1" ||
      ((e.metaKey || e.ctrlKey) && e.key === "/") ||
      e.key === "K"
    ) {
      e.preventDefault();
      setShowShortcuts(true);
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }

    const activeRow = getActiveRow(root);
    if (!activeRow) {
      return;
    }
    const activeIndex = Number(activeRow.getAttribute("data-row-index") || "0");

    if (e.key === "Escape") {
      e.preventDefault();
      setKeyboardNavActive(true);
      focusRow(activeRow);
      return;
    }

    if (e.key === "g") {
      if (lastSequenceKey === "g" && now - lastSequenceTs < 600) {
        e.preventDefault();
        focusRowAt(root, 0);
        setLastSequence(null, 0);
        return;
      }
      setLastSequence("g", now);
      return;
    }

    if (e.key === "d") {
      if (lastSequenceKey === "d" && now - lastSequenceTs < 600) {
        e.preventDefault();
        triggerRowRelevanceSymbol(activeRow, "x");
        setLastSequence(null, 0);
        return;
      }
      setLastSequence("d", now);
      return;
    }

    if (e.key === "f") {
      setLastSequence("f", now);
      return;
    }

    if (lastSequenceKey === "f" && now - lastSequenceTs < 800) {
      const key =
        FILTER_SYMBOL_TO_KEY[e.key as keyof typeof FILTER_SYMBOL_TO_KEY];
      if (key) {
        e.preventDefault();
        setKeyboardNavActive(true);
        togglePaneFilter(root, key);
        setLastSequence(null, 0);
        return;
      }
    }

    setLastSequence(null, 0);

    if (e.key === "G") {
      e.preventDefault();
      setKeyboardNavActive(true);
      const rows = getFocusableRows(root);
      focusRow(rows[rows.length - 1]);
      return;
    }

    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      setKeyboardNavActive(true);
      if (!focusedRow) {
        focusRow(activeRow);
        return;
      }
      focusRowAt(root, activeIndex + 1);
      return;
    }

    if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      setKeyboardNavActive(true);
      if (!focusedRow) {
        focusRow(activeRow);
        return;
      }
      focusRowAt(root, activeIndex - 1);
      return;
    }

    if (e.key === "h" || e.key === "ArrowLeft") {
      e.preventDefault();
      setKeyboardNavActive(true);
      const collapseButton = activeRow.querySelector(
        "button[aria-label^='collapse ']"
      );
      if (collapseButton instanceof HTMLElement) {
        collapseButton.click();
      } else {
        focusParentRow(root, activeRow);
      }
      return;
    }

    if (e.key === "l" || e.key === "ArrowRight") {
      e.preventDefault();
      setKeyboardNavActive(true);
      const expandButton = activeRow.querySelector(
        "button[aria-label^='expand ']"
      );
      if (expandButton instanceof HTMLElement) {
        expandButton.click();
        window.setTimeout(() => focusFirstChildRow(root, activeRow), 0);
      } else {
        focusFirstChildRow(root, activeRow);
      }
      return;
    }

    if (e.key === "Enter" || e.key === "i") {
      e.preventDefault();
      setKeyboardNavActive(true);
      focusRowEditor(activeRow);
      return;
    }

    if (e.key === "/") {
      e.preventDefault();
      setKeyboardNavActive(true);
      const searchButton = root.querySelector('[data-pane-action="search"]');
      if (searchButton instanceof HTMLElement) {
        searchButton.click();
      }
      return;
    }

    if (e.key === "N") {
      e.preventDefault();
      setKeyboardNavActive(true);
      const newNoteButton = root.querySelector('[data-pane-action="new-note"]');
      if (newNoteButton instanceof HTMLElement) {
        window.setTimeout(() => newNoteButton.click(), 0);
      }
      return;
    }

    if (e.key === "P") {
      e.preventDefault();
      setKeyboardNavActive(true);
      const newPaneButton = root.querySelector('[data-pane-action="new-pane"]');
      if (newPaneButton instanceof HTMLElement) {
        window.setTimeout(() => newPaneButton.click(), 0);
      }
      return;
    }

    if (e.key === "q") {
      e.preventDefault();
      setKeyboardNavActive(true);
      const closePaneButton = root.querySelector(
        '[data-pane-action="close-pane"]'
      );
      if (closePaneButton instanceof HTMLElement) {
        closePaneButton.click();
      }
      return;
    }

    if (e.key === "]") {
      e.preventDefault();
      switchPane(1);
      return;
    }

    if (e.key === "[") {
      e.preventDefault();
      switchPane(-1);
      return;
    }

    if (e.key === "H") {
      e.preventDefault();
      setKeyboardNavActive(true);
      triggerPaneHome(root);
      return;
    }

    if (e.key === "Backspace") {
      e.preventDefault();
      setKeyboardNavActive(true);
      const backButton = root.querySelector('[data-pane-action="back"]');
      if (backButton instanceof HTMLElement) {
        backButton.click();
      }
      return;
    }

    if (e.key === "s") {
      e.preventDefault();
      setKeyboardNavActive(true);
      toggleRowOpenInSplitPane(activeRow);
      return;
    }

    if (e.key === "z") {
      e.preventDefault();
      setKeyboardNavActive(true);
      toggleRowOpenFullscreen(activeRow);
      return;
    }

    if (e.key === "x" || e.key === "~" || e.key === "!" || e.key === "?") {
      e.preventDefault();
      setKeyboardNavActive(true);
      triggerRowRelevanceSymbol(activeRow, e.key as "x" | "~" | "!" | "?");
      refocusPaneAfterRowMutation(root);
      return;
    }

    if (e.key === "+") {
      e.preventDefault();
      setKeyboardNavActive(true);
      setEvidenceSymbol(activeRow, "confirms");
      refocusPaneAfterRowMutation(root);
      return;
    }

    if (e.key === "-") {
      e.preventDefault();
      setKeyboardNavActive(true);
      setEvidenceSymbol(activeRow, "contra");
      refocusPaneAfterRowMutation(root);
      return;
    }

    if (e.key === "o") {
      e.preventDefault();
      setKeyboardNavActive(true);
      setEvidenceSymbol(activeRow, "none");
      refocusPaneAfterRowMutation(root);
      return;
    }

    if (/^[1-8]$/.test(e.key)) {
      e.preventDefault();
      setKeyboardNavActive(true);
      togglePaneFilter(root, e.key);
    }
  };

  return {
    wrapperRef,
    onKeyDownCapture,
    onPaneMouseEnter,
    onPaneMouseMove,
    onPaneFocusCapture,
    showShortcuts,
    setShowShortcuts,
  };
}

export function PaneView(): JSX.Element | null {
  const pane = useCurrentPane();
  const paneIndex = usePaneIndex();
  const { user } = useData();
  const isOtherUser = pane.author !== user.publicKey;
  const {
    wrapperRef,
    onKeyDownCapture,
    onPaneMouseEnter,
    onPaneMouseMove,
    onPaneFocusCapture,
    showShortcuts,
    setShowShortcuts,
  } = usePaneKeyboardNavigation(paneIndex);

  return (
    <TemporaryViewProvider>
      <div
        ref={wrapperRef}
        className={`pane-wrapper ${
          isOtherUser ? "pane-other-user pane-readonly-mode" : ""
        }`}
        tabIndex={-1}
        onMouseEnter={onPaneMouseEnter}
        onMouseMove={onPaneMouseMove}
        onFocusCapture={onPaneFocusCapture}
        onKeyDownCapture={onKeyDownCapture}
      >
        <KeyboardShortcutsModal
          show={showShortcuts}
          onHide={() => setShowShortcuts(false)}
        />
        <PaneHeader />
        <div className="pane-content">
          <TreeView />
        </div>
        <PaneStatusLine />
      </div>
    </TemporaryViewProvider>
  );
}
