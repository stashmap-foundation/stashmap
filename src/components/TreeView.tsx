import React, { useEffect, useRef, useState } from "react";
import { List, Map, Set as ImmutableSet } from "immutable";
import { ListRange, Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { useLocation } from "react-router-dom";
import { useDragAutoScroll } from "../useDragAutoScroll";
import { ListItem } from "./Draggable";
import { getNodesInTree } from "./Node";
import {
  useViewPath,
  ViewPath,
  viewPathToString,
  ViewContext,
  useViewKey,
  getNodeIDFromView,
  getLast,
  isExpanded,
  useDisplayText,
  getEffectiveAuthor,
  VirtualItemsProvider,
} from "../ViewContext";
import { useData } from "../DataContext";
import {
  usePaneStack,
  useCurrentPane,
  usePaneIndex,
} from "../SplitPanesContext";
import {
  addNodeToFilters,
  addReferencedByToFilters,
  addDescendantsToFilters,
  addListToFilters,
  createBaseFilter,
  filtersToFilterArray,
  useQueryKnowledgeData,
  LoadMissingVersionNodes,
} from "../dataQuery";
import { RegisterQuery } from "../LoadingStatus";
import {
  shortID,
  isSearchId,
  getRelations,
  isConcreteRefId,
  parseConcreteRefId,
  getRelationsNoReferencedBy,
} from "../connections";
import { getTombstone } from "../buildReferenceNode";
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
import { useTemporaryView } from "./TemporaryViewContext";
import {
  planClearTemporarySelection,
  planShiftTemporarySelection,
  planToggleTemporarySelection,
  usePlanner,
} from "../planner";

const LOAD_EXTRA = 10;

function VirtuosoForColumn({
  nodes,
  startIndexFromStorage,
  range,
  setRange,
  onStopScrolling,
  viewPath,
  ariaLabel,
  activeRowKey,
  onRowFocus,
  onRowClick,
  scrollToNodeId,
  firstVirtualKeys,
}: {
  nodes: List<ViewPath>;
  startIndexFromStorage: number;
  range: ListRange;
  setRange: React.Dispatch<React.SetStateAction<ListRange>>;
  viewPath: ViewPath;
  onStopScrolling: (isScrolling: boolean) => void;
  ariaLabel: string | undefined;
  activeRowKey: string;
  onRowFocus: (key: string, index: number, mode: KeyboardMode) => void;
  onRowClick?: (e: React.MouseEvent, viewKey: string) => void;
  scrollToNodeId?: string;
  firstVirtualKeys: ImmutableSet<string>;
}): JSX.Element {
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
    if (!scrollToNodeId || !virtuosoRef.current) {
      return;
    }
    const index = nodes.findIndex(
      (path) => getLast(path).nodeID === scrollToNodeId
    );
    if (index >= 0) {
      virtuosoRef.current.scrollToIndex({
        index,
        align: "center",
        behavior: "auto",
      });
    }
  }, [scrollToNodeId, nodes.size]);

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
          const pathKey = viewPathToString(path);
          const isFirstVirtual = firstVirtualKeys.has(pathKey);
          return (
            <ViewContext.Provider value={path} key={pathKey}>
              <ListItem
                index={index}
                treeViewPath={viewPath}
                nextDepth={nextPath ? nextPath.length - 1 : undefined}
                nextViewPathStr={
                  nextPath ? viewPathToString(nextPath) : undefined
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

export function TreeViewNodeLoader({
  children,
  nodes,
  range,
}: {
  range?: ListRange;
  children: React.ReactNode;
  nodes: List<ViewPath>;
}): JSX.Element {
  const data = useData();
  const viewPath = useViewPath();
  const effectiveAuthor = getEffectiveAuthor(data, viewPath);
  const baseFilter = createBaseFilter(
    data.contacts,
    data.projectMembers,
    data.user.publicKey,
    effectiveAuthor
  );

  const nodeIDs = nodes.map((path) => getNodeIDFromView(data, path)[0]);

  const nodeIDsWithRange = range
    ? nodeIDs.slice(range.startIndex, range.endIndex + 1 + LOAD_EXTRA) // +1 because slice doesn't include last element
    : nodeIDs;

  const filter = nodeIDsWithRange.reduce((rdx, nodeID) => {
    const withNode = addNodeToFilters(rdx, nodeID);

    if (!isConcreteRefId(nodeID)) {
      return addReferencedByToFilters(withNode, nodeID);
    }

    const parsed = parseConcreteRefId(nodeID);
    if (!parsed) {
      return withNode;
    }

    const withRelation = addListToFilters(withNode, parsed.relationID, nodeID);

    const relation = getRelationsNoReferencedBy(
      data.knowledgeDBs,
      parsed.relationID,
      data.user.publicKey
    );
    if (!relation) {
      const tombstone = getTombstone(
        data.knowledgeDBs,
        parsed.relationID,
        data.user.publicKey
      );
      if (!tombstone) {
        return withRelation;
      }
      const tombstoneNodes = [
        ...tombstone.context.toArray(),
        tombstone.head,
        ...(parsed.targetNode ? [parsed.targetNode] : []),
      ] as ID[];
      return tombstoneNodes.reduce(
        (acc, nid) => addNodeToFilters(acc, nid),
        withRelation
      );
    }

    const withTargetRefs = parsed.targetNode
      ? addReferencedByToFilters(withRelation, parsed.targetNode)
      : withRelation;

    const contextNodes = [...relation.context.toArray(), relation.head] as ID[];
    const withContextNodes = contextNodes.reduce(
      (acc, contextNodeID) => addNodeToFilters(acc, contextNodeID),
      withTargetRefs
    );
    return addDescendantsToFilters(withContextNodes, relation.head);
  }, baseFilter);

  const finalFilter = filtersToFilterArray(filter);
  const { allEventsProcessed } = useQueryKnowledgeData(finalFilter);

  return (
    <LoadMissingVersionNodes nodes={nodes}>
      <RegisterQuery
        nodesBeeingQueried={nodeIDs.map((longID) => shortID(longID)).toArray()}
        allEventsProcessed={allEventsProcessed}
      >
        {children}
      </RegisterQuery>
    </LoadMissingVersionNodes>
  );
}

function Tree(): JSX.Element | null {
  const data = useData();
  const stack = usePaneStack();
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
  const viewPath = useViewPath();
  const [activeRow, setActiveRow] = useState<ActiveRowState>({
    activeRowKey: "",
    activeRowIndex: 0,
  });
  const [consumedRowFocusIntentId, setConsumedRowFocusIntentId] = useState<
    number | null
  >(null);
  const treeRootRef = useRef<HTMLDivElement>(null);
  const [keyboardMode, setKeyboardMode] = useKeyboardMode();
  const viewKey = viewPathToString(viewPath);
  const isRootExpanded = isExpanded(data, viewKey);
  const treeResult = isRootExpanded
    ? getNodesInTree(data, viewPath, stack, List<ViewPath>(), pane.rootRelation, pane.author, pane.typeFilters)
    : undefined;
  const childNodes = treeResult?.paths || List<ViewPath>();
  const virtualItems = treeResult?.virtualItems || Map<string, RelationItem>();
  const firstVirtualKeys =
    treeResult?.firstVirtualKeys || ImmutableSet<string>();
  // Include ROOT as the first node, followed by its children
  const nodes = List<ViewPath>([viewPath]).concat(childNodes);
  const nodeKeys = nodes.map((path) => viewPathToString(path)).toArray();
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
    <VirtualItemsProvider value={virtualItems}>
      <div
        ref={treeRootRef}
        data-keyboard-mode={keyboardMode}
        data-total-rows={nodes.size}
      >
        <TreeViewNodeLoader nodes={nodes} range={range}>
          <VirtuosoForColumn
            nodes={nodes}
            range={range}
            setRange={setRange}
            startIndexFromStorage={startIndexFromStorage}
            viewPath={viewPath}
            onStopScrolling={onStopScrolling}
            ariaLabel={ariaLabel}
            activeRowKey={activeRow.activeRowKey}
            onRowFocus={onRowFocus}
            onRowClick={onRowClick}
            scrollToNodeId={pane.scrollToNodeId}
            firstVirtualKeys={firstVirtualKeys}
          />
        </TreeViewNodeLoader>
      </div>
    </VirtualItemsProvider>
  );
}

export function TreeView(): JSX.Element {
  const data = useData();
  const viewPath = useViewPath();
  const effectiveAuthor = getEffectiveAuthor(data, viewPath);
  const rootNodeID = getLast(viewPath).nodeID;
  const baseFilter = createBaseFilter(
    data.contacts,
    data.projectMembers,
    data.user.publicKey,
    effectiveAuthor
  );

  const searchFilter = (() => {
    if (!isSearchId(rootNodeID as ID)) {
      return baseFilter;
    }
    const searchRelation = getRelations(
      data.knowledgeDBs,
      rootNodeID as ID,
      data.user.publicKey
    );
    if (!searchRelation) {
      return baseFilter;
    }
    return searchRelation.items.reduce(
      (rdx, item) => addReferencedByToFilters(rdx, item.nodeID),
      baseFilter
    );
  })();

  useQueryKnowledgeData(filtersToFilterArray(searchFilter));

  return <Tree />;
}
