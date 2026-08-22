import { List, Map, Set as ImmutableSet } from "immutable";
import { LOCAL, nodeRefKey } from "./core/nodeRef";
import {
  ViewPath,
  addNodeToPathWithNodes,
  addNodesToLastElement,
  getLast,
  getParentView,
  getViewForNode,
  isFileRow,
  viewPathToString,
} from "./rowModel";
import {
  EMPTY_NODE_ID,
  computeEmptyNodeMetadata,
  createRefTarget,
  isSearchId,
  itemPassesFilters,
  nodePathLabel as nodePathLabelOf,
} from "./core/connections";
import {
  embeddedTarget,
  linkSpan,
  nodeText,
  plainSpans,
} from "./core/nodeSpans";
import {
  IcalEntry,
  calendarEntryTarget,
  embeddedFeedUrl,
  hiddenPastEntryCount,
  isCalendarEntryId,
  icalEntryDisplayText,
  mergeProjectedEntries,
} from "./core/ical";
import { getDocumentByIdOrFilePath, type Document } from "./core/Document";
import { DEFAULT_TYPE_FILTERS } from "./core/constants";
import { getIncomingCrefsForNode } from "./semanticProjection";
import { buildReferenceItem } from "./buildReferenceRow";
import { referenceToText } from "./editor/referenceText";
import type { AddToParentTarget } from "./core/plan";
import {
  GraphLookup,
  ResolvedNode,
  getNodeInSource,
  graphLookupFromData,
  lookupNode,
} from "./core/graphLookup";
import {
  Showing,
  closesCycle,
  leavesDangling,
  linesShownThrough,
  presentedLineOf,
  showingTreeForRoot,
  standsForOf,
} from "./showings";

export type TreeResult = {
  rows: List<Row>;
};

type TreeTraversalOptions = {
  projectedRoot?: GraphNode;
  expandAll?: boolean;
};

const INCOMING_GROUP_THRESHOLD = 3;

function emptyTreeResult(rows: List<Row> = List<Row>()): TreeResult {
  return { rows };
}

function sourceIdForPath(data: Data, path: ViewPath): SourceId {
  return data.panes[path[0]]?.sourceId ?? LOCAL;
}

function expansionPathOf(viewPath: ViewPath): ID[] {
  const [, ...segments] = viewPath;
  return segments;
}

function footerVisibleSources(
  data: Data,
  paneIndex: number,
  localSourceIds: readonly SourceId[]
): ImmutableSet<SourceId> {
  const pane = data.panes[paneIndex];
  const pulled =
    pane && pane.sourceId === LOCAL
      ? data.pull?.matchedSourceIdsByPaneId.get(pane.id) ?? []
      : [];
  return ImmutableSet<SourceId>([...localSourceIds, ...pulled]);
}

type VirtualFooterInput = {
  parentPath: ViewPath;
  parentRow?: Row;
  parentID?: ID;
  parentSourceId: SourceId;
  parentRoot: ID;
  parentUpdated: number;
  incomingCrefs: List<NodeRef>;
};

function nodePathLabel(
  knowledgeDBs: KnowledgeDBs,
  resolved: ResolvedNode | undefined
): string | undefined {
  if (!resolved) {
    return undefined;
  }
  return nodePathLabelOf(knowledgeDBs, resolved.node, resolved.ref.sourceId);
}

type RowInput = {
  viewPath: ViewPath;
  node: GraphNode;
  sourceId: SourceId;
  parentRow?: Row;
  parentNode?: GraphNode;
  parentRef?: NodeRef;
  childIndex?: number;
  isFirstVirtual?: boolean;
  virtualType?: Row["virtualType"];
  standsFor?: Row["standsFor"];
  presentedSpans?: InlineSpan[];
  cycle?: boolean;
  dangling?: boolean;
};

function createRow(data: Data, graph: GraphLookup, input: RowInput): Row {
  const {
    viewPath,
    node,
    sourceId,
    parentRow,
    parentNode,
    parentRef,
    childIndex,
  } = input;
  const nodeID = node.id;
  const inheritedVirtualType =
    parentRow?.virtualType === "search" ? parentRow.virtualType : undefined;
  const rowVirtualType =
    input.virtualType ?? (isSearchId(nodeID) ? "search" : inheritedVirtualType);
  const projected =
    parentRow !== undefined &&
    (parentRow.projected === true ||
      (embeddedTarget(parentRow.node) !== undefined &&
        !parentRow.node.children.includes(nodeID)));
  const { standsFor } = input;
  const provenance =
    rowVirtualType === "incoming"
      ? { kind: rowVirtualType, sourceId }
      : undefined;
  const pane = data.panes[viewPath[0]];
  const reference =
    rowVirtualType === "incoming"
      ? (() => {
          const document = pane.documentId
            ? getDocumentByIdOrFilePath(
                data.documents,
                data.documentByFilePath,
                pane.sourceId,
                pane.documentId
              )
            : undefined;
          const topNodeID = document?.topNodeShortIds[0];
          const documentRoot =
            topNodeID && document
              ? getNodeInSource(graph, {
                  sourceId: document.sourceId,
                  id: topNodeID,
                })
              : undefined;
          const containing =
            parentNode && parentRef
              ? { ref: parentRef, node: parentNode }
              : documentRoot;
          return buildReferenceItem(
            graph,
            node.id,
            data,
            sourceId,
            rowVirtualType,
            containing
          );
        })()
      : undefined;
  return {
    viewPath,
    viewKey: viewPathToString(viewPath),
    index: 0,
    depth: viewPath.length - 1,
    node,
    sourceId,
    ref: { sourceId, id: node.id },
    view: getViewForNode(data, viewPath, nodeID),
    parentViewPath: parentRow?.viewPath ?? getParentView(viewPath),
    parentRef,
    parentNode,
    parentChildIndex: parentRow?.childIndex,
    childIndex,
    hasChildren: false,
    ...(standsFor && { standsFor }),
    ...(input.presentedSpans && { presentedSpans: input.presentedSpans }),
    ...(input.cycle && { cycle: true }),
    ...(input.dangling && { dangling: true }),
    ...(projected && { projected: true }),
    isFirstVirtual: input.isFirstVirtual === true,
    virtualType: rowVirtualType,
    provenance,
    reference,
  };
}

function reindexRows(rows: List<Row>): List<Row> {
  return rows.map((row, index) => ({
    ...row,
    index,
    depth: row.viewPath.length - 1,
  }));
}

function getEmptyNodeItem(
  data: Data,
  parentNode: GraphNode | undefined
): GraphNode | undefined {
  if (!parentNode) {
    return undefined;
  }
  return computeEmptyNodeMetadata(data.publishEventsStatus.temporaryEvents).get(
    parentNode.id as ID
  )?.nodeItem;
}

function emptyRootNode(): GraphNode {
  return {
    children: List<ID>(),
    id: EMPTY_NODE_ID,
    spans: plainSpans(""),
    updated: Date.now(),
    root: EMPTY_NODE_ID,
    relevance: undefined,
  };
}

function resolveRootNode(
  data: Data,
  graph: GraphLookup,
  rootPath: ViewPath,
  options?: TreeTraversalOptions
): ResolvedNode | undefined {
  const paneSourceId = sourceIdForPath(data, rootPath);
  const rootID = getLast(rootPath);
  if (options?.projectedRoot?.id === rootID) {
    return {
      node: options.projectedRoot,
      ref: { sourceId: graph.localSourceId, id: rootID },
    };
  }
  const resolved = lookupNode(graph, rootID, paneSourceId);
  if (resolved) {
    return resolved;
  }
  return rootID === EMPTY_NODE_ID
    ? { node: emptyRootNode(), ref: { sourceId: paneSourceId, id: rootID } }
    : undefined;
}

function composedFields(
  showing: Showing
): Pick<RowInput, "standsFor" | "presentedSpans" | "cycle" | "dangling"> {
  return {
    standsFor: standsForOf(showing),
    presentedSpans: presentedLineOf(showing).node.spans,
    cycle: closesCycle(showing),
    dangling: leavesDangling(showing),
  };
}

function rootRowForShowing(
  data: Data,
  graph: GraphLookup,
  showing: Showing,
  rootPath: ViewPath,
  options?: TreeTraversalOptions
): Row {
  const row = createRow(data, graph, {
    viewPath: rootPath,
    node: showing.node,
    sourceId: showing.ref.sourceId,
    ...composedFields(showing),
  });
  return options?.projectedRoot?.id === showing.node.id
    ? { ...row, materialize: { precededBy: [], root: true } }
    : row;
}

function createVirtualRowNode(
  data: Data,
  graph: GraphLookup,
  input: VirtualFooterInput,
  rowRef: NodeRef
): { node: GraphNode; sourceId: SourceId } {
  const incomingRow = getNodeInSource(graph, rowRef);
  const sourceNode = incomingRow?.node;
  return {
    node: {
      children: List<ID>(),
      id: rowRef.id,
      spans: [
        linkSpan(
          rowRef.id,
          nodePathLabel(data.knowledgeDBs, incomingRow) ?? ""
        ),
      ],
      parent: input.parentID,
      updated: sourceNode?.updated ?? input.parentUpdated,
      root: sourceNode?.root ?? input.parentRoot,
      relevance: undefined,
      argument: undefined,
    },
    sourceId: incomingRow?.ref.sourceId ?? input.parentSourceId,
  };
}

function appendNodeToPath(path: ViewPath, nodeID: ID): ViewPath {
  return [path[0], ...path.slice(1), nodeID] as ViewPath;
}

function incomingTakeTarget(
  graph: GraphLookup,
  sourceNodeID: ID,
  sourceId: SourceId
): AddToParentTarget {
  const sourceRow = getNodeInSource(graph, {
    sourceId,
    id: sourceNodeID,
  })?.node;
  return createRefTarget(
    sourceNodeID,
    sourceRow ? nodeText(sourceRow) : undefined
  );
}

function incomingSourceRootRef(graph: GraphLookup, rowRef: NodeRef): NodeRef {
  const source = getNodeInSource(graph, rowRef);
  return {
    sourceId: source?.ref.sourceId ?? rowRef.sourceId,
    id: source?.node.root ?? rowRef.id,
  };
}

function groupIncomingRefs(
  graph: GraphLookup,
  refs: List<NodeRef>
): Map<
  string,
  {
    rootRef: NodeRef;
    refs: NodeRef[];
  }
> {
  return refs.reduce(
    (acc, ref) => {
      const rootRef = incomingSourceRootRef(graph, ref);
      const key = nodeRefKey(rootRef);
      const existing = acc.get(key);
      return acc.set(key, {
        rootRef,
        refs: [...(existing?.refs ?? []), ref],
      });
    },
    Map<
      string,
      {
        rootRef: NodeRef;
        refs: NodeRef[];
      }
    >()
  );
}

function withIncomingGroupChildren(row: Row, refs: NodeRef[]): Row {
  return {
    ...row,
    node: {
      ...row.node,
      children: List<ID>(refs.map((ref) => ref.id)),
    },
  };
}

function createVirtualRow(
  data: Data,
  graph: GraphLookup,
  input: VirtualFooterInput,
  rowRef: NodeRef,
  isFirstVirtual: boolean,
  priorAnchors: ID[] = []
): Row {
  const sourceNodeID = rowRef.id;
  const { node, sourceId } = createVirtualRowNode(data, graph, input, rowRef);
  const parentPath =
    input.parentID === undefined
      ? input.parentPath
      : addNodesToLastElement(input.parentPath, input.parentID);
  const viewNodeID = `incoming:${sourceId}:${sourceNodeID}` as ID;
  const viewPath =
    input.parentID === undefined
      ? addNodesToLastElement(parentPath, viewNodeID)
      : appendNodeToPath(parentPath, viewNodeID);
  const parentRef = input.parentID
    ? { sourceId: input.parentSourceId, id: input.parentID }
    : undefined;
  const row = createRow(data, graph, {
    viewPath,
    node,
    sourceId,
    parentRow: input.parentRow,
    parentNode: input.parentRow?.node,
    parentRef,
    isFirstVirtual,
    virtualType: "incoming",
  });
  const parentChildren = input.parentID
    ? getNodeInSource(graph, {
        sourceId: input.parentSourceId,
        id: input.parentID,
      })?.node.children.toArray() ?? []
    : [];
  const inherited = getNodeInSource(graph, {
    sourceId,
    id: sourceNodeID,
  })?.node;
  return {
    ...row,
    materialize: {
      precededBy: [...priorAnchors, ...([...parentChildren].reverse() as ID[])],
      take: incomingTakeTarget(graph, sourceNodeID, sourceId),
      defaults: {
        relevance: inherited?.relevance,
        argument: inherited?.argument,
      },
      ...(input.parentRow?.materialize
        ? {
            host: {
              node: input.parentRow.node,
              parentRef: input.parentRow.parentRef,
              materialize: input.parentRow.materialize,
            },
          }
        : {}),
    },
  };
}

// A projected calendar entry as a behaviorally first-class row (idea.md,
// Computed rows are first-class in behavior): synthetic node, no
// virtualType, never stored — write gestures materialize it (M8.4).
function createProjectionRow(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  parentNode: GraphNode,
  parentSourceId: SourceId,
  entry: IcalEntry,
  precededBy: ID[]
): Row {
  const node: GraphNode = {
    children: List<ID>(),
    id: entry.id as ID,
    spans: plainSpans(icalEntryDisplayText(entry)),
    parent: parentNode.id,
    updated: parentNode.updated ?? Date.now(),
    root: parentNode.root ?? parentNode.id,
    relevance: undefined,
  };
  const parentPath = addNodesToLastElement(parentRow.viewPath, parentNode.id);
  const viewPath = appendNodeToPath(parentPath, node.id);
  const row = createRow(data, graph, {
    viewPath,
    node,
    sourceId: graph.localSourceId,
    parentRow,
    parentNode,
    parentRef: { sourceId: parentSourceId, id: parentNode.id },
  });
  return {
    ...row,
    materialize: {
      precededBy,
      take: createRefTarget(entry.id as ID, icalEntryDisplayText(entry)),
    },
  };
}

// The action row: a full-text, clickable, button-shaped thing in row
// position that is obviously not content — the wallet's "Register as
// Shareholder" element, shared instead of reinvented. One interaction
// (click), no gutter, no editor, no judgment. Carries its own view
// state (showPastEntries), so the reveal survives collapse/expand.
function createFooterActionRow(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  parentNode: GraphNode,
  parentSourceId: SourceId,
  id: ID,
  label: string,
  action: Row["action"]
): Row {
  const node: GraphNode = {
    children: List<ID>(),
    id,
    spans: plainSpans(label),
    parent: parentNode.id,
    updated: parentNode.updated ?? Date.now(),
    root: parentNode.root ?? parentNode.id,
    relevance: undefined,
  };
  const parentPath = addNodesToLastElement(parentRow.viewPath, parentNode.id);
  const viewPath = appendNodeToPath(parentPath, node.id);
  const row = createRow(data, graph, {
    viewPath,
    node,
    sourceId: graph.localSourceId,
    parentRow,
    parentNode,
    parentRef: { sourceId: parentSourceId, id: parentNode.id },
  });
  return { ...row, action };
}

function createPastDatesActionRow(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  parentNode: GraphNode,
  parentSourceId: SourceId
): Row {
  return createFooterActionRow(
    data,
    graph,
    parentRow,
    parentNode,
    parentSourceId,
    `action:past:${parentNode.id}` as ID,
    "past dates",
    "toggle-past-entries"
  );
}

// The machine-feeds merge at row level: children keep document order,
// untouched projections slot in per mergeProjectedEntries. Projections
// derive from data.calendarFeeds and never touch knowledgeDBs.
function interleaveProjectionRows(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  parentNode: GraphNode,
  parentSourceId: SourceId,
  rowsByChildId: Map<ID, Row>,
  childRows: List<Row>,
  typeFilters: Pane["typeFilters"]
): { rows: List<Row>; actionRow?: Row } {
  const feedUrl = embeddedFeedUrl(parentNode);
  const entries = feedUrl ? data.calendarFeeds?.get(feedUrl) : undefined;
  if (!entries || entries.length === 0) {
    return { rows: childRows };
  }
  const activeFilters = typeFilters || DEFAULT_TYPE_FILTERS;
  const childKeys = parentNode.children.toArray().reduce<{
    keys: ID[];
    childIdByKey: globalThis.Map<ID, ID>;
  }>(
    (acc, childId) => {
      const childNode = getNodeInSource(graph, {
        sourceId: parentSourceId,
        id: childId,
      })?.node;
      const entryId =
        calendarEntryTarget(childNode) ??
        (childNode && isCalendarEntryId(childNode.id)
          ? childNode.id
          : undefined);
      const key =
        entryId !== undefined && !acc.childIdByKey.has(entryId)
          ? entryId
          : childId;
      acc.childIdByKey.set(key, childId);
      return { keys: [...acc.keys, key], childIdByKey: acc.childIdByKey };
    },
    { keys: [], childIdByKey: new globalThis.Map<ID, ID>() }
  );
  const entriesById = new globalThis.Map(
    entries.map((entry) => [entry.id as ID, entry])
  );
  // Bare past entries don't project by default; the action row reveals
  // them. File content always shows. Pastness is node-type rendering,
  // never a judgment.
  const pastCount = hiddenPastEntryCount(childKeys.keys, entries, Date.now());
  const actionRow =
    pastCount > 0
      ? createPastDatesActionRow(
          data,
          graph,
          parentRow,
          parentNode,
          parentSourceId
        )
      : undefined;
  const showPast = actionRow?.view.showPastEntries === true;
  const merged = mergeProjectedEntries(
    childKeys.keys,
    entries,
    showPast ? undefined : Date.now()
  );
  // Nearest-first anchors of everything displayed above, materialized or
  // not — ids are deterministic, so an anchor may reference a row that
  // doesn't exist yet. Projections obey the marker filters like every row.
  const { rows } = merged.reduce<{ rows: Row[]; precededBy: ID[] }>(
    (acc, item) => {
      if (item.kind === "projection") {
        const row = createProjectionRow(
          data,
          graph,
          parentRow,
          parentNode,
          parentSourceId,
          item.entry,
          acc.precededBy
        );
        return {
          rows: itemPassesFilters(row.node, activeFilters)
            ? [...acc.rows, row]
            : acc.rows,
          precededBy: [item.entry.id as ID, ...acc.precededBy],
        };
      }
      const childId = childKeys.childIdByKey.get(item.childId as ID);
      const row =
        childId !== undefined ? rowsByChildId.get(childId) : undefined;
      const entry = entriesById.get(item.childId as ID);
      const placementRow =
        row && item.childId !== childId
          ? {
              ...row,
              reference: undefined,
              standsFor: { id: item.childId as ID },
              ...(entry
                ? { presentedSpans: plainSpans(icalEntryDisplayText(entry)) }
                : {}),
            }
          : row;
      return {
        rows: placementRow ? [...acc.rows, placementRow] : acc.rows,
        precededBy: [item.childId as ID, ...acc.precededBy],
      };
    },
    { rows: [], precededBy: [] }
  );
  // The action row is footer territory — the caller places it below the
  // dotted line, ahead of the other virtual rows. Never an anchor: its
  // id is view furniture, not content.
  return { rows: List(rows), actionRow };
}

function appendVirtualFooterRows(
  data: Data,
  graph: GraphLookup,
  input: VirtualFooterInput,
  initial: TreeResult = emptyTreeResult()
): TreeResult {
  const groups = groupIncomingRefs(graph, input.incomingCrefs);
  const incomingRows = input.incomingCrefs.reduce<{
    rows: Row[];
    priorAnchors: ID[];
    emittedGroupKeys: ImmutableSet<string>;
  }>(
    (acc, rowRef) => {
      const rootRef = incomingSourceRootRef(graph, rowRef);
      const key = nodeRefKey(rootRef);
      const group = groups.get(key);
      const grouped =
        group !== undefined && group.refs.length >= INCOMING_GROUP_THRESHOLD;
      const nextPriorAnchors = [rowRef.id, ...acc.priorAnchors];
      if (grouped && acc.emittedGroupKeys.has(key)) {
        return {
          ...acc,
          priorAnchors: nextPriorAnchors,
        };
      }
      const row = createVirtualRow(
        data,
        graph,
        input,
        grouped ? group.rootRef : rowRef,
        acc.rows.length === 0,
        acc.priorAnchors
      );
      return {
        rows: [
          ...acc.rows,
          grouped ? withIncomingGroupChildren(row, group.refs) : row,
        ],
        priorAnchors: nextPriorAnchors,
        emittedGroupKeys: grouped
          ? acc.emittedGroupKeys.add(key)
          : acc.emittedGroupKeys,
      };
    },
    { rows: [], priorAnchors: [], emittedGroupKeys: ImmutableSet<string>() }
  ).rows;
  return { rows: initial.rows.concat(incomingRows) };
}

function shortIncomingReference(reference: Row["reference"]): Row["reference"] {
  if (!reference) {
    return undefined;
  }
  return {
    ...reference,
    contextLabels: [],
    text: referenceToText({
      displayAs: "incoming",
      contextLabels: [],
      targetLabel: reference.targetLabel,
      incomingRelevance: reference.incomingRelevance,
      incomingArgument: reference.incomingArgument,
    }),
  };
}

function createIncomingGroupChildRow(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  childID: ID,
  index: number
): Row | undefined {
  const sourceNode = getNodeInSource(graph, {
    sourceId: parentRow.sourceId,
    id: childID,
  })?.node;
  if (!sourceNode || !parentRow.parentRef || !parentRow.parentNode) {
    return undefined;
  }
  const node: GraphNode = {
    children: List<ID>(),
    id: childID,
    spans: [linkSpan(childID, nodeText(sourceNode))],
    parent: parentRow.parentRef.id,
    updated: sourceNode.updated ?? parentRow.node.updated,
    root: sourceNode.root ?? parentRow.node.root,
    relevance: undefined,
    argument: undefined,
  };
  const viewPath = appendNodeToPath(
    parentRow.viewPath,
    `incoming:${parentRow.sourceId}:${childID}` as ID
  );
  const row = createRow(data, graph, {
    viewPath,
    node,
    sourceId: parentRow.sourceId,
    parentRow,
    parentNode: parentRow.parentNode,
    parentRef: parentRow.parentRef,
    virtualType: "incoming",
  });
  const priorChildIds = parentRow.node.children.slice(0, index).reverse();
  return {
    ...row,
    reference: shortIncomingReference(row.reference),
    materialize: {
      precededBy: [
        ...priorChildIds.toArray(),
        ...(parentRow.materialize?.precededBy ?? []),
      ],
      take: incomingTakeTarget(graph, childID, parentRow.sourceId),
      defaults: {
        relevance: sourceNode.relevance,
        argument: sourceNode.argument,
      },
      ...(parentRow.materialize?.host
        ? { host: parentRow.materialize.host }
        : {}),
    },
  };
}

function getIncomingGroupChildren(
  data: Data,
  graph: GraphLookup,
  parentRow: Row
): TreeResult {
  return {
    rows: parentRow.node.children
      .map((childID, index) =>
        createIncomingGroupChildRow(data, graph, parentRow, childID, index)
      )
      .filter((row): row is Row => row !== undefined)
      .toList(),
  };
}

function projectedRow(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  source: Showing,
  line: Showing
): Row {
  const parentPath = addNodesToLastElement(
    parentRow.viewPath,
    parentRow.node.id
  );
  return createRow(data, graph, {
    viewPath: appendNodeToPath(parentPath, line.node.id),
    node: line.node,
    sourceId: line.ref.sourceId,
    parentRow,
    parentNode: source.node,
    parentRef: source.ref,
    ...composedFields(line),
  });
}

function fileRow(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  line: Showing,
  childIndex: number
): Row {
  return createRow(data, graph, {
    viewPath: addNodeToPathWithNodes(
      parentRow.viewPath,
      parentRow.node,
      childIndex
    ),
    node: line.node,
    sourceId: line.ref.sourceId,
    parentRow,
    parentNode: parentRow.node,
    parentRef: parentRow.ref,
    childIndex,
    ...composedFields(line),
  });
}

function emptyChildRow(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  childIndex: number
): Row | undefined {
  const emptyNode = getEmptyNodeItem(data, parentRow.node);
  return emptyNode
    ? createRow(data, graph, {
        viewPath: addNodeToPathWithNodes(
          parentRow.viewPath,
          parentRow.node,
          childIndex
        ),
        node: emptyNode,
        sourceId: graph.localSourceId,
        parentRow,
        parentNode: parentRow.node,
        parentRef: parentRow.ref,
        childIndex,
      })
    : undefined;
}

function emptyChildIndexes(parentRow: Row): number[] {
  return parentRow.node.children
    .toArray()
    .flatMap((childID, childIndex) =>
      childID === EMPTY_NODE_ID ? [childIndex] : []
    );
}

function convertShowingChildren(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  parentShowing: Showing | undefined,
  activeFilters: NonNullable<Pane["typeFilters"]>
): { rows: List<Row>; showings: Map<string, Showing> } {
  const shownPairs = linesShownThrough(
    parentShowing ? parentShowing.target : undefined
  ).flatMap(({ source, line }) =>
    itemPassesFilters(line.node, activeFilters)
      ? [{ row: projectedRow(data, graph, parentRow, source, line), line }]
      : []
  );
  const lineEntries = (parentShowing ? parentShowing.children : []).flatMap(
    (line) =>
      line.reached.kind === "line"
        ? [{ childIndex: line.reached.childIndex, line }]
        : []
  );
  const empties = emptyChildIndexes(parentRow).map((childIndex) => ({
    childIndex,
    line: undefined,
  }));
  const filePairs = [...lineEntries, ...empties]
    .sort((left, right) => left.childIndex - right.childIndex)
    .flatMap(
      ({ childIndex, line }): { row: Row; line: Showing | undefined }[] => {
        if (!line) {
          const row = emptyChildRow(data, graph, parentRow, childIndex);
          return row ? [{ row, line: undefined }] : [];
        }
        if (!itemPassesFilters(line.node, activeFilters)) {
          return [];
        }
        return [
          { row: fileRow(data, graph, parentRow, line, childIndex), line },
        ];
      }
    );
  const pairs = [...shownPairs, ...filePairs];
  return {
    rows: List(pairs.map(({ row }) => row)),
    showings: Map<string, Showing>(
      pairs.flatMap(({ row, line }): [string, Showing][] =>
        line ? [[row.viewKey, line]] : []
      )
    ),
  };
}

function fileChildNodes(parentShowing: Showing | undefined): List<GraphNode> {
  return List(
    (parentShowing ? parentShowing.children : []).flatMap((line) =>
      line.reached.kind === "line" ? [line.node] : []
    )
  );
}

function footerRowsForFileRow(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  allChildNodes: List<GraphNode>,
  rootNode: ID | undefined,
  author: SourceId,
  activeFilters: NonNullable<Pane["typeFilters"]>
): List<Row> {
  const nodes = parentRow.node;
  const nodeSourceId = parentRow.ref.sourceId;
  const visibleAuthors = footerVisibleSources(data, parentRow.viewPath[0], [
    LOCAL,
    author,
    nodeSourceId,
  ]);
  const incomingCrefs = getIncomingCrefsForNode(
    data,
    visibleAuthors,
    parentRow.standsFor?.id ?? nodes.id,
    nodeSourceId,
    expansionPathOf(parentRow.viewPath),
    allChildNodes,
    undefined
  ).filter((ref) => ref.id !== nodes.id);
  const visibleIncomingCrefs = activeFilters.includes("incoming")
    ? incomingCrefs
    : List<NodeRef>();
  return appendVirtualFooterRows(data, graph, {
    parentPath: parentRow.viewPath,
    parentRow,
    parentID: nodes.id,
    parentSourceId: nodeSourceId,
    parentRoot: nodes.root ?? rootNode ?? nodes.id,
    parentUpdated: nodes.updated ?? Date.now(),
    incomingCrefs: visibleIncomingCrefs,
  }).rows;
}

function childRowsForRow(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  parentShowing: Showing | undefined,
  rootNode: ID | undefined,
  author: SourceId,
  typeFilters: Pane["typeFilters"]
): { rows: List<Row>; showings: Map<string, Showing> } {
  if (
    parentRow.virtualType === "incoming" &&
    parentRow.node.children.size > 0
  ) {
    return {
      rows: getIncomingGroupChildren(data, graph, parentRow).rows,
      showings: Map<string, Showing>(),
    };
  }
  const activeFilters = typeFilters || DEFAULT_TYPE_FILTERS;
  const converted = convertShowingChildren(
    data,
    graph,
    parentRow,
    parentShowing,
    activeFilters
  );

  if (!isFileRow(parentRow)) {
    return converted;
  }

  const rowsByChildId = Map<ID, Row>(
    converted.rows.flatMap((row): [ID, Row][] => {
      if (row.childIndex === undefined) {
        return [];
      }
      const childID = parentRow.node.children.get(row.childIndex);
      return childID === undefined ? [] : [[childID, row]];
    })
  );
  const { rows: mergedRows, actionRow } = interleaveProjectionRows(
    data,
    graph,
    parentRow,
    parentRow.node,
    parentRow.ref.sourceId,
    rowsByChildId,
    converted.rows,
    typeFilters
  );
  const footer = footerRowsForFileRow(
    data,
    graph,
    parentRow,
    fileChildNodes(parentShowing),
    rootNode,
    author,
    activeFilters
  );

  // The action row leads the footer block: it carries the dotted
  // separator (isFirstVirtual) and the real virtual rows lose it.
  const footerRows = actionRow
    ? List<Row>([{ ...actionRow, isFirstVirtual: true }]).concat(
        footer.map((footerRow) => ({
          ...footerRow,
          isFirstVirtual: false,
        }))
      )
    : footer;

  return { rows: mergedRows.concat(footerRows), showings: converted.showings };
}

function hasHiddenPastEntries(
  data: Data,
  graph: GraphLookup,
  node: GraphNode,
  sourceId: SourceId
): boolean {
  const feedUrl = embeddedFeedUrl(node);
  const entries = feedUrl ? data.calendarFeeds?.get(feedUrl) : undefined;
  if (!entries) {
    return false;
  }
  const childKeys = node.children.toArray().map((childId) => {
    const child = getNodeInSource(graph, { sourceId, id: childId })?.node;
    return (
      calendarEntryTarget(child) ??
      (child && isCalendarEntryId(child.id) ? child.id : childId)
    );
  });
  return hiddenPastEntryCount(childKeys, entries, Date.now()) > 0;
}

function getNodesInRows(
  data: Data,
  graph: GraphLookup,
  rows: List<Row>,
  showingsByKey: Map<string, Showing>,
  acc: List<Row>,
  rootNode: ID | undefined,
  author: SourceId,
  typeFilters: Pane["typeFilters"],
  expandAll: boolean
): List<Row> {
  return rows.reduce((result, row) => {
    const children = childRowsForRow(
      data,
      graph,
      row,
      showingsByKey.get(row.viewKey),
      rootNode,
      author,
      typeFilters
    );
    const withHasChildren = {
      ...row,
      hasChildren:
        children.rows.size > 0 ||
        (isFileRow(row) &&
          hasHiddenPastEntries(data, graph, row.node, row.sourceId)),
    };
    const pushed = result.push(withHasChildren);
    if (!expandAll && !withHasChildren.view.expanded) {
      return pushed;
    }
    return getNodesInRows(
      data,
      graph,
      children.rows,
      children.showings,
      pushed,
      rootNode,
      author,
      typeFilters,
      expandAll
    );
  }, acc);
}

function rootRowsForPaths(
  data: Data,
  graph: GraphLookup,
  rootPaths: List<ViewPath>,
  options?: TreeTraversalOptions
): { rows: List<Row>; showings: Map<string, Showing> } {
  const roots = rootPaths.toArray().flatMap((rootPath) => {
    const resolved = resolveRootNode(data, graph, rootPath, options);
    if (!resolved) {
      return [];
    }
    const showing = showingTreeForRoot(graph, resolved);
    return [
      {
        row: rootRowForShowing(data, graph, showing, rootPath, options),
        showing,
      },
    ];
  });
  return {
    rows: List(roots.map(({ row }) => row)),
    showings: Map<string, Showing>(
      roots.map(({ row, showing }) => [row.viewKey, showing])
    ),
  };
}

export function getNodesInTree(
  data: Data,
  rootPaths: List<ViewPath>,
  rootNode: ID | undefined,
  author: SourceId,
  typeFilters: Pane["typeFilters"],
  options?: TreeTraversalOptions
): TreeResult {
  const graph = graphLookupFromData(data);
  const roots = rootRowsForPaths(data, graph, rootPaths, options);
  return {
    rows: reindexRows(
      getNodesInRows(
        data,
        graph,
        roots.rows,
        roots.showings,
        List<Row>(),
        rootNode,
        author,
        typeFilters,
        options?.expandAll === true
      )
    ),
  };
}

export function getNodesInDocument(
  data: Data,
  documentRootPath: ViewPath,
  document: Document,
  typeFilters: Pane["typeFilters"],
  options?: TreeTraversalOptions
): TreeResult {
  const activeFilters = typeFilters || DEFAULT_TYPE_FILTERS;
  const topNodePaths = List(
    document.topNodeShortIds.map((topNodeShortId) =>
      addNodesToLastElement(documentRootPath, topNodeShortId as ID)
    )
  );
  const graph = graphLookupFromData(data);
  const tops = rootRowsForPaths(data, graph, topNodePaths);
  const topRows = tops.rows;
  const topNodes = topRows.map((row) => row.node);
  const treeResult = {
    rows: reindexRows(
      getNodesInRows(
        data,
        graph,
        tops.rows,
        tops.showings,
        List<Row>(),
        undefined,
        document.sourceId,
        activeFilters,
        options?.expandAll === true
      )
    ),
  };

  if (!activeFilters.includes("incoming")) {
    return treeResult;
  }

  const visibleAuthors = footerVisibleSources(data, documentRootPath[0], [
    LOCAL,
    document.sourceId,
  ]);
  const incomingCrefs = getIncomingCrefsForNode(
    data,
    visibleAuthors,
    undefined,
    document.sourceId,
    expansionPathOf(documentRootPath),
    topNodes,
    document.filePath
  );

  const footer = appendVirtualFooterRows(data, graph, {
    parentPath: documentRootPath,
    parentRow: topRows.first(),
    parentID: topNodes.first()?.id,
    parentSourceId: document.sourceId,
    parentRoot: topNodes.first()?.root ?? EMPTY_NODE_ID,
    parentUpdated: document.updatedMs,
    incomingCrefs,
  });
  const secondTopRow = topRows.get(1);
  const footerIndex = secondTopRow
    ? treeResult.rows.findIndex((row) => row.viewKey === secondTopRow.viewKey)
    : treeResult.rows.size;
  return {
    rows: reindexRows(
      treeResult.rows.splice(footerIndex, 0, ...footer.rows.toArray())
    ),
  };
}
