import { List, Map, Set as ImmutableSet } from "immutable";
import { LOCAL, nodeRefKey } from "./core/nodeRef";
import {
  ViewPath,
  addNodeToPathWithNodes,
  addNodesToLastElement,
  getLast,
  getParentView,
  getViewForNode,
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
import { linkSpan, nodeText, plainSpans } from "./core/nodeSpans";
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
  resolveAuthoredFirst,
} from "./core/graphLookup";
import {
  Showing,
  closesCycle,
  embedTargetOf,
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

type RowPlacement = {
  viewPath: ViewPath;
  node: GraphNode;
  sourceId: SourceId;
  projected: boolean;
  parentRow?: Row;
  parentNode?: GraphNode;
  parentRef?: NodeRef;
  childIndex?: number;
};

function baseRow(
  data: Data,
  input: RowPlacement,
  virtualType: Row["virtualType"]
): Row {
  const {
    viewPath,
    node,
    sourceId,
    projected,
    parentRow,
    parentNode,
    parentRef,
  } = input;
  return {
    viewPath,
    viewKey: viewPathToString(viewPath),
    index: 0,
    depth: viewPath.length - 1,
    node,
    sourceId,
    ref: { sourceId, id: node.id },
    view: getViewForNode(data, viewPath, node.id),
    parentViewPath: parentRow?.viewPath ?? getParentView(viewPath),
    parentRef,
    parentNode,
    parentChildIndex: parentRow?.childIndex,
    childIndex: input.childIndex,
    hasChildren: false,
    ...(projected && { projected: true }),
    isFirstVirtual: false,
    virtualType,
    provenance: undefined,
    reference: undefined,
  };
}

function searchVirtualType(input: RowPlacement): Row["virtualType"] {
  return isSearchId(input.node.id) || input.parentRow?.virtualType === "search"
    ? "search"
    : undefined;
}

function createShowingRow(
  data: Data,
  input: RowPlacement,
  showing: Showing
): Row {
  const row = baseRow(data, input, searchVirtualType(input));
  const standsFor = standsForOf(showing);
  return {
    ...row,
    ...(standsFor && { standsFor }),
    presentedSpans: presentedLineOf(showing).node.spans,
    ...(closesCycle(showing) && { cycle: true }),
    ...(leavesDangling(showing) && { dangling: true }),
    ...(presentedLineOf(showing).demoted && { demoted: true }),
    ...(showing.lapsed && { lapsed: true }),
  };
}

function createEmptyRow(data: Data, input: RowPlacement): Row {
  return baseRow(data, input, searchVirtualType(input));
}

function createIncomingRow(
  data: Data,
  graph: GraphLookup,
  input: RowPlacement,
  isFirstVirtual: boolean
): Row {
  const { viewPath, node, sourceId, parentRef } = input;
  const pane = data.panes[viewPath[0]];
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
      ? getNodeInSource(graph, { sourceId: document.sourceId, id: topNodeID })
      : undefined;
  const containing = parentRef
    ? resolveAuthoredFirst(graph, parentRef.id, parentRef.sourceId) ??
      documentRoot
    : documentRoot;
  return {
    ...baseRow(data, input, "incoming"),
    isFirstVirtual,
    provenance: { kind: "incoming", sourceId },
    reference: buildReferenceItem(
      graph,
      node.id,
      data,
      sourceId,
      "incoming",
      containing
    ),
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
    parentNode.id
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
      origin: "authored",
    };
  }
  const resolved = resolveAuthoredFirst(graph, rootID, paneSourceId);
  if (resolved) {
    return resolved;
  }
  return rootID === EMPTY_NODE_ID
    ? {
        node: emptyRootNode(),
        ref: { sourceId: paneSourceId, id: rootID },
        origin: "authored",
      }
    : undefined;
}

function rootRowForShowing(
  data: Data,
  resolved: ResolvedNode,
  showing: Showing,
  rootPath: ViewPath,
  options?: TreeTraversalOptions
): Row {
  const row = createShowingRow(
    data,
    {
      viewPath: rootPath,
      node: showing.node,
      sourceId: showing.ref.sourceId,
      projected: resolved.origin === "computed",
    },
    showing
  );
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
  const viewNodeID = `incoming:${sourceId}:${sourceNodeID}`;
  const viewPath =
    input.parentID === undefined
      ? addNodesToLastElement(parentPath, viewNodeID)
      : appendNodeToPath(parentPath, viewNodeID);
  const parentRef = input.parentID
    ? { sourceId: input.parentSourceId, id: input.parentID }
    : undefined;
  const row = createIncomingRow(
    data,
    graph,
    {
      viewPath,
      node,
      sourceId,
      projected:
        input.parentRow !== undefined &&
        (input.parentRow.projected === true ||
          embedTargetOf(input.parentRow.node) !== undefined),
      parentRow: input.parentRow,
      parentNode: input.parentRow?.node,
      parentRef,
    },
    isFirstVirtual
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
      precededBy: [...priorAnchors, ...[...parentChildren].reverse()],
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
    `incoming:${parentRow.sourceId}:${childID}`
  );
  const row = createIncomingRow(
    data,
    graph,
    {
      viewPath,
      node,
      sourceId: parentRow.sourceId,
      projected: parentRow.projected === true,
      parentRow,
      parentNode: parentRow.parentNode,
      parentRef: parentRow.parentRef,
    },
    false
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

function projectedRow(
  data: Data,
  parentRow: Row,
  source: Showing,
  line: Showing
): Row {
  const parentPath = addNodesToLastElement(
    parentRow.viewPath,
    parentRow.node.id
  );
  return createShowingRow(
    data,
    {
      viewPath: appendNodeToPath(parentPath, line.node.id),
      node: line.node,
      sourceId: line.ref.sourceId,
      projected: true,
      parentRow,
      parentNode: source.node,
      parentRef: source.ref,
    },
    line
  );
}

function movedRow(
  data: Data,
  parentRow: Row,
  owner: { node: GraphNode; ref: NodeRef },
  line: Showing
): Row {
  const parentPath = addNodesToLastElement(
    parentRow.viewPath,
    parentRow.node.id
  );
  return createShowingRow(
    data,
    {
      viewPath: appendNodeToPath(parentPath, line.node.id),
      node: line.node,
      sourceId: line.ref.sourceId,
      projected: line.inProjection,
      parentRow,
      parentNode: owner.node,
      parentRef: owner.ref,
    },
    line
  );
}

function inHomePlace(ownerNode: GraphNode, line: Showing): boolean {
  return (
    line.reached.kind === "line" &&
    ownerNode.children.get(line.reached.childIndex) === line.node.id
  );
}

function fileRow(
  data: Data,
  parentRow: Row,
  line: Showing,
  childIndex: number
): Row {
  return createShowingRow(
    data,
    {
      viewPath: addNodeToPathWithNodes(
        parentRow.viewPath,
        parentRow.node,
        childIndex
      ),
      node: line.node,
      sourceId: line.ref.sourceId,
      projected: parentRow.projected === true,
      parentRow,
      parentNode: parentRow.node,
      parentRef: parentRow.ref,
      childIndex,
    },
    line
  );
}

function emptyChildRow(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  childIndex: number
): Row | undefined {
  const emptyNode = getEmptyNodeItem(data, parentRow.node);
  return emptyNode
    ? createEmptyRow(data, {
        viewPath: addNodeToPathWithNodes(
          parentRow.viewPath,
          parentRow.node,
          childIndex
        ),
        node: emptyNode,
        sourceId: graph.localSourceId,
        projected: parentRow.projected === true,
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
): List<{ row: Row; showing: Showing | undefined }> {
  const shown = linesShownThrough(
    parentShowing ? parentShowing.target : undefined
  ).flatMap(({ source, line }) =>
    itemPassesFilters(line.node, activeFilters)
      ? [
          {
            row: inHomePlace(source.node, line)
              ? projectedRow(data, parentRow, source, line)
              : movedRow(data, parentRow, source, line),
            showing: line,
          },
        ]
      : []
  );
  const lineEntries = (parentShowing ? parentShowing.children : []).flatMap(
    (line) =>
      line.reached.kind === "line"
        ? [{ childIndex: line.reached.childIndex, line }]
        : []
  );
  const emptyRows = (
    childIndexes: number[]
  ): { row: Row; showing: Showing | undefined }[] =>
    childIndexes.flatMap(
      (childIndex): { row: Row; showing: Showing | undefined }[] => {
        const row = emptyChildRow(data, graph, parentRow, childIndex);
        return row ? [{ row, showing: undefined }] : [];
      }
    );
  const merged = lineEntries.reduce<{
    entries: { row: Row; showing: Showing | undefined }[];
    empties: number[];
  }>(
    (acc, { childIndex, line }) => {
      const inPlace = inHomePlace(parentRow.node, line);
      const flushed = inPlace
        ? acc.empties.filter((index) => index < childIndex)
        : [];
      const kept = inPlace
        ? acc.empties.filter((index) => index >= childIndex)
        : acc.empties;
      const lineRows = itemPassesFilters(line.node, activeFilters)
        ? [
            {
              row: inPlace
                ? fileRow(data, parentRow, line, childIndex)
                : movedRow(
                    data,
                    parentRow,
                    { node: parentRow.node, ref: parentRow.ref },
                    line
                  ),
              showing: line,
            },
          ]
        : [];
      return {
        entries: [...acc.entries, ...emptyRows(flushed), ...lineRows],
        empties: kept,
      };
    },
    { entries: [], empties: emptyChildIndexes(parentRow) }
  );
  return List([...shown, ...merged.entries, ...emptyRows(merged.empties)]);
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
): List<{ row: Row; showing: Showing | undefined }> {
  if (
    parentRow.virtualType === "incoming" &&
    parentRow.node.children.size > 0
  ) {
    return getIncomingGroupChildren(data, graph, parentRow).rows.map((row) => ({
      row,
      showing: undefined,
    }));
  }
  const activeFilters = typeFilters || DEFAULT_TYPE_FILTERS;
  const converted = convertShowingChildren(
    data,
    graph,
    parentRow,
    parentShowing,
    activeFilters
  );

  if (parentRow.virtualType !== undefined) {
    return converted;
  }

  const footer = footerRowsForFileRow(
    data,
    graph,
    parentRow,
    fileChildNodes(parentShowing),
    rootNode,
    author,
    activeFilters
  );

  return converted.concat(footer.map((row) => ({ row, showing: undefined })));
}

function getNodesInRows(
  data: Data,
  graph: GraphLookup,
  pairs: List<{ row: Row; showing: Showing | undefined }>,
  acc: List<Row>,
  rootNode: ID | undefined,
  author: SourceId,
  typeFilters: Pane["typeFilters"],
  expandAll: boolean
): List<Row> {
  return pairs.reduce((result, { row, showing }) => {
    const children = childRowsForRow(
      data,
      graph,
      row,
      showing,
      rootNode,
      author,
      typeFilters
    );
    const withHasChildren = {
      ...row,
      hasChildren: children.size > 0,
    };
    const pushed = result.push(withHasChildren);
    if (!expandAll && !withHasChildren.view.expanded) {
      return pushed;
    }
    return getNodesInRows(
      data,
      graph,
      children,
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
): List<{ row: Row; showing: Showing | undefined }> {
  return List(
    rootPaths.toArray().flatMap((rootPath) => {
      const resolved = resolveRootNode(data, graph, rootPath, options);
      if (!resolved) {
        return [];
      }
      const showing = showingTreeForRoot(graph, resolved);
      return [
        {
          row: rootRowForShowing(data, resolved, showing, rootPath, options),
          showing,
        },
      ];
    })
  );
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
        roots,
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
      addNodesToLastElement(documentRootPath, topNodeShortId)
    )
  );
  const graph = graphLookupFromData(data);
  const tops = rootRowsForPaths(data, graph, topNodePaths);
  const topRows = tops.map(({ row }) => row);
  const topNodes = topRows.map((row) => row.node);
  const treeResult = {
    rows: reindexRows(
      getNodesInRows(
        data,
        graph,
        tops,
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
