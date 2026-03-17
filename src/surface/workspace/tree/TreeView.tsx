import React, { useEffect, useMemo, useRef, useState } from "react";
import { List, Map, Set as ImmutableSet } from "immutable";
import { ListRange, Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { useLocation } from "react-router-dom";
import type { GraphNode } from "../../../graph/types";
import { useDragAutoScroll } from "../layout/useDragAutoScroll";
import { ListItem } from "./Draggable";
import { getNodesInTree } from "../node/NodeView";
import {
  ViewContext,
  VirtualRowsProvider,
  useDisplayText,
  useRowPath,
  useViewKey,
} from "./RowContext";
import { getRowIDFromView } from "../../../rows/resolveRow";
import { getLast, type RowPath, rowPathToString } from "../../../rows/rowPaths";
import { isExpanded } from "../../../session/views";
import { useData } from "../../app-shell/DataContext";
import {
  usePaneStack,
  useCurrentPane,
  usePaneIndex,
} from "../layout/SplitPanesContext";
import { useApis } from "../../app-shell/ApiContext";
import {
  ActiveRowState,
  KeyboardMode,
  getRowIndex,
  getRowKey,
  isEditableElement,
  registerScrollToRow,
  unregisterScrollToRow,
} from "./keyboardNavigation";
import { useTemporaryView } from "./TemporaryViewContext";
import { usePlanner } from "../../app-shell/PlannerContext";
import {
  planClearTemporarySelection,
  planShiftTemporarySelection,
  planToggleTemporarySelection,
} from "../../../session/selection";
import type { TreeResult } from "../../../rows/projectTree";

const PaneTreeResultContext = React.createContext<TreeResult | undefined>(
  undefined
);

export function usePaneTreeResult(): TreeResult | undefined {
  return React.useContext(PaneTreeResultContext);
}

export function PaneTreeResultProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const data = useData();
  const stack = usePaneStack();
  const pane = useCurrentPane();
  const rowPath = useRowPath();
  const rootKey = rowPathToString(rowPath);
  const isRootExpanded = isExpanded(data, rootKey);
  const treeResult = useMemo(() => {
    if (!isRootExpanded) {
      return undefined;
    }
    return getNodesInTree(
      data,
      rowPath,
      stack,
      List<RowPath>(),
      pane.rootNodeId,
      pane.author,
      pane.typeFilters
    );
  }, [
    data,
    isRootExpanded,
    pane.author,
    pane.rootNodeId,
    pane.typeFilters,
    stack,
    rowPath,
  ]);

  return (
    <PaneTreeResultContext.Provider value={treeResult}>
      {children}
    </PaneTreeResultContext.Provider>
  );
}

function VirtuosoForColumn({
  nodes,
  startIndexFromStorage,
  range,
  setRange,
  onStopScrolling,
  rowPath,
  ariaLabel,
  activeRowKey,
  onRowFocus,
  onRowClick,
  scrollToId,
  firstVirtualKeys,
}: {
  nodes: List<RowPath>;
  startIndexFromStorage: number;
  range: ListRange;
  setRange: React.Dispatch<React.SetStateAction<ListRange>>;
  rowPath: RowPath;
  onStopScrolling: (isScrolling: boolean) => void;
  ariaLabel: string | undefined;
  activeRowKey: string;
  onRowFocus: (key: string, index: number, mode: KeyboardMode) => void;
  onRowClick?: (e: React.MouseEvent, viewKey: string) => void;
  scrollToId?: string;
  firstVirtualKeys: ImmutableSet<string>;
}): JSX.Element {
  const data = useData();
  const location = useLocation();
  const virtuosoRef = useRef<VirtuosoHandle>(null);
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
    if (treeRoot instanceof HTMLElement && virtuosoRef.current) {
      const ref = virtuosoRef;
      registerScrollToRow(treeRoot, (index, done) => {
        ref.current?.scrollIntoView({ index, behavior: "auto", done });
      });
      return () => unregisterScrollToRow(treeRoot);
    }
    return undefined;
  }, [scrollParent]);

  useEffect(() => {
    if (virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({
        align: "start",
        behavior: "auto",
        index: startIndexFromStorage,
      });
    }
  }, [location]);

  useEffect(() => {
    if (!scrollToId || !virtuosoRef.current) {
      return;
    }
    const index = nodes.findIndex(
      (path) =>
        getLast(path) === scrollToId ||
        getRowIDFromView(data, path)[0] === scrollToId
    );
    if (index >= 0) {
      virtuosoRef.current.scrollToIndex({
        index,
        align: "center",
        behavior: "auto",
      });
    }
  }, [data, nodes, scrollToId]);

  return (
    <div ref={containerRef} aria-label={ariaLabel}>
      <Virtuoso
        ref={virtuosoRef}
        customScrollParent={scrollParent}
        data={nodes.toArray()}
        rangeChanged={(r): void => {
          if (r.startIndex === 0 && r.endIndex === 0) {
            return;
          }
          if (
            r.startIndex !== range.startIndex ||
            r.endIndex !== range.endIndex
          ) {
            setRange(r);
          }
        }}
        isScrolling={onStopScrolling}
        itemContent={(index, path) => {
          const nextPath =
            index < nodes.size - 1 ? nodes.get(index + 1) : undefined;
          const pathKey = rowPathToString(path);
          const isFirstVirtual = firstVirtualKeys.has(pathKey);
          return (
            <ViewContext.Provider value={path} key={pathKey}>
              <ListItem
                index={index}
                treeRowPath={rowPath}
                nextDepth={nextPath ? nextPath.length - 1 : undefined}
                nextRowPathStr={
                  nextPath ? rowPathToString(nextPath) : undefined
                }
                activeRowKey={activeRowKey}
                onRowFocus={onRowFocus}
                onRowClick={onRowClick}
                isFirstVirtual={isFirstVirtual}
              />
            </ViewContext.Provider>
          );
        }}
        components={{
          Footer: () => <div style={{ height: "50vh" }} />,
        }}
      />
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
  const { getLocalStorage, setLocalStorage } = fileStore;
  const paneIndex = usePaneIndex();
  const scrollableId = useViewKey();
  const startIndexFromStorage = Number(getLocalStorage(scrollableId)) || 0;
  const [range, setRange] = useState<ListRange>({
    startIndex: startIndexFromStorage,
    endIndex: startIndexFromStorage,
  });
  const rowPath = useRowPath();
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
  const childNodes = treeResult?.paths || List<RowPath>();
  const virtualRows = treeResult?.virtualRows || Map<string, GraphNode>();
  const firstVirtualKeys =
    treeResult?.firstVirtualKeys || ImmutableSet<string>();
  // Include ROOT as the first node, followed by its children
  const nodes = List<RowPath>([rowPath]).concat(childNodes);
  const nodeKeys = nodes.map((path) => rowPathToString(path)).toArray();
  const displayText = useDisplayText();
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
    range.startIndex,
    range.endIndex,
  ]);

  const onStopScrolling = (isScrolling: boolean): void => {
    // don't set the storage if the index is 0 since onStopStrolling is called on initial render
    if (isScrolling || nodes.size <= 1 || range.startIndex === 0) {
      return;
    }
    const indexFromStorage = Number(getLocalStorage(scrollableId)) || 0;
    if (indexFromStorage !== range.startIndex) {
      setLocalStorage(scrollableId, range.startIndex.toString());
    }
  };

  return (
    <VirtualRowsProvider value={virtualRows}>
      <div
        ref={treeRootRef}
        data-keyboard-mode={keyboardMode}
        data-total-rows={nodes.size}
      >
        <VirtuosoForColumn
          nodes={nodes}
          range={range}
          setRange={setRange}
          startIndexFromStorage={startIndexFromStorage}
          rowPath={rowPath}
          onStopScrolling={onStopScrolling}
          ariaLabel={ariaLabel}
          activeRowKey={activeRow.activeRowKey}
          onRowFocus={onRowFocus}
          onRowClick={onRowClick}
          scrollToId={pane.scrollToId}
          firstVirtualKeys={firstVirtualKeys}
        />
      </div>
    </VirtualRowsProvider>
  );
}

export function TreeView(): JSX.Element {
  return <Tree />;
}
