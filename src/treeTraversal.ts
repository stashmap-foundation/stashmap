import { List, Map, Set as ImmutableSet } from "immutable";
import { LOCAL, nodeRefKey } from "./core/nodeRef";
import {
  ViewPath,
  addNodeToPathWithNodes,
  addNodesToLastElement,
  getParentView,
  getViewForNode,
  isEmptyViewPathID,
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
  placementTarget,
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

export type TreeResult = {
  rows: List<Row>;
};

type TreeTraversalOptions = {
  isMarkdownExport?: boolean;
  projectedRoot?: GraphNode;
};

const EMPTY_TREE_RESULT: TreeResult = { rows: List<Row>() };
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

function appendNodeToPath(path: ViewPath, nodeID: ID): ViewPath {
  return [path[0], ...path.slice(1), nodeID] as ViewPath;
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

function createRow(
  data: Data,
  graph: GraphLookup,
  viewPath: ViewPath,
  node: GraphNode,
  sourceId: SourceId,
  parentRow: Row | undefined,
  parentNode: GraphNode | undefined,
  parentRef: NodeRef | undefined,
  childIndex: number | undefined,
  isFirstVirtual: boolean,
  virtualType: Row["virtualType"] | undefined
): Row {
  const nodeID = node.id;
  const inheritedVirtualType =
    parentRow?.virtualType === "search" ? parentRow.virtualType : undefined;
  const rowVirtualType =
    virtualType ?? (isSearchId(nodeID) ? "search" : inheritedVirtualType);
  const projected =
    parentRow !== undefined &&
    (parentRow.projected === true ||
      (placementTarget(parentRow.node) !== undefined &&
        !parentRow.node.children.includes(nodeID)));
  const standsFor = (() => {
    const targetID = embeddedTarget(node);
    if (targetID === undefined) {
      return undefined;
    }
    const target = lookupNode(graph, targetID, sourceId)?.node;
    return target ? { id: targetID, liveText: nodeText(target) } : undefined;
  })();
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
    ...(projected && { projected: true }),
    isFirstVirtual,
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

function getNodeIndexForPath(
  parentNode: GraphNode,
  pathID: ID
): number | undefined {
  const index = parentNode.children.findIndex(
    (childID) =>
      childID === pathID ||
      (childID === EMPTY_NODE_ID && isEmptyViewPathID(pathID))
  );
  return index >= 0 ? index : undefined;
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

function resolveRowForPath(
  data: Data,
  graph: GraphLookup,
  viewPath: ViewPath,
  parentRow?: Row,
  options?: TreeTraversalOptions
): Row | undefined {
  const paneSourceId = sourceIdForPath(data, viewPath);
  const [, ...segments] = viewPath;
  if (segments.length === 0) {
    return undefined;
  }
  const pathID = segments[segments.length - 1];
  if (segments.length === 1 && options?.projectedRoot?.id === pathID) {
    const row = createRow(
      data,
      graph,
      viewPath,
      options.projectedRoot,
      graph.localSourceId,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined
    );
    return { ...row, materialize: { precededBy: [], root: true } };
  }
  const parentPath = getParentView(viewPath);
  const resolvedParentRow =
    parentRow ??
    (parentPath
      ? resolveRowForPath(data, graph, parentPath, undefined, options)
      : undefined);
  const childIndex = resolvedParentRow
    ? getNodeIndexForPath(resolvedParentRow.node, pathID)
    : undefined;
  const childID =
    childIndex === undefined
      ? undefined
      : resolvedParentRow?.node.children.get(childIndex);
  const edgeNode = (() => {
    if (!resolvedParentRow || childID === undefined) {
      return undefined;
    }
    if (childID === EMPTY_NODE_ID) {
      return getEmptyNodeItem(data, resolvedParentRow.node);
    }
    return getNodeInSource(graph, {
      sourceId: resolvedParentRow.sourceId,
      id: childID,
    })?.node;
  })();
  const resolved = lookupNode(graph, pathID, paneSourceId);
  const node =
    edgeNode ??
    resolved?.node ??
    (pathID === EMPTY_NODE_ID ? emptyRootNode() : undefined);
  if (!node) {
    return undefined;
  }
  // A path segment that is not a file child of its parent (a projected
  // row) belongs to the source that resolved it, not to the parent.
  const rowSourceId = edgeNode
    ? resolvedParentRow?.sourceId ?? resolved?.ref.sourceId ?? paneSourceId
    : resolved?.ref.sourceId ?? resolvedParentRow?.sourceId ?? paneSourceId;
  return createRow(
    data,
    graph,
    viewPath,
    node,
    rowSourceId,
    resolvedParentRow,
    resolvedParentRow?.node,
    resolvedParentRow?.ref,
    childIndex,
    false,
    undefined
  );
}

function createChildRow(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  parentNode: GraphNode,
  parentRef: NodeRef,
  childID: ID,
  childIndex: number
): Row | undefined {
  const viewPath =
    childID === EMPTY_NODE_ID
      ? addNodeToPathWithNodes(parentRow.viewPath, parentNode, childIndex)
      : appendNodeToPath(parentRow.viewPath, childID);
  if (childID === EMPTY_NODE_ID) {
    const emptyNode = getEmptyNodeItem(data, parentNode);
    return emptyNode
      ? createRow(
          data,
          graph,
          viewPath,
          emptyNode,
          graph.localSourceId,
          parentRow,
          parentNode,
          parentRef,
          childIndex,
          false,
          undefined
        )
      : undefined;
  }
  const child = getNodeInSource(graph, {
    sourceId: parentRef.sourceId,
    id: childID,
  });
  return child
    ? createRow(
        data,
        graph,
        viewPath,
        child.node,
        child.ref.sourceId,
        parentRow,
        parentNode,
        parentRef,
        childIndex,
        false,
        undefined
      )
    : undefined;
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
  const row = createRow(
    data,
    graph,
    viewPath,
    node,
    sourceId,
    input.parentRow,
    input.parentRow?.node,
    parentRef,
    undefined,
    isFirstVirtual,
    "incoming"
  );
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
  const row = createRow(
    data,
    graph,
    viewPath,
    node,
    graph.localSourceId,
    parentRow,
    parentNode,
    { sourceId: parentSourceId, id: parentNode.id },
    undefined,
    false,
    undefined
  );
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
  const row = createRow(
    data,
    graph,
    viewPath,
    node,
    graph.localSourceId,
    parentRow,
    parentNode,
    { sourceId: parentSourceId, id: parentNode.id },
    undefined,
    false,
    undefined
  );
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
              standsFor: {
                id: item.childId as ID,
                liveText: entry ? icalEntryDisplayText(entry) : undefined,
              },
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
  const row = createRow(
    data,
    graph,
    viewPath,
    node,
    parentRow.sourceId,
    parentRow,
    parentRow.parentNode,
    parentRow.parentRef,
    undefined,
    false,
    "incoming"
  );
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

// A touch on a projected row materializes it as ONE placement line in
// the scope-owning placement's file children — never a ladder of
// ancestors (idea.md, Judging). The take snapshots the live text as the
// frozen label; the host is the owning placement row itself.
function withPlacementRecipe(row: Row, parentRow: Row): Row {
  if (row.materialize) {
    return row;
  }
  const owner =
    placementTarget(parentRow.node) !== undefined
      ? {
          node: parentRow.node,
          parentRef: parentRow.parentRef,
          materialize: parentRow.materialize,
        }
      : parentRow.materialize?.host ?? {
          node: parentRow.node,
          parentRef: parentRow.parentRef,
          materialize: parentRow.materialize,
        };
  return {
    ...row,
    materialize: {
      precededBy: [...owner.node.children.toArray()].reverse(),
      take: createRefTarget(row.node.id, nodeText(row.node)),
      host: owner,
    },
  };
}

// A claim binds beyond its own written level only when it says nothing
// about position or evidence: relevance and holds ride the row wherever
// it sits (idea.md, Judging); evidence and anchored claims are
// statements about their written parent and stay there.
function deepBindableClaim(node: GraphNode): boolean {
  return (
    placementTarget(node) !== undefined &&
    node.argument === undefined &&
    node.extraAttrs?.after === undefined &&
    node.extraAttrs?.front !== "true"
  );
}

function subtreeContains(
  graph: GraphLookup,
  sourceId: SourceId,
  node: GraphNode,
  wanted: ID,
  seen: globalThis.Set<ID>
): boolean {
  return node.children.some((childID) => {
    if (seen.has(childID)) {
      return false;
    }
    seen.add(childID);
    if (childID === wanted) {
      return true;
    }
    const child = getNodeInSource(graph, { sourceId, id: childID })?.node;
    return child
      ? subtreeContains(graph, sourceId, child, wanted, seen)
      : false;
  });
}

function readerSubtreeContains(
  graph: GraphLookup,
  sourceId: SourceId,
  node: GraphNode,
  wanted: ID
): boolean {
  return node.children.some((childID) => {
    if (childID === wanted) {
      return true;
    }
    const child = getNodeInSource(graph, { sourceId, id: childID })?.node;
    return child
      ? readerSubtreeContains(graph, sourceId, child, wanted)
      : false;
  });
}

function scopeRootOf(
  graph: GraphLookup,
  sourceId: SourceId,
  node: GraphNode
): GraphNode {
  const parent = node.parent
    ? getNodeInSource(graph, { sourceId, id: node.parent })?.node
    : undefined;
  if (!parent || placementTarget(parent) === undefined) {
    return node;
  }
  return scopeRootOf(graph, sourceId, parent);
}

// The anchor is the place (lab RULES rules 3 and 4, fixtures 114/117/118):
// an anchored line renders immediately after its anchor row wherever that
// row shows inside its own embed, never crossing into a sibling embed;
// only a dead anchor parks the line where written.
function collectFollowerClaims(
  graph: GraphLookup,
  sourceId: SourceId,
  start: GraphNode
): globalThis.Map<ID, GraphNode> {
  const scopeRoot = scopeRootOf(graph, sourceId, start);
  const scopeRootTargetID = placementTarget(scopeRoot);
  const scopeRootTarget =
    scopeRootTargetID !== undefined
      ? lookupNode(graph, scopeRootTargetID, sourceId)?.node
      : undefined;
  const acc = new globalThis.Map<ID, GraphNode>();
  const anchorLives = (after: ID): boolean =>
    (scopeRootTarget !== undefined &&
      subtreeContains(
        graph,
        sourceId,
        scopeRootTarget,
        after,
        new globalThis.Set<ID>([scopeRootTarget.id])
      )) ||
    readerSubtreeContains(graph, sourceId, scopeRoot, after);
  const walk = (node: GraphNode): void => {
    const scopeTargetID = placementTarget(node);
    const scopeTarget =
      scopeTargetID !== undefined
        ? lookupNode(graph, scopeTargetID, sourceId)?.node
        : undefined;
    node.children.toArray().forEach((childID) => {
      const child = getNodeInSource(graph, { sourceId, id: childID })?.node;
      if (!child) {
        return;
      }
      const after = child.extraAttrs?.after;
      if (
        after !== undefined &&
        placementTarget(child) !== undefined &&
        child.argument === undefined
      ) {
        const atLevel =
          scopeTarget?.children.includes(after) === true ||
          node.children.some((sibID) => {
            if (sibID === childID) {
              return false;
            }
            const sib = getNodeInSource(graph, { sourceId, id: sibID })?.node;
            if (!sib) {
              return false;
            }
            const sibTarget = placementTarget(sib);
            if (sib.id !== after && sibTarget !== after) {
              return false;
            }
            return (
              sibTarget === undefined ||
              scopeTarget?.children.includes(sibTarget) === true ||
              sib.extraAttrs?.front === "true" ||
              sib.extraAttrs?.after !== undefined
            );
          });
        if (!atLevel && !acc.has(after) && anchorLives(after)) {
          acc.set(after, child);
        }
      }
      walk(child);
    });
  };
  walk(scopeRoot);
  return acc;
}

function followerRowsAfter(
  data: Data,
  graph: GraphLookup,
  producedRow: Row,
  pool: globalThis.Map<ID, GraphNode>,
  parentPath: ViewPath,
  sourceId: SourceId,
  parentRow: Row,
  parentNode: GraphNode,
  parentRef: NodeRef,
  activeFilters: NonNullable<Pane["typeFilters"]>
): Row[] {
  const stands = placementTarget(producedRow.node);
  const claims = [
    pool.get(producedRow.node.id),
    stands !== undefined ? pool.get(stands) : undefined,
  ].filter(
    (claim, index, all): claim is GraphNode =>
      claim !== undefined &&
      claim.id !== producedRow.node.id &&
      all.indexOf(claim) === index
  );
  return claims.flatMap((claim) => {
    if (claim.relevance === "not_relevant") {
      return [];
    }
    if (!itemPassesFilters(claim, activeFilters)) {
      return [];
    }
    return [
      createRow(
        data,
        graph,
        appendNodeToPath(parentPath, claim.id),
        claim,
        sourceId,
        parentRow,
        parentNode,
        parentRef,
        undefined,
        false,
        undefined
      ),
    ];
  });
}

// One showing, scoped (lab RULES rule 6, fixtures 74/112/113): a claim
// consumes its target's untouched occurrence downward from where it is
// written — collected by climbing the reader file's parent chain — and
// never sideways into a sibling placement's own showing.
function collectChainClaimedTargets(
  graph: GraphLookup,
  sourceId: SourceId,
  nodeID: ID | undefined,
  seen: globalThis.Set<ID>,
  acc: globalThis.Set<ID>
): globalThis.Set<ID> {
  if (nodeID === undefined || seen.has(nodeID)) {
    return acc;
  }
  seen.add(nodeID);
  const node = getNodeInSource(graph, { sourceId, id: nodeID })?.node;
  if (!node) {
    return acc;
  }
  node.children.toArray().forEach((childID) => {
    const child = getNodeInSource(graph, { sourceId, id: childID })?.node;
    if (!child) {
      return;
    }
    const claimTarget = placementTarget(child);
    if (claimTarget !== undefined && child.argument === undefined) {
      acc.add(claimTarget);
    }
  });
  return collectChainClaimedTargets(graph, sourceId, node.parent, seen, acc);
}

// Claims bind through nested placements: a one-line mark written at an
// outer scope still finds its row inside a written parent line. The pool
// climbs the reader file's parent chain; the nearest scope wins.
function collectOuterDeepClaims(
  graph: GraphLookup,
  sourceId: SourceId,
  parentID: ID | undefined,
  seen: globalThis.Set<ID>,
  acc: globalThis.Map<ID, GraphNode>
): globalThis.Map<ID, GraphNode> {
  if (parentID === undefined || seen.has(parentID)) {
    return acc;
  }
  seen.add(parentID);
  const parent = getNodeInSource(graph, { sourceId, id: parentID })?.node;
  if (!parent) {
    return acc;
  }
  // Scope boundary: claims bind inward only from placement ancestors. A
  // line written outside every placement renders where it stands and
  // reaches the projection through consumption alone.
  if (placementTarget(parent) === undefined) {
    return acc;
  }
  parent.children.toArray().forEach((childID) => {
    const child = getNodeInSource(graph, { sourceId, id: childID })?.node;
    if (!child || !deepBindableClaim(child)) {
      return;
    }
    const claimTarget = placementTarget(child);
    if (claimTarget !== undefined && !acc.has(claimTarget)) {
      acc.set(claimTarget, child);
    }
  });
  return collectOuterDeepClaims(graph, sourceId, parent.parent, seen, acc);
}

// Deep binding: an unanchored relevance claim written at the scope-owning
// placement binds its target's occurrence at any depth of the projected
// subtree — the one-line mark finds its row (idea.md, Judging).
function composeDeepClaims(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  baseChildRows: List<Row>,
  typeFilters: Pane["typeFilters"]
): List<Row> | undefined {
  if (parentRow.projected !== true) {
    return undefined;
  }
  const hostID = parentRow.materialize?.host?.node.id;
  const owner = hostID
    ? lookupNode(graph, hostID, parentRow.ref.sourceId)
    : undefined;
  if (!owner) {
    return undefined;
  }
  const activeFilters = typeFilters || DEFAULT_TYPE_FILTERS;
  const parentPath = parentRow.viewPath;
  const fileClaimed = collectChainClaimedTargets(
    graph,
    owner.ref.sourceId,
    owner.node.id,
    new globalThis.Set<ID>(),
    new globalThis.Set<ID>()
  );
  const consumedBy = new globalThis.Map<ID, GraphNode>();
  owner.node.children.toArray().forEach((childID) => {
    const child = getNodeInSource(graph, {
      sourceId: owner.ref.sourceId,
      id: childID,
    })?.node;
    if (!child || !deepBindableClaim(child)) {
      return;
    }
    const claimTarget = placementTarget(child);
    if (claimTarget !== undefined && !consumedBy.has(claimTarget)) {
      consumedBy.set(claimTarget, child);
    }
  });
  collectOuterDeepClaims(
    graph,
    owner.ref.sourceId,
    owner.node.parent,
    new globalThis.Set<ID>([owner.node.id]),
    consumedBy
  );
  const followerPool = collectFollowerClaims(
    graph,
    owner.ref.sourceId,
    owner.node
  );
  if (
    consumedBy.size === 0 &&
    fileClaimed.size === 0 &&
    followerPool.size === 0
  ) {
    return undefined;
  }
  return List(
    baseChildRows.toArray().flatMap((baseRow) => {
      const produced = (() => {
        const placement = consumedBy.get(baseRow.node.id);
        if (!placement) {
          // One showing: a row claimed anywhere else in the note never
          // also renders as an untouched projection.
          return fileClaimed.has(baseRow.node.id) ? [] : [baseRow];
        }
        if (placement.relevance === "not_relevant") {
          return [];
        }
        if (!itemPassesFilters(placement, activeFilters)) {
          return [];
        }
        return [
          createRow(
            data,
            graph,
            appendNodeToPath(parentPath, baseRow.node.id),
            placement,
            owner.ref.sourceId,
            parentRow,
            parentRow.node,
            parentRow.ref,
            undefined,
            false,
            undefined
          ),
        ];
      })();
      return produced.flatMap((producedRow) => [
        producedRow,
        ...followerRowsAfter(
          data,
          graph,
          producedRow,
          followerPool,
          parentPath,
          owner.ref.sourceId,
          parentRow,
          parentRow.node,
          parentRow.ref,
          activeFilters
        ),
      ]);
    })
  );
}

// The embed composition at row level (lab RULES): start from base child
// order, let the placement rows in the embedding file consume their
// occurrences, move anchored placements after their anchors, suppress
// dismissals with their subtree, and append anchorless own rows after the
// base rows in file order. Graph-only walks from the displayed row — no
// pane or document lookups — so it works in every surface. Composition
// terminates when an id repeats on the active expansion path.
function composeEmbedChildren(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  fileChildRows: List<Row>,
  typeFilters: Pane["typeFilters"]
): List<Row> | undefined {
  const targetID = placementTarget(parentRow.node);
  if (targetID === undefined) {
    return undefined;
  }
  const target = lookupNode(graph, targetID, parentRow.ref.sourceId);
  if (!target) {
    return undefined;
  }
  const activeFilters = typeFilters || DEFAULT_TYPE_FILTERS;
  const expansionPath = expansionPathOf(parentRow.viewPath);
  const parentPath = parentRow.viewPath;
  const fileClaimed = collectChainClaimedTargets(
    graph,
    parentRow.ref.sourceId,
    parentRow.node.id,
    new globalThis.Set<ID>(),
    new globalThis.Set<ID>()
  );
  const claimTargetOf = (node: GraphNode): ID | undefined =>
    placementTarget(node);
  const followerPool = collectFollowerClaims(
    graph,
    parentRow.ref.sourceId,
    parentRow.node
  );
  const dismissedClaim = (node: GraphNode): boolean =>
    node.relevance === "not_relevant" && claimTargetOf(node) !== undefined;
  // Consumption reads the file's bytes, not the filtered display rows: a
  // dismissed placement suppresses its occurrence even while hidden.
  const consumedBy = new globalThis.Map<ID, GraphNode>();
  parentRow.node.children.toArray().forEach((childID) => {
    const child = getNodeInSource(graph, {
      sourceId: parentRow.ref.sourceId,
      id: childID,
    })?.node;
    const claimTarget = child ? claimTargetOf(child) : undefined;
    if (child && claimTarget !== undefined && !consumedBy.has(claimTarget)) {
      consumedBy.set(claimTarget, child);
    }
  });
  const outerPool = collectOuterDeepClaims(
    graph,
    parentRow.ref.sourceId,
    parentRow.node.parent,
    new globalThis.Set<ID>([parentRow.node.id]),
    new globalThis.Map<ID, GraphNode>()
  );
  const baseItems = target.node.children
    .filter(
      (childID) => childID !== EMPTY_NODE_ID && !expansionPath.includes(childID)
    )
    .toArray()
    .flatMap((childID) => {
      const produced = (() => {
        const placement = consumedBy.get(childID) ?? outerPool.get(childID);
        if (placement) {
          if (dismissedClaim(placement)) {
            return [];
          }
          if (!itemPassesFilters(placement, activeFilters)) {
            return [];
          }
          // The substituted placement takes over its occurrence's path
          // segment, so open/closed state survives materialization.
          return [
            createRow(
              data,
              graph,
              appendNodeToPath(parentPath, childID),
              placement,
              parentRow.ref.sourceId,
              parentRow,
              target.node,
              target.ref,
              undefined,
              false,
              undefined
            ),
          ];
        }
        if (fileClaimed.has(childID)) {
          return [];
        }
        const child = getNodeInSource(graph, {
          sourceId: target.ref.sourceId,
          id: childID,
        });
        if (!child || !itemPassesFilters(child.node, activeFilters)) {
          return [];
        }
        return [
          withPlacementRecipe(
            createRow(
              data,
              graph,
              appendNodeToPath(parentPath, child.node.id),
              child.node,
              child.ref.sourceId,
              parentRow,
              target.node,
              target.ref,
              undefined,
              false,
              undefined
            ),
            parentRow
          ),
        ];
      })();
      return produced.flatMap((producedRow) => [
        producedRow,
        ...followerRowsAfter(
          data,
          graph,
          producedRow,
          followerPool,
          parentPath,
          parentRow.ref.sourceId,
          parentRow,
          target.node,
          target.ref,
          activeFilters
        ),
      ]);
    });
  const appended = fileChildRows
    .filter((row) => {
      if (dismissedClaim(row.node)) {
        return false;
      }
      const claimTarget = claimTargetOf(row.node);
      if (claimTarget === undefined) {
        return true;
      }
      const rendersAtOccurrence =
        consumedBy.get(claimTarget)?.id === row.node.id &&
        target.node.children.includes(claimTarget);
      if (rendersAtOccurrence) {
        return false;
      }
      // A one-line claim whose row lives deeper renders down at its
      // occurrence, not here at the level it was written.
      const bindsDeeper =
        deepBindableClaim(row.node) &&
        !target.node.children.includes(claimTarget) &&
        subtreeContains(
          graph,
          target.ref.sourceId,
          target.node,
          claimTarget,
          new globalThis.Set<ID>([target.node.id])
        );
      return !bindsDeeper;
    })
    .toArray();
  const inSequence = (sequence: Row[], anchor: ID): number =>
    sequence.findIndex(
      (row) => row.node.id === anchor || claimTargetOf(row.node) === anchor
    );
  const placeAnchored = (initial: Row[]): Row[] =>
    fileChildRows.toArray().reduce((sequence, row) => {
      const after = row.node.extraAttrs?.after;
      const front = row.node.extraAttrs?.front === "true";
      if ((after === undefined && !front) || dismissedClaim(row.node)) {
        return sequence;
      }
      const currentIndex = sequence.findIndex(
        (candidate) => candidate.node.id === row.node.id
      );
      if (currentIndex < 0) {
        return sequence;
      }
      const without = [
        ...sequence.slice(0, currentIndex),
        ...sequence.slice(currentIndex + 1),
      ];
      if (front) {
        return [row, ...without];
      }
      const anchorIndex = after !== undefined ? inSequence(without, after) : -1;
      if (anchorIndex < 0) {
        // A live anchor elsewhere in the embed shows the row down there;
        // only a dead anchor parks it where written (fixtures 118, 120).
        if (
          after !== undefined &&
          followerPool.get(after)?.id === row.node.id
        ) {
          return without;
        }
        return sequence;
      }
      return [
        ...without.slice(0, anchorIndex + 1),
        row,
        ...without.slice(anchorIndex + 1),
      ];
    }, initial);
  // Chained moves ride together (fixture 10): re-place until stable so a
  // claim anchored to a row that itself moved follows it.
  const settle = (sequence: Row[], pass: number): Row[] => {
    const next = placeAnchored(sequence);
    const stable =
      next.length === sequence.length &&
      next.every((row, index) => row === sequence[index]);
    return stable || pass >= fileChildRows.size ? next : settle(next, pass + 1);
  };
  return List(settle([...baseItems, ...appended], 0));
}

function getChildrenForRegularNode(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  rootNode: ID | undefined,
  author: SourceId,
  typeFilters: Pane["typeFilters"],
  options?: TreeTraversalOptions
): TreeResult {
  const activeFilters = typeFilters || DEFAULT_TYPE_FILTERS;
  const directNode: ResolvedNode = { ref: parentRow.ref, node: parentRow.node };
  const nodes = directNode.node;
  const nodeSourceId = directNode.ref.sourceId;

  const allChildNodes = nodes.children
    .map((childID) =>
      childID === EMPTY_NODE_ID
        ? undefined
        : getNodeInSource(graph, {
            sourceId: directNode.ref.sourceId,
            id: childID,
          })?.node
    )
    .filter((node): node is GraphNode => node !== undefined)
    .toList();

  const childRowPairs = nodes.children
    .map((childID, index) => ({
      childID,
      row: createChildRow(
        data,
        graph,
        parentRow,
        nodes,
        directNode.ref,
        childID,
        index
      ),
    }))
    .filter(({ childID, row }) =>
      options?.isMarkdownExport
        ? row !== undefined && childID !== EMPTY_NODE_ID
        : childID === EMPTY_NODE_ID ||
          (row !== undefined && itemPassesFilters(row.node, activeFilters))
    )
    .filter((pair): pair is { childID: ID; row: Row } => pair.row !== undefined)
    .toList();
  const childRows = childRowPairs.map(({ row }) => row);

  if (options?.isMarkdownExport) {
    return { rows: childRows };
  }

  const ownChildRows = parentRow.projected
    ? childRows.map((row) => withPlacementRecipe(row, parentRow))
    : childRows;
  const combinedRows =
    composeEmbedChildren(data, graph, parentRow, ownChildRows, typeFilters) ??
    composeDeepClaims(data, graph, parentRow, ownChildRows, typeFilters) ??
    ownChildRows;

  if (!isFileRow(parentRow)) {
    return { rows: combinedRows };
  }

  const rowsByChildId = Map<ID, Row>(
    childRowPairs.map(({ childID, row }) => [childID, row])
  );
  const { rows: rowsWithProjections, actionRow } = interleaveProjectionRows(
    data,
    graph,
    parentRow,
    nodes,
    nodeSourceId,
    rowsByChildId,
    combinedRows,
    typeFilters
  );

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
  const footerResult = appendVirtualFooterRows(data, graph, {
    parentPath: parentRow.viewPath,
    parentRow,
    parentID: nodes.id,
    parentSourceId: nodeSourceId,
    parentRoot: nodes.root ?? rootNode ?? nodes.id,
    parentUpdated: nodes.updated ?? Date.now(),
    incomingCrefs: visibleIncomingCrefs,
  });

  // The action row leads the footer block: it carries the dotted
  // separator (isFirstVirtual) and the real virtual rows lose it.
  const footerRows = actionRow
    ? List<Row>([{ ...actionRow, isFirstVirtual: true }]).concat(
        footerResult.rows.map((footerRow) => ({
          ...footerRow,
          isFirstVirtual: false,
        }))
      )
    : footerResult.rows;

  return {
    rows: rowsWithProjections.concat(footerRows),
  };
}

function getTreeChildrenForResolvedRow(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  rootNode: ID | undefined,
  author: SourceId,
  typeFilters: Pane["typeFilters"],
  options?: TreeTraversalOptions
): TreeResult {
  if (
    parentRow.virtualType === "incoming" &&
    parentRow.node.children.size > 0
  ) {
    return getIncomingGroupChildren(data, graph, parentRow);
  }

  return getChildrenForRegularNode(
    data,
    graph,
    parentRow,
    rootNode,
    author,
    typeFilters,
    options
  );
}

export function getTreeChildren(
  data: Data,
  parentPath: ViewPath,
  rootNode: ID | undefined,
  author: SourceId,
  typeFilters: Pane["typeFilters"],
  options?: TreeTraversalOptions
): TreeResult {
  const graph = graphLookupFromData(data);
  const parentRow = resolveRowForPath(
    data,
    graph,
    parentPath,
    undefined,
    options
  );
  if (!parentRow) {
    return EMPTY_TREE_RESULT;
  }
  return {
    rows: reindexRows(
      getTreeChildrenForResolvedRow(
        data,
        graph,
        parentRow,
        rootNode,
        author,
        typeFilters,
        options
      ).rows
    ),
  };
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
  rootRows: List<Row>,
  ctx: List<Row>,
  rootNode: ID | undefined,
  author: SourceId,
  typeFilters: Pane["typeFilters"],
  options?: TreeTraversalOptions
): TreeResult {
  return rootRows.reduce<TreeResult>((result, rootRow) => {
    const childResult = getTreeChildrenForResolvedRow(
      data,
      graph,
      rootRow,
      rootNode,
      author,
      typeFilters,
      options
    );
    const row = {
      ...rootRow,
      hasChildren:
        childResult.rows.size > 0 ||
        (isFileRow(rootRow) &&
          hasHiddenPastEntries(data, graph, rootRow.node, rootRow.sourceId)),
    };
    const withRoot = {
      rows: result.rows.push(row),
    };
    const shouldRecurse = options?.isMarkdownExport
      ? true
      : rootRow.view.expanded;
    if (!shouldRecurse) {
      return withRoot;
    }

    return getNodesInRows(
      data,
      graph,
      childResult.rows,
      withRoot.rows,
      rootNode,
      author,
      typeFilters,
      options
    );
  }, emptyTreeResult(ctx));
}

export function getNodesInTree(
  data: Data,
  rootPaths: List<ViewPath>,
  ctx: List<ViewPath>,
  rootNode: ID | undefined,
  author: SourceId,
  typeFilters: Pane["typeFilters"],
  options?: TreeTraversalOptions
): TreeResult {
  const graph = graphLookupFromData(data);
  const rootRows = rootPaths
    .map((rootPath) =>
      resolveRowForPath(data, graph, rootPath, undefined, options)
    )
    .filter((row): row is Row => row !== undefined)
    .toList();
  const contextRows = ctx
    .map((path) => resolveRowForPath(data, graph, path, undefined, options))
    .filter((row): row is Row => row !== undefined)
    .toList();
  return {
    rows: reindexRows(
      getNodesInRows(
        data,
        graph,
        rootRows,
        contextRows,
        rootNode,
        author,
        typeFilters,
        options
      ).rows
    ),
  };
}

export function getNodesInDocument(
  data: Data,
  documentRootPath: ViewPath,
  document: Document,
  typeFilters: Pane["typeFilters"]
): TreeResult {
  const activeFilters = typeFilters || DEFAULT_TYPE_FILTERS;
  const topNodePaths = List(
    document.topNodeShortIds.map((topNodeShortId) =>
      addNodesToLastElement(documentRootPath, topNodeShortId as ID)
    )
  );
  const graph = graphLookupFromData(data);
  const topRows = topNodePaths
    .map((topNodePath) => resolveRowForPath(data, graph, topNodePath))
    .filter((row): row is Row => row !== undefined)
    .toList();
  const topNodes = topRows.map((row) => row.node);
  const treeResult = {
    rows: reindexRows(
      getNodesInRows(
        data,
        graph,
        topRows,
        List<Row>(),
        undefined,
        document.sourceId,
        activeFilters
      ).rows
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
