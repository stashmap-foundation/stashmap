import React, { useEffect, useMemo, useRef, useState } from "react";
import { List } from "immutable";
import { useLocation } from "react-router-dom";
import { LOCAL } from "../core/nodeRef";
import { useDragAutoScroll } from "../useDragAutoScroll";
import { ListItem } from "./Draggable";
import {
  RowContext,
  ViewPath,
  getDisplayTextForRow,
  getPaneRootItemID,
  viewPathToString,
} from "../rowModel";
import { EMPTY_NODE_ID } from "../core/connections";
import { useData } from "../DataContext";
import { useCalendarFeeds } from "../CalendarFeedContext";
import { calendarFeedUrl } from "../core/ical";
import {
  useCurrentPane,
  usePaneIndex,
  useSplitPanes,
} from "../SplitPanesContext";
import { useApis } from "../Apis";
import {
  ActiveRowState,
  KeyboardMode,
  getRowIndex,
  getRowKey,
  isEditableElement,
  registerScrollToRow,
  unregisterScrollToRow,
} from "./keyboardNavigation";
import { useTemporaryView } from "./temporaryViewState";
import {
  planClearTemporarySelection,
  planShiftTemporarySelection,
  planToggleTemporarySelection,
  usePlanner,
} from "../planner";
import {
  getNodesInDocument,
  getNodesInTree,
  type TreeResult,
} from "../treeTraversal";
import { isCanonicalId } from "../core/entityRecognition";
import { getNodeInSource, graphLookupFromData } from "../core/graphLookup";
import { newGraphNode } from "../core/nodeFactory";
import { nodeText, plainSpans } from "../core/nodeSpans";
import { getDocumentByIdOrFilePath } from "../core/Document";
import { useEntityLabels } from "../EntityLabelContext";
import { defaultEntitySurfaceTitle } from "../entityLabels";
import { useNavigationState } from "../NavigationStateContext";

const PaneTreeResultContext = React.createContext<TreeResult | undefined>(
  undefined
);

function getPaneTraversalRootPath(pane: Pane, paneIndex: number): ViewPath {
  return [paneIndex, getPaneRootItemID(pane)];
}

function activeNodeId(): string | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) {
    return undefined;
  }
  return (
    active.closest("[data-node-id]")?.getAttribute("data-node-id") ?? undefined
  );
}

export function usePaneTreeResult(): TreeResult | undefined {
  return React.useContext(PaneTreeResultContext);
}

export function PaneTreeResultProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const baseData = useData();
  const { feeds: calendarFeeds, requestFeed } = useCalendarFeeds();
  const data = useMemo(
    () => ({ ...baseData, calendarFeeds }),
    [baseData, calendarFeeds]
  );
  const pane = useCurrentPane();
  const { setPane } = useSplitPanes();
  const { replaceNextNavigation } = useNavigationState();
  const { labelFor, requestLabel } = useEntityLabels();
  const paneIndex = usePaneIndex();
  const viewPath = useMemo(
    () => getPaneTraversalRootPath(pane, paneIndex),
    [pane.rootNodeId, pane.searchQuery, paneIndex]
  );
  const paneDocument = pane.documentId
    ? getDocumentByIdOrFilePath(
        data.documents,
        data.documentByFilePath,
        pane.sourceId,
        pane.documentId
      )
    : undefined;
  const canonicalRootId =
    pane.sourceId === LOCAL && pane.rootNodeId && isCanonicalId(pane.rootNodeId)
      ? pane.rootNodeId
      : undefined;
  const localCanonicalRoot = useMemo(() => {
    if (!canonicalRootId) {
      return undefined;
    }
    return getNodeInSource(graphLookupFromData(data), {
      sourceId: LOCAL,
      id: canonicalRootId,
    })?.node;
  }, [canonicalRootId, data]);
  const resolvedLabel = canonicalRootId ? labelFor(canonicalRootId) : undefined;
  const focusedCanonicalRoot =
    canonicalRootId !== undefined && activeNodeId() === canonicalRootId;
  const displayedResolvedLabel = focusedCanonicalRoot
    ? undefined
    : resolvedLabel;
  const projectedRoot = useMemo(() => {
    if (!canonicalRootId || localCanonicalRoot) {
      return undefined;
    }
    const displayTitle =
      displayedResolvedLabel ??
      pane.fallbackLabel ??
      defaultEntitySurfaceTitle(canonicalRootId);
    return newGraphNode(plainSpans(displayTitle), { uuid: canonicalRootId });
  }, [
    canonicalRootId,
    displayedResolvedLabel,
    localCanonicalRoot,
    pane.fallbackLabel,
  ]);
  const treeResult = useMemo(() => {
    if (paneDocument) {
      return getNodesInDocument(data, viewPath, paneDocument, pane.typeFilters);
    }
    return getNodesInTree(
      data,
      List<ViewPath>([viewPath]),
      List<ViewPath>(),
      pane.rootNodeId,
      pane.sourceId,
      pane.typeFilters,
      { projectedRoot }
    );
  }, [
    data,
    paneDocument,
    pane.sourceId,
    pane.rootNodeId,
    pane.typeFilters,
    projectedRoot,
    viewPath,
  ]);

  useEffect(() => {
    if (projectedRoot) {
      requestLabel(projectedRoot.id);
    }
  }, [projectedRoot, requestLabel]);

  useEffect(() => {
    if (!canonicalRootId || !localCanonicalRoot) {
      return;
    }
    const localFallbackLabel = nodeText(localCanonicalRoot) || undefined;
    if (pane.fallbackLabel === localFallbackLabel) {
      return;
    }
    replaceNextNavigation();
    setPane({ ...pane, fallbackLabel: localFallbackLabel });
  }, [
    canonicalRootId,
    localCanonicalRoot,
    pane,
    replaceNextNavigation,
    setPane,
  ]);

  useEffect(() => {
    if (
      !projectedRoot ||
      focusedCanonicalRoot ||
      resolvedLabel === undefined ||
      pane.fallbackLabel === resolvedLabel
    ) {
      return;
    }
    replaceNextNavigation();
    setPane({ ...pane, fallbackLabel: resolvedLabel });
  }, [
    focusedCanonicalRoot,
    pane,
    projectedRoot,
    replaceNextNavigation,
    resolvedLabel,
    setPane,
  ]);

  // Fetch-on-render: any visible calendar-feed node requests its feed;
  // the projection rows appear when the fetch resolves.
  useEffect(() => {
    treeResult.rows.forEach((row) => {
      const feedUrl = calendarFeedUrl(row.node);
      if (feedUrl) {
        requestFeed(feedUrl);
      }
    });
  }, [treeResult, requestFeed]);

  return (
    <PaneTreeResultContext.Provider value={treeResult}>
      {children}
    </PaneTreeResultContext.Provider>
  );
}

function PlainTreeRows({
  rows,
  startIndexFromStorage,
  ariaLabel,
  activeRowKey,
  onRowFocus,
  onRowClick,
  scrollToId,
}: {
  rows: List<Row>;
  startIndexFromStorage: number;
  ariaLabel: string | undefined;
  activeRowKey: string;
  onRowFocus: (key: string, index: number, mode: KeyboardMode) => void;
  onRowClick?: (e: React.MouseEvent, viewKey: string) => void;
  scrollToId?: string;
}): JSX.Element {
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollParent, setScrollParent] = useState<HTMLElement | undefined>(
    undefined
  );

  useEffect(() => {
    const el = containerRef.current?.closest(".pane-content");
    if (el instanceof HTMLElement) {
      setScrollParent(el);
    }
  }, []);

  useDragAutoScroll(scrollParent);

  useEffect(() => {
    const treeRoot = containerRef.current?.closest("[data-keyboard-mode]");
    if (treeRoot instanceof HTMLElement) {
      registerScrollToRow(treeRoot, (index, done) => {
        const row = containerRef.current?.querySelector(
          `[data-row-index="${index}"]`
        );
        if (row instanceof HTMLElement) {
          row.scrollIntoView({ block: "nearest" });
        }
        done?.();
      });
      return () => unregisterScrollToRow(treeRoot);
    }
    return undefined;
  }, [scrollParent]);

  useEffect(() => {
    const row = containerRef.current?.querySelector(
      `[data-row-index="${startIndexFromStorage}"]`
    );
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ block: "start" });
    }
  }, [location, startIndexFromStorage]);

  const handledScrollToIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!scrollToId) {
      // eslint-disable-next-line functional/immutable-data
      handledScrollToIdRef.current = undefined;
      return;
    }
    if (handledScrollToIdRef.current === scrollToId) {
      return;
    }
    const index = rows.findIndex((row) => row.node.id === scrollToId);
    if (index >= 0) {
      const row = containerRef.current?.querySelector(
        `[data-row-index="${index}"]`
      );
      if (row instanceof HTMLElement) {
        row.scrollIntoView({ block: "center" });
      }
      // eslint-disable-next-line functional/immutable-data
      handledScrollToIdRef.current = scrollToId;
    }
  }, [rows, scrollToId]);

  const renderedRows = rows.map((row, index) => {
    const nextRow = index < rows.size - 1 ? rows.get(index + 1) : undefined;
    return (
      <RowContext.Provider value={row} key={row.viewKey}>
        <ListItem
          row={row}
          rows={rows}
          nextRow={nextRow}
          activeRowKey={activeRowKey}
          onRowFocus={onRowFocus}
          onRowClick={onRowClick}
        />
      </RowContext.Provider>
    );
  });
  return (
    <div ref={containerRef} aria-label={ariaLabel}>
      {renderedRows}
      <div style={{ height: "50vh" }} />
    </div>
  );
}

function useKeyboardMode(): [
  KeyboardMode,
  React.Dispatch<React.SetStateAction<KeyboardMode>>
] {
  return useState<KeyboardMode>("normal");
}

function Tree(): JSX.Element | null {
  const data = useData();
  const pane = useCurrentPane();
  const { fileStore } = useApis();
  const { getLocalStorage } = fileStore;
  const paneIndex = usePaneIndex();
  const viewPath = getPaneTraversalRootPath(pane, paneIndex);
  const scrollableId = viewPathToString(viewPath);
  const startIndexFromStorage = Number(getLocalStorage(scrollableId)) || 0;
  const [activeRow, setActiveRow] = useState<ActiveRowState>({
    activeRowKey: "",
    activeRowIndex: 0,
  });
  const [consumedRowFocusIntentId, setConsumedRowFocusIntentId] = useState<
    number | null
  >(null);
  const treeRootRef = useRef<HTMLDivElement>(null);
  const [keyboardMode, setKeyboardMode] = useKeyboardMode();
  const treeResult = usePaneTreeResult();
  const rows = treeResult?.rows || List<Row>();
  const nodeKeys = rows.map((row) => row.viewKey).toArray();
  const rootRow = rows.first();
  const displayText = rootRow ? getDisplayTextForRow(rootRow) : "";
  const ariaLabel = displayText ? `related to ${displayText}` : undefined;
  const rowFocusIntent =
    data.publishEventsStatus.temporaryView.rowFocusIntents.get(paneIndex);

  useEffect(() => {
    if (nodeKeys.length === 0) {
      return;
    }
    const existingIndex = nodeKeys.indexOf(activeRow.activeRowKey);
    if (existingIndex >= 0) {
      if (existingIndex !== activeRow.activeRowIndex) {
        setActiveRow((current) => ({
          activeRowKey: current.activeRowKey,
          activeRowIndex: existingIndex,
        }));
      }
      return;
    }
    const fallbackIndex = Math.min(
      Math.max(activeRow.activeRowIndex, 0),
      nodeKeys.length - 1
    );
    setActiveRow({
      activeRowKey: nodeKeys[fallbackIndex],
      activeRowIndex: fallbackIndex,
    });
  }, [nodeKeys, activeRow.activeRowKey, activeRow.activeRowIndex]);

  const { anchor } = useTemporaryView();
  const { createPlan, executePlan } = usePlanner();

  const onRowFocus = (key: string, index: number, mode: KeyboardMode): void => {
    setActiveRow({
      activeRowKey: key,
      activeRowIndex: index,
    });
    setKeyboardMode(mode);
  };

  const onRowClick = (e: React.MouseEvent, clickedViewKey: string): void => {
    const isMeta = e.metaKey || e.ctrlKey;
    const isShift = e.shiftKey;

    if (isMeta) {
      executePlan(planToggleTemporarySelection(createPlan(), clickedViewKey));
      return;
    }

    if (isShift && anchor) {
      executePlan(
        planShiftTemporarySelection(createPlan(), nodeKeys, clickedViewKey)
      );
      return;
    }

    executePlan(planClearTemporarySelection(createPlan(), clickedViewKey));
  };

  useEffect(() => {
    const { activeElement } = document;
    setKeyboardMode(isEditableElement(activeElement) ? "insert" : "normal");
  }, [activeRow.activeRowKey]);

  useEffect(() => {
    const treeRoot = treeRootRef.current;
    if (!treeRoot) {
      return;
    }
    if (!rowFocusIntent) {
      return;
    }
    if (consumedRowFocusIntentId === rowFocusIntent.requestId) {
      return;
    }
    const byViewKey = rowFocusIntent.viewKey
      ? treeRoot.querySelector(
          `[data-row-focusable="true"][data-view-key="${rowFocusIntent.viewKey}"]`
        )
      : null;
    const byNodeId = rowFocusIntent.nodeId
      ? treeRoot.querySelector(
          `[data-row-focusable="true"][data-node-id="${rowFocusIntent.nodeId}"]`
        )
      : null;
    const byRowIndex =
      rowFocusIntent.rowIndex !== undefined
        ? treeRoot.querySelector(
            `[data-row-focusable="true"][data-row-index="${rowFocusIntent.rowIndex}"]`
          )
        : null;
    const target =
      (byViewKey instanceof HTMLElement && byViewKey) ||
      (byNodeId instanceof HTMLElement && byNodeId) ||
      (byRowIndex instanceof HTMLElement && byRowIndex);
    if (!target) {
      return;
    }
    target.focus();
    setActiveRow({
      activeRowKey: getRowKey(target),
      activeRowIndex: getRowIndex(target),
    });
    setConsumedRowFocusIntentId(rowFocusIntent.requestId);
  }, [
    paneIndex,
    consumedRowFocusIntentId,
    rowFocusIntent?.requestId,
    rowFocusIntent?.viewKey,
    rowFocusIntent?.nodeId,
    rowFocusIntent?.rowIndex,
    nodeKeys,
  ]);

  if (
    (rows.size === 0 || rootRow?.node.id === EMPTY_NODE_ID) &&
    pane.sourceId !== LOCAL &&
    (pane.documentId !== undefined || pane.rootNodeId !== undefined)
  ) {
    return <div>Loading...</div>;
  }

  return (
    <div
      ref={treeRootRef}
      data-keyboard-mode={keyboardMode}
      data-total-rows={rows.size}
    >
      <PlainTreeRows
        rows={rows}
        startIndexFromStorage={startIndexFromStorage}
        ariaLabel={ariaLabel}
        activeRowKey={activeRow.activeRowKey}
        onRowFocus={onRowFocus}
        onRowClick={onRowClick}
        scrollToId={pane.scrollToId}
      />
    </div>
  );
}

export function TreeView(): JSX.Element {
  return <Tree />;
}
