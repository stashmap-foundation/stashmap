import React, { useEffect, useRef, useState } from "react";
import { List } from "immutable";
import {
  ListRange,
  ScrollerProps,
  Virtuoso,
  VirtuosoHandle,
} from "react-virtuoso";
import { useDndScrolling } from "react-dnd-scrolling";
import { useLocation } from "react-router-dom";
import { ListItem } from "./Draggable";
import { getNodesInTree } from "./Node";
import {
  useNode,
  useViewPath,
  ViewPath,
  viewPathToString,
  ViewContext,
  useViewKey,
  getNodeIDFromView,
  getLast,
  parseViewPath,
  isExpanded,
} from "../ViewContext";
import { MergeKnowledgeDB, useData } from "../DataContext";
import { usePaneNavigation } from "../SplitPanesContext";
import {
  addListToFilters,
  addNodeToFilters,
  createBaseFilter,
  filtersToFilterArray,
  useQueryKnowledgeData,
} from "../dataQuery";
import { RegisterQuery } from "../LoadingStatus";
import { shortID } from "../connections";
import { useApis } from "../Apis";

const LOAD_EXTRA = 10;

function VirtuosoForColumn({
  nodes,
  startIndexFromStorage,
  range,
  setRange,
  onStopScrolling,
  viewPath,
  ariaLabel,
}: {
  nodes: List<ViewPath>;
  startIndexFromStorage: number;
  range: ListRange;
  setRange: React.Dispatch<React.SetStateAction<ListRange>>;
  viewPath: ViewPath;
  onStopScrolling: (isScrolling: boolean) => void;
  ariaLabel: string | undefined;
}): JSX.Element {
  const location = useLocation();
  const virtuosoRef = useRef<VirtuosoHandle>(null); // Step 2
  useEffect(() => {
    if (virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({
        align: "start",
        behavior: "auto",
        index: startIndexFromStorage,
      });
    }
  }, [location]);

  const [totalListHeight, setTotalListHeight] = useState<number | undefined>(
    undefined
  );
  const virtuosoStyle = {
    height: totalListHeight ? `${totalListHeight}px` : "1px",
  };

  /* eslint-disable react/jsx-props-no-spreading */
  const Scroller = React.useCallback(
    React.forwardRef<HTMLDivElement, ScrollerProps>(
      ({ style, ...props }, ref) => {
        useDndScrolling(ref, {});
        return <div style={style} ref={ref} {...props} />;
      }
    ),
    []
  );
  /* eslint-enable react/jsx-props-no-spreading */
  return (
    <div
      className="max-height-100 overflow-hidden background-dark"
      aria-label={ariaLabel}
      style={virtuosoStyle}
    >
      <Virtuoso
        ref={virtuosoRef}
        data={nodes.toArray()}
        totalListHeightChanged={(height) => {
          setTotalListHeight(height);
        }}
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
        components={{ Scroller }}
        itemContent={(index, path) => {
          return (
            <ViewContext.Provider value={path} key={viewPathToString(path)}>
              <ListItem index={index} treeViewPath={viewPath} />
            </ViewContext.Provider>
          );
        }}
      />
    </div>
  );
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
  const baseFilter = createBaseFilter(
    data.contacts,
    data.projectMembers,
    data.user.publicKey
  );

  const nodeIDs = nodes.map((path) => getNodeIDFromView(data, path)[0]);

  const nodeIDsWithRange = range
    ? nodeIDs.slice(range.startIndex, range.endIndex + 1 + LOAD_EXTRA) // +1 because slice doesn't include last element
    : nodeIDs;

  const filter = nodeIDsWithRange.reduce(
    (rdx, nodeID) => addNodeToFilters(rdx, nodeID),
    baseFilter
  );

  const finalFilter = filtersToFilterArray(filter);
  const { knowledgeDBs: mergedDBs, allEventsProcessed } =
    useQueryKnowledgeData(finalFilter);

  return (
    <MergeKnowledgeDB knowledgeDBs={mergedDBs}>
      <RegisterQuery
        nodesBeeingQueried={nodeIDs.map((longID) => shortID(longID)).toArray()}
        allEventsProcessed={allEventsProcessed}
      >
        {children}
      </RegisterQuery>
    </MergeKnowledgeDB>
  );
}

function Tree(): JSX.Element | null {
  const data = useData();
  const { stack } = usePaneNavigation();
  const { fileStore } = useApis();
  const { getLocalStorage, setLocalStorage } = fileStore;
  const scrollableId = useViewKey();
  const startIndexFromStorage = Number(getLocalStorage(scrollableId)) || 0;
  const [range, setRange] = useState<ListRange>({
    startIndex: startIndexFromStorage,
    endIndex: startIndexFromStorage,
  });
  const viewPath = useViewPath();
  const viewKey = viewPathToString(viewPath);
  const isRootExpanded = isExpanded(data, viewKey);
  const childNodes = isRootExpanded
    ? getNodesInTree(data, viewPath, stack, List<ViewPath>())
    : List<ViewPath>();
  // Include ROOT as the first node, followed by its children
  const nodes = List<ViewPath>([viewPath]).concat(childNodes);
  const [node] = useNode();
  const ariaLabel = node ? `related to ${node.text}` : undefined;

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
    <TreeViewNodeLoader nodes={nodes} range={range}>
      <VirtuosoForColumn
        nodes={nodes}
        range={range}
        setRange={setRange}
        startIndexFromStorage={startIndexFromStorage}
        viewPath={viewPath}
        onStopScrolling={onStopScrolling}
        ariaLabel={ariaLabel}
      />
    </TreeViewNodeLoader>
  );
}

export function TreeView(): JSX.Element {
  const data = useData();
  const key = useViewKey();
  const filter = createBaseFilter(
    data.contacts,
    data.projectMembers,
    data.user.publicKey
  );

  // Find all Lists attached to all Nodes and subnodes of this tree
  const lists = data.views
    .filter(
      (view, path) => path.startsWith(key) && view.expanded && path !== key
    )
    .map((view) => view.relations || ("" as LongID))
    .filter((r) => r !== "");
  const listsFilter = lists.reduce(
    (rdx, listID, path) =>
      addListToFilters(rdx, listID, getLast(parseViewPath(path)).nodeID),
    filter
  );
  const { knowledgeDBs } = useQueryKnowledgeData(
    filtersToFilterArray(listsFilter)
  );

  return (
    <MergeKnowledgeDB knowledgeDBs={knowledgeDBs}>
      <Tree />
    </MergeKnowledgeDB>
  );
}
