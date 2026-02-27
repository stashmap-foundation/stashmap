import React, { useEffect, useMemo, useRef, useState } from "react";
import { List, Map, OrderedSet } from "immutable";
import {
  TemporaryViewProvider,
  useTemporaryView,
} from "./TemporaryViewContext";

import {
  getEffectiveAuthor,
  getNodeFromView,
  getNodeFromID,
  getNodeIDFromView,
  getVersionedDisplayText,
  getContext,
  isExpanded,
  parseViewPath,
  ViewPath,
  VirtualItemsMap,
  viewPathToString,
  useViewPath,
  useIsViewingOtherUserContent,
} from "../ViewContext";
import { useData } from "../DataContext";
import {
  useCurrentPane,
  usePaneStack,
  usePaneIndex,
  useNavigatePane,
  useSplitPanes,
} from "../SplitPanesContext";
import { useNavigationState } from "../NavigationStateContext";
import { usePaneHistory } from "../PaneHistoryContext";
import { TreeView } from "./TreeView";
import { DroppableContainer } from "./DroppableContainer";
import {
  PaneSearchButton,
  PaneSettingsMenu,
  ClosePaneButton,
} from "./SplitPaneLayout";
import {
  InlineFilterDots,
  FilterId,
  useToggleFilter,
} from "./TypeFilterButton";
import { NewPaneButton } from "./OpenInSplitPaneButton";
import { PublishingStatusWrapper } from "./PublishingStatusWrapper";
import { SignInMenuBtn } from "../SignIn";
import {
  usePlanner,
  planForkPane,
  planClearTemporarySelection,
  planSelectAllTemporaryRows,
  planShiftTemporarySelection,
  planToggleTemporarySelection,
} from "../planner";
import { parseTextToTrees, planPasteMarkdownTrees } from "./FileDropZone";
import {
  LOG_NODE_ID,
  VERSIONS_NODE_ID,
  isSearchId,
  shortID,
} from "../connections";
import { buildNodeUrl } from "../navigationUrl";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import {
  focusRow,
  getFocusableRows,
  getRowDepth,
  getRowFromElement,
  getRowKey,
  getScrollToRow,
  isEditableElement,
} from "./keyboardNavigation";
import {
  planBatchRelevance,
  planBatchArgument,
  planBatchIndent,
  planBatchOutdent,
  getCurrentItem,
} from "./batchOperations";
import { getNodesInTree } from "./Node";
import { planDeleteNodeFromView } from "../dnd";

function BreadcrumbItem({
  nodeID,
  href,
  onClick,
  isLast,
}: {
  nodeID: LongID | ID;
  href: string;
  onClick: (e: React.MouseEvent) => void;
  isLast: boolean;
}): JSX.Element {
  const { knowledgeDBs, user } = useData();
  const node = getNodeFromID(knowledgeDBs, nodeID as string, user.publicKey);
  const label =
    node?.text ||
    (shortID(nodeID) === VERSIONS_NODE_ID ? "~versions" : "Loading...");

  if (isLast) {
    return <span className="breadcrumb-current">{label}</span>;
  }

  return (
    <>
      <a
        href={href}
        className="breadcrumb-link"
        onClick={onClick}
        aria-label={`Navigate to ${label}`}
      >
        {label}
      </a>
      <span className="breadcrumb-separator">/</span>
    </>
  );
}

function Breadcrumbs(): JSX.Element {
  const { knowledgeDBs, user } = useData();
  const stack = usePaneStack();
  const pane = useCurrentPane();
  const navigatePane = useNavigatePane();

  return (
    <nav className="breadcrumbs" aria-label="Navigation breadcrumbs">
      {stack
        .filter((id) => !isSearchId(id as ID))
        .map((nodeID, index) => {
          const targetUrl =
            buildNodeUrl(
              stack.slice(0, index + 1),
              knowledgeDBs,
              user.publicKey,
              pane.author
            ) || "#";
          return (
            <BreadcrumbItem
              key={nodeID as string}
              nodeID={nodeID}
              href={targetUrl}
              onClick={(e) => {
                e.preventDefault();
                navigatePane(targetUrl);
              }}
              isLast={index === stack.length - 1}
            />
          );
        })}
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
  const { knowledgeDBs, user } = useData();
  const navigatePane = useNavigatePane();

  const logNode = getNodeFromID(knowledgeDBs, LOG_NODE_ID, user.publicKey);
  if (!logNode) {
    return null;
  }

  const href = buildNodeUrl([LOG_NODE_ID], knowledgeDBs, user.publicKey) || "#";

  return (
    <a
      href={href}
      className="btn btn-icon"
      onClick={(e) => {
        e.preventDefault();
        navigatePane(href);
      }}
      data-pane-action="home"
      aria-label="Navigate to Log"
      title="Log"
    >
      <span aria-hidden="true">✽</span>
    </a>
  );
}

function NewNoteButton(): JSX.Element {
  const navigatePane = useNavigatePane();

  return (
    <a
      href="/"
      className="btn btn-sm"
      onClick={(e) => {
        e.preventDefault();
        navigatePane("/");
      }}
      data-pane-action="new-note"
      aria-label="Create new note"
    >
      New
    </a>
  );
}

function useHomeShortcut(): void {
  const { knowledgeDBs, user } = useData();
  const navigatePane = useNavigatePane();

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
          const href =
            buildNodeUrl([LOG_NODE_ID], knowledgeDBs, user.publicKey) || "/";
          navigatePane(href);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigatePane, knowledgeDBs, user.publicKey]);
}

function BackButton(): JSX.Element | null {
  const pane = useCurrentPane();
  const { setPane } = useSplitPanes();
  const paneHistory = usePaneHistory();
  const { replaceNextNavigation } = useNavigationState();

  if (!paneHistory?.canGoBack(pane.id)) {
    return null;
  }

  const handleBack = (): void => {
    const previous = paneHistory?.pop(pane.id);
    if (previous) {
      replaceNextNavigation();
      setPane(previous);
    }
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

function PaneStatusLine({
  onShowShortcuts,
}: {
  onShowShortcuts?: () => void;
}): JSX.Element {
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
          <PaneSettingsMenu onShowShortcuts={onShowShortcuts} />
        </div>
      )}
    </footer>
  );
}

const KEY_TO_FILTER: Record<string, FilterId> = {
  "1": "relevant",
  "!": "relevant",
  "2": "maybe_relevant",
  "?": "maybe_relevant",
  "3": "little_relevant",
  "~": "little_relevant",
  "4": "not_relevant",
  x: "not_relevant",
  "5": "contains",
  o: "contains",
  "6": "confirms",
  "+": "confirms",
  "7": "contra",
  "-": "contra",
  "8": "suggestions",
  "@": "suggestions",
  "9": "versions",
  "0": "incoming",
  "=": "occurrence",
};

function getActiveRow(root: HTMLElement): HTMLElement | undefined {
  const rows = getFocusableRows(root);
  return rows.find((row) => row.tabIndex === 0);
}

function scrollAndFocusRow(root: HTMLElement, index: number): void {
  const target = root.querySelector(
    `[data-row-focusable="true"][data-row-index="${index}"]`
  );
  if (target instanceof HTMLElement) {
    target.scrollIntoView({ block: "nearest" });
    focusRow(target);
    return;
  }
  const scrollToRow = getScrollToRow(root);
  if (scrollToRow) {
    scrollToRow(index, () => {
      const retryTarget = root.querySelector(
        `[data-row-focusable="true"][data-row-index="${index}"]`
      );
      if (retryTarget instanceof HTMLElement) {
        focusRow(retryTarget);
      }
    });
  }
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
  const target = root.querySelector(
    `[data-row-focusable="true"][data-row-index="${targetIndex}"]`
  );
  if (!(target instanceof HTMLElement)) {
    return;
  }
  target.scrollIntoView({ block: "nearest" });
  focusRow(target);
  focusRowEditor(target);
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

const SYMBOL_TO_RELEVANCE: Record<string, Relevance> = {
  x: "not_relevant",
  "~": "little_relevant",
  "?": "maybe_relevant",
  "!": "relevant",
};

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

function getRowDepthFromViewKey(viewKey: string): number {
  return parseViewPath(viewKey).length - 1;
}

function getSubtreeKeysFromOrderedKeys(
  orderedKeys: string[],
  activeRowKey: string
): string[] {
  const activeIndex = orderedKeys.indexOf(activeRowKey);
  if (activeIndex === -1) {
    return [activeRowKey];
  }
  const activeDepth = getRowDepthFromViewKey(activeRowKey);
  const endIndex = orderedKeys
    .slice(activeIndex + 1)
    .findIndex((viewKey) => getRowDepthFromViewKey(viewKey) <= activeDepth);
  const finalIndex =
    endIndex === -1 ? orderedKeys.length : activeIndex + 1 + endIndex;
  return orderedKeys.slice(activeIndex, finalIndex);
}

function computeFocusIndexAfterDeletion(
  keys: string[],
  orderedViewKeys: string[]
): number | undefined {
  const removedSet = new Set(
    keys.flatMap((key) => getSubtreeKeysFromOrderedKeys(orderedViewKeys, key))
  );
  if (removedSet.size >= orderedViewKeys.length) {
    return undefined;
  }
  const survivors = orderedViewKeys.filter((key) => !removedSet.has(key));
  const maxRemovedIndex = orderedViewKeys.reduce(
    (max, key, i) => (removedSet.has(key) ? Math.max(max, i) : max),
    -1
  );
  const firstSurvivorAfter = orderedViewKeys.findIndex(
    (key, i) => i > maxRemovedIndex && !removedSet.has(key)
  );
  if (firstSurvivorAfter !== -1) {
    return survivors.indexOf(orderedViewKeys[firstSurvivorAfter]);
  }
  return survivors.length - 1;
}

function getDisplayTextForViewKey(
  data: Data,
  stack: ID[],
  viewKey: string
): string {
  const viewPath = parseViewPath(viewKey);
  const [node] = getNodeFromView(data, viewPath);
  const [nodeID] = getNodeIDFromView(data, viewPath);
  const context = getContext(data, viewPath, stack);
  const effectiveAuthor = getEffectiveAuthor(data, viewPath);
  const versionedText = getVersionedDisplayText(
    data.knowledgeDBs,
    effectiveAuthor,
    nodeID as ID,
    context
  );
  return versionedText ?? node?.text ?? "";
}

function getActionTargetKeys(
  selection: OrderedSet<string>,
  activeRow: HTMLElement,
  orderedViewKeys: string[]
): string[] {
  if (selection.size === 0) {
    return [getRowKey(activeRow)];
  }
  return orderedViewKeys.filter((viewKey) => selection.contains(viewKey));
}

function usePaneKeyboardNavigation(paneIndex: number): {
  wrapperRef: React.RefObject<HTMLDivElement>;
  onKeyDownCapture: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaneMouseEnter: () => void;
  onPaneFocusCapture: () => void;
  showShortcuts: boolean;
  setShowShortcuts: React.Dispatch<React.SetStateAction<boolean>>;
} {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const { setActivePaneIndex } = useNavigationState();
  const { selection, anchor } = useTemporaryView();
  const data = useData();
  const stack = usePaneStack();
  const pane = useCurrentPane();
  const toggleFilter = useToggleFilter();
  const viewPath = useViewPath();
  const { createPlan, executePlan } = usePlanner();
  const treeResult = useMemo(() => {
    const rootKey = viewPathToString(viewPath);
    return isExpanded(data, rootKey)
      ? getNodesInTree(
          data,
          viewPath,
          stack,
          List<ViewPath>(),
          pane.rootRelation,
          pane.author,
          pane.typeFilters
        )
      : undefined;
  }, [data, viewPath, stack, pane.rootRelation]);
  const orderedViewKeys = useMemo(
    () =>
      List<ViewPath>([viewPath])
        .concat(treeResult?.paths || List<ViewPath>())
        .map((path) => viewPathToString(path))
        .toArray(),
    [viewPath, treeResult]
  );
  const virtualItemsMap: VirtualItemsMap =
    treeResult?.virtualItems || Map<string, RelationItem>();

  const switchPane = (direction: -1 | 1): void => {
    const root = wrapperRef.current;
    if (!root) {
      return;
    }
    const allPanes = getPaneWrappers();
    const currentIndex = allPanes.findIndex((paneEl) => paneEl === root);
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
    setSelectedPane(targetPane);
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
    if (paneIndex !== 0) {
      return () => {};
    }

    const selectedPane = getSelectedPaneRoot();
    if (!selectedPane) {
      setSelectedPane(root);
    }

    const { activeElement } = document;
    if (
      !activeElement ||
      activeElement === document.body ||
      activeElement === document.documentElement
    ) {
      root.focus();
    }
    return () => {};
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
        if (e.key === "ArrowDown" || e.key === "j") {
          const [firstRow] = getFocusableRows(root);
          if (firstRow) {
            e.preventDefault();
            focusRow(firstRow);
          }
        }
        return;
      }
      e.preventDefault();
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
    setActivePaneIndex(paneIndex);
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

    if (e.key === "F1" || ((e.metaKey || e.ctrlKey) && e.key === "/")) {
      e.preventDefault();
      setShowShortcuts(true);
      return;
    }

    if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const activeRow = getActiveRow(root);
      if (!activeRow) {
        root.focus();
        return;
      }
      const keys = getActionTargetKeys(selection, activeRow, orderedViewKeys);
      const plan = createPlan();
      const result = e.shiftKey
        ? planBatchOutdent(plan, keys, stack)
        : planBatchIndent(plan, keys, stack);
      if (result) {
        executePlan(result);
        refocusPaneAfterRowMutation(root);
      }
      return;
    }

    const isShiftOnly = e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (
      isShiftOnly &&
      e.key !== "!" &&
      e.key !== "?" &&
      e.key !== "~" &&
      e.key !== "+" &&
      e.key !== "-"
    ) {
      const activeRow = getActiveRow(root);
      if (!activeRow) {
        return;
      }
      const activeRowKey = getRowKey(activeRow);
      const activeIndex = orderedViewKeys.indexOf(activeRowKey);
      if (activeIndex < 0) {
        return;
      }

      if (
        e.key === "J" ||
        e.key === "j" ||
        e.key === "ArrowDown" ||
        e.key === "K" ||
        e.key === "k" ||
        e.key === "ArrowUp"
      ) {
        e.preventDefault();
        const isDown = e.key === "J" || e.key === "j" || e.key === "ArrowDown";
        const targetIndex = isDown ? activeIndex + 1 : activeIndex - 1;
        const boundedTarget = Math.max(
          0,
          Math.min(orderedViewKeys.length - 1, targetIndex)
        );
        const targetKey = orderedViewKeys[boundedTarget];
        if (!targetKey) {
          return;
        }
        executePlan(
          planShiftTemporarySelection(
            createPlan(),
            orderedViewKeys,
            targetKey,
            activeRowKey
          )
        );
        if (boundedTarget !== activeIndex) {
          scrollAndFocusRow(root, boundedTarget);
        }
        return;
      }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "a") {
      e.preventDefault();
      executePlan(
        planSelectAllTemporaryRows(createPlan(), orderedViewKeys, anchor)
      );
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "c") {
      const activeRow = getActiveRow(root);
      if (!activeRow) {
        return;
      }
      e.preventDefault();
      const activeRowKey = getRowKey(activeRow);
      const selectedKeys =
        selection.size > 0
          ? orderedViewKeys.filter((viewKey) => selection.contains(viewKey))
          : getSubtreeKeysFromOrderedKeys(orderedViewKeys, activeRowKey);
      if (selectedKeys.length === 0) {
        return;
      }
      const depths = selectedKeys.map((viewKey) =>
        getRowDepthFromViewKey(viewKey)
      );
      const minDepth = Math.min(...depths);
      const lines = selectedKeys.map((viewKey) => {
        const depth = getRowDepthFromViewKey(viewKey) - minDepth;
        const text = getDisplayTextForViewKey(data, stack, viewKey);
        return "\t".repeat(depth) + text;
      });
      navigator.clipboard.writeText(lines.join("\n"));
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "v") {
      const activeRow = getActiveRow(root);
      if (!activeRow) {
        return;
      }
      e.preventDefault();
      const activeRowKey = getRowKey(activeRow);
      const parentPath = parseViewPath(activeRowKey);
      navigator.clipboard.readText().then((text) => {
        const trees = parseTextToTrees(text);
        if (trees.length === 0) {
          return;
        }
        executePlan(
          planPasteMarkdownTrees(createPlan(), trees, parentPath, stack, 0)
        );
      });
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
      if (selection.size > 0) {
        executePlan(planClearTemporarySelection(createPlan(), ""));
        return;
      }
      (document.activeElement as HTMLElement)?.blur();
      return;
    }

    if (e.key === "g") {
      if (lastSequenceKey === "g" && now - lastSequenceTs < 600) {
        e.preventDefault();
        scrollAndFocusRow(root, 0);
        setLastSequence(null, 0);
        return;
      }
      setLastSequence("g", now);
      return;
    }

    if (e.key === "f") {
      setLastSequence("f", now);
      return;
    }

    if (lastSequenceKey === "f" && now - lastSequenceTs < 800) {
      const filterId = KEY_TO_FILTER[e.key];
      if (filterId) {
        e.preventDefault();
        toggleFilter(filterId);
        setLastSequence(null, 0);
        return;
      }
    }

    setLastSequence(null, 0);

    if (e.key === "G") {
      e.preventDefault();
      const treeRoot = root.querySelector("[data-total-rows]");
      const totalRows = Number(
        treeRoot?.getAttribute("data-total-rows") || "0"
      );
      if (totalRows > 0) {
        scrollAndFocusRow(root, totalRows - 1);
      }
      return;
    }

    if (e.key === " ") {
      e.preventDefault();
      const activeRowKey = getRowKey(activeRow);
      executePlan(planToggleTemporarySelection(createPlan(), activeRowKey));
      return;
    }

    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      if (!focusedRow) {
        focusRow(activeRow);
        return;
      }
      scrollAndFocusRow(root, activeIndex + 1);
      return;
    }

    if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!focusedRow) {
        focusRow(activeRow);
        return;
      }
      scrollAndFocusRow(root, activeIndex - 1);
      return;
    }

    if (e.key === "h" || e.key === "ArrowLeft") {
      e.preventDefault();
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
      focusRowEditor(activeRow);
      return;
    }

    if (e.key === "/") {
      e.preventDefault();
      const searchButton = root.querySelector('[data-pane-action="search"]');
      if (searchButton instanceof HTMLElement) {
        searchButton.click();
      }
      return;
    }

    if (e.key === "N") {
      e.preventDefault();
      const newNoteButton = root.querySelector('[data-pane-action="new-note"]');
      if (newNoteButton instanceof HTMLElement) {
        window.setTimeout(() => newNoteButton.click(), 0);
      }
      return;
    }

    if (e.key === "P") {
      e.preventDefault();
      const newPaneButton = root.querySelector('[data-pane-action="new-pane"]');
      if (newPaneButton instanceof HTMLElement) {
        window.setTimeout(() => newPaneButton.click(), 0);
      }
      return;
    }

    if (e.key === "q") {
      e.preventDefault();
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
      triggerPaneHome(root);
      return;
    }

    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      const keys = getActionTargetKeys(selection, activeRow, orderedViewKeys);
      const focusIndex = computeFocusIndexAfterDeletion(keys, orderedViewKeys);
      const paths = keys.map(parseViewPath);
      const result = planClearTemporarySelection(
        paths.reduce(
          (acc, path) => planDeleteNodeFromView(acc, path, stack),
          createPlan()
        )
      );
      executePlan(result);
      window.setTimeout(() => {
        if (focusIndex !== undefined) {
          scrollAndFocusRow(root, focusIndex);
        }
      }, 0);
      return;
    }

    if (e.key === "s") {
      e.preventDefault();
      toggleRowOpenInSplitPane(activeRow);
      return;
    }

    if (e.key === "z") {
      e.preventDefault();
      toggleRowOpenFullscreen(activeRow);
      return;
    }

    if (e.key === "x" || e.key === "~" || e.key === "!" || e.key === "?") {
      e.preventDefault();
      const plan = createPlan();
      const keys = getActionTargetKeys(selection, activeRow, orderedViewKeys);
      const paths = keys.map(parseViewPath);
      const activeViewPath = parseViewPath(getRowKey(activeRow));
      const targetRelevance = SYMBOL_TO_RELEVANCE[e.key];
      const currentItem = getCurrentItem(plan, activeViewPath, virtualItemsMap);
      const relevance =
        currentItem?.relevance === targetRelevance
          ? undefined
          : targetRelevance;
      executePlan(
        planBatchRelevance(plan, paths, stack, relevance, virtualItemsMap)
      );
      refocusPaneAfterRowMutation(root);
      return;
    }

    if (e.key === "+" || e.key === "-" || e.key === "o") {
      e.preventDefault();
      const plan = createPlan();
      const keys = getActionTargetKeys(selection, activeRow, orderedViewKeys);
      const paths = keys.map(parseViewPath);
      const activeViewPath = parseViewPath(getRowKey(activeRow));
      const targetArgument: Argument = (() => {
        if (e.key === "+") return "confirms" as const;
        if (e.key === "-") return "contra" as const;
        return undefined;
      })();
      const currentItem = getCurrentItem(plan, activeViewPath, virtualItemsMap);
      const argument: Argument =
        currentItem?.argument === targetArgument ? undefined : targetArgument;
      executePlan(
        planBatchArgument(plan, paths, stack, argument, virtualItemsMap)
      );
      refocusPaneAfterRowMutation(root);
      return;
    }

    const filterId = KEY_TO_FILTER[e.key];
    if (filterId) {
      e.preventDefault();
      toggleFilter(filterId);
      // If the focused row was removed by the filter change, focus falls to
      // <body> and subsequent keypresses won't reach this handler. Recapture
      // focus on the pane wrapper so keyboard shortcuts keep working.
      window.setTimeout(() => {
        if (document.activeElement === document.body) {
          root.focus();
        }
      }, 0);
    }
  };

  return {
    wrapperRef,
    onKeyDownCapture,
    onPaneMouseEnter,
    onPaneFocusCapture,
    showShortcuts,
    setShowShortcuts,
  };
}

function PaneViewInner(): JSX.Element {
  const pane = useCurrentPane();
  const paneIndex = usePaneIndex();
  const { user } = useData();
  const isOtherUser = pane.author !== user.publicKey;
  const {
    wrapperRef,
    onKeyDownCapture,
    onPaneMouseEnter,
    onPaneFocusCapture,
    showShortcuts,
    setShowShortcuts,
  } = usePaneKeyboardNavigation(paneIndex);

  return (
    <div
      ref={wrapperRef}
      className={`pane-wrapper ${isOtherUser ? "pane-other-user" : ""}`}
      tabIndex={-1}
      onMouseEnter={onPaneMouseEnter}
      onFocusCapture={onPaneFocusCapture}
      onKeyDownCapture={onKeyDownCapture}
    >
      <KeyboardShortcutsModal
        show={showShortcuts}
        onHide={() => setShowShortcuts(false)}
      />
      <PaneHeader />
      <DroppableContainer
        className={`pane-content${
          !pane.stack.length ? " empty-pane-drop-zone" : ""
        }`}
        disabled={!!pane.stack.length}
      >
        <TreeView />
      </DroppableContainer>
      <PaneStatusLine onShowShortcuts={() => setShowShortcuts(true)} />
    </div>
  );
}

export function PaneView(): JSX.Element | null {
  return (
    <TemporaryViewProvider>
      <PaneViewInner />
    </TemporaryViewProvider>
  );
}
