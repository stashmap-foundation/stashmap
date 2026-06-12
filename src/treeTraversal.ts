import { List, Map, Set as ImmutableSet } from "immutable";
import { LOCAL } from "./core/nodeRef";
import {
  ViewPath,
  addNodeToPathWithNodes,
  addNodesToLastElement,
  getParentView,
  getViewForRowID,
  isEmptyViewPathID,
  viewPathToString,
} from "./rowModel";
import {
  EMPTY_SEMANTIC_ID,
  computeEmptyNodeMetadata,
  getNodeContext,
  getNodeSemanticID,
  getSemanticID,
  isRefNode,
  isSearchId,
  itemPassesFilters,
} from "./core/connections";
import {
  getBlockFileLinkText,
  getBlockLinkTarget,
  getBlockLinkText,
  isBlockLink,
  isBlockLinkAny,
  linkSpan,
  plainSpans,
} from "./core/nodeSpans";
import { getDocumentByIdOrFilePath, type Document } from "./core/Document";
import { DEFAULT_TYPE_FILTERS } from "./core/constants";
import {
  getAlternativeFooterData,
  getIncomingCrefsForNode,
} from "./semanticProjection";
import { buildReferenceItem } from "./buildReferenceRow";
import {
  GraphLookup,
  ResolvedNode,
  getNodeInSource,
  graphLookupFromData,
  lookupNode,
  resolveBlockLinkTarget,
} from "./core/graphLookup";

export type TreeResult = {
  rows: List<Row>;
};

type TreeTraversalOptions = {
  isMarkdownExport?: boolean;
};

const EMPTY_TREE_RESULT: TreeResult = { rows: List<Row>() };

function emptyTreeResult(rows: List<Row> = List<Row>()): TreeResult {
  return { rows };
}

function sourceIdForPath(data: Data, path: ViewPath): SourceId {
  return data.panes[path[0]]?.sourceId ?? LOCAL;
}

type VirtualFooterInput = {
  parentPath: ViewPath;
  parentRow?: Row;
  parentID?: ID;
  parentSourceId: SourceId;
  parentRoot: ID;
  parentUpdated: number;
  incomingCrefs: List<NodeRef>;
  suggestions: List<ID>;
  versionMetas: Map<
    ID,
    {
      updated: number;
      addCount: number;
      removeCount: number;
    }
  >;
};

function nodePathLabel(
  knowledgeDBs: KnowledgeDBs,
  resolved: ResolvedNode | undefined
): string | undefined {
  if (!resolved) {
    return undefined;
  }
  const { sourceId } = resolved.ref;
  return getNodeContext(knowledgeDBs, resolved.node, sourceId)
    .push(getSemanticID(knowledgeDBs, resolved.node, sourceId))
    .join(" / ");
}

function rowIDForNode(node: GraphNode): ID {
  if (node.id === EMPTY_SEMANTIC_ID) {
    return EMPTY_SEMANTIC_ID;
  }
  return isRefNode(node) ? node.id : getNodeSemanticID(node);
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
  virtualType: Row["virtualType"] | undefined,
  versionMeta: Row["versionMeta"] | undefined
): Row {
  const rowID = rowIDForNode(node);
  const inheritedVirtualType =
    parentRow?.virtualType === "search" ||
    parentRow?.virtualType === "suggestion"
      ? parentRow.virtualType
      : undefined;
  const rowVirtualType =
    virtualType ?? (isSearchId(rowID) ? "search" : inheritedVirtualType);
  const pane = data.panes[viewPath[0]];
  const reference = isBlockLinkAny(node)
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
          versionMeta,
          parentNode,
          containing,
          pane.typeFilters
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
    rowID,
    view: getViewForRowID(data, viewPath, rowID),
    parentViewPath: parentRow?.viewPath ?? getParentView(viewPath),
    parentRef,
    parentNode,
    parentChildIndex: parentRow?.childIndex,
    childIndex,
    hasChildren: false,
    isFirstVirtual,
    virtualType: rowVirtualType,
    versionMeta,
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

function getNodeIndexForRowID(
  parentNode: GraphNode,
  rowID: ID
): number | undefined {
  const index = parentNode.children.findIndex(
    (childID) =>
      childID === rowID ||
      (childID === EMPTY_SEMANTIC_ID && isEmptyViewPathID(rowID))
  );
  return index >= 0 ? index : undefined;
}

function emptyRootNode(): GraphNode {
  return {
    children: List<ID>(),
    id: EMPTY_SEMANTIC_ID,
    spans: plainSpans(""),
    updated: Date.now(),
    root: EMPTY_SEMANTIC_ID,
    relevance: undefined,
  };
}

function resolveRowForPath(
  data: Data,
  graph: GraphLookup,
  viewPath: ViewPath,
  parentRow: Row | undefined = undefined
): Row | undefined {
  const paneSourceId = sourceIdForPath(data, viewPath);
  const [, ...segments] = viewPath;
  if (segments.length === 0) {
    return undefined;
  }
  const rowID = segments[segments.length - 1];
  const parentPath = getParentView(viewPath);
  const resolvedParentRow =
    parentRow ??
    (parentPath ? resolveRowForPath(data, graph, parentPath) : undefined);
  const childIndex = resolvedParentRow
    ? getNodeIndexForRowID(resolvedParentRow.node, rowID)
    : undefined;
  const childID =
    childIndex === undefined
      ? undefined
      : resolvedParentRow?.node.children.get(childIndex);
  const edgeNode = (() => {
    if (!resolvedParentRow || childID === undefined) {
      return undefined;
    }
    if (childID === EMPTY_SEMANTIC_ID) {
      return getEmptyNodeItem(data, resolvedParentRow.node);
    }
    return getNodeInSource(graph, {
      sourceId: resolvedParentRow.sourceId,
      id: childID,
    })?.node;
  })();
  const resolved = lookupNode(graph, rowID, paneSourceId);
  const node =
    edgeNode ??
    resolved?.node ??
    (rowID === EMPTY_SEMANTIC_ID ? emptyRootNode() : undefined);
  if (!node) {
    return undefined;
  }
  return createRow(
    data,
    graph,
    viewPath,
    node,
    resolvedParentRow?.sourceId ?? resolved?.ref.sourceId ?? paneSourceId,
    resolvedParentRow,
    resolvedParentRow?.node,
    resolvedParentRow?.ref,
    childIndex,
    false,
    undefined,
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
  const viewPath = addNodeToPathWithNodes(
    parentRow.viewPath,
    parentNode,
    childIndex
  );
  if (childID === EMPTY_SEMANTIC_ID) {
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
          undefined,
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
        undefined,
        undefined
      )
    : undefined;
}

function createVirtualRowNode(
  data: Data,
  graph: GraphLookup,
  input: VirtualFooterInput,
  rowRef: NodeRef,
  virtualType: Row["virtualType"]
): { node: GraphNode; sourceId: SourceId } {
  const rowID = rowRef.id;
  const sourceRow =
    virtualType === "suggestion"
      ? lookupNode(graph, rowID, graph.localSourceId)
      : undefined;
  const incomingRow =
    virtualType === "incoming" ? getNodeInSource(graph, rowRef) : undefined;
  const versionRow =
    virtualType === "version"
      ? lookupNode(graph, rowID, graph.localSourceId)
      : undefined;
  const sourceRowNode = sourceRow?.node;
  const incomingRowNode = incomingRow?.node;
  const suggestionTargetID = getBlockLinkTarget(sourceRowNode);
  const targetID =
    virtualType === "incoming" || virtualType === "version"
      ? (rowID as ID)
      : suggestionTargetID;
  const resolvedSource = sourceRow ?? incomingRow ?? versionRow;
  const sourceNode = resolvedSource?.node;
  return {
    node: {
      children: targetID ? List<ID>() : sourceNode?.children ?? List<ID>(),
      id: (targetID || sourceNode?.id || rowID) as ID,
      spans: targetID
        ? [
            linkSpan(
              targetID,
              getBlockLinkText(sourceRowNode) ??
                getBlockFileLinkText(incomingRowNode) ??
                nodePathLabel(data.knowledgeDBs, incomingRow) ??
                nodePathLabel(data.knowledgeDBs, versionRow) ??
                ""
            ),
          ]
        : sourceNode?.spans ?? plainSpans(""),
      parent: input.parentID,
      updated: sourceNode?.updated ?? input.parentUpdated,
      root: sourceNode?.root ?? input.parentRoot,
      relevance: sourceNode?.relevance,
      argument: sourceNode?.argument,
    },
    sourceId: resolvedSource?.ref.sourceId ?? input.parentSourceId,
  };
}

function appendNodeToPath(path: ViewPath, nodeID: ID): ViewPath {
  return [path[0], ...path.slice(1), nodeID] as ViewPath;
}

function createVirtualRow(
  data: Data,
  graph: GraphLookup,
  input: VirtualFooterInput,
  rowRef: NodeRef,
  virtualType: Row["virtualType"],
  isFirstVirtual: boolean
): Row {
  const rowID = rowRef.id;
  const { node, sourceId } = createVirtualRowNode(
    data,
    graph,
    input,
    rowRef,
    virtualType
  );
  const parentPath =
    input.parentID === undefined
      ? input.parentPath
      : addNodesToLastElement(input.parentPath, input.parentID);
  const viewPath =
    input.parentID === undefined
      ? addNodesToLastElement(parentPath, node.id)
      : appendNodeToPath(parentPath, node.id);
  const parentRef = input.parentID
    ? { sourceId: input.parentSourceId, id: input.parentID }
    : undefined;
  const versionMeta =
    virtualType === "version" ? input.versionMetas.get(rowID as ID) : undefined;
  return createRow(
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
    virtualType,
    versionMeta
  );
}

function appendVirtualFooterRows(
  data: Data,
  graph: GraphLookup,
  input: VirtualFooterInput,
  initial: TreeResult = emptyTreeResult()
): TreeResult {
  const incomingRows = input.incomingCrefs.map((rowRef, index) =>
    createVirtualRow(data, graph, input, rowRef, "incoming", index === 0)
  );
  const suggestionOffset = incomingRows.size;
  const suggestionRows = input.suggestions.map((rowID, index) =>
    createVirtualRow(
      data,
      graph,
      input,
      { sourceId: graph.localSourceId, id: rowID },
      "suggestion",
      suggestionOffset + index === 0
    )
  );
  const versionOffset = incomingRows.size + suggestionRows.size;
  const versionRows = input.versionMetas
    .keySeq()
    .toList()
    .map((rowID, index) =>
      createVirtualRow(
        data,
        graph,
        input,
        { sourceId: graph.localSourceId, id: rowID },
        "version",
        versionOffset + index === 0
      )
    );

  return {
    rows: initial.rows
      .concat(incomingRows)
      .concat(suggestionRows)
      .concat(versionRows),
  };
}

function getChildrenForConcreteRef(
  data: Data,
  graph: GraphLookup,
  parentRow: Row
): TreeResult {
  const source = isBlockLink(parentRow.node)
    ? resolveBlockLinkTarget(graph, {
        ref: parentRow.ref,
        node: parentRow.node,
      })
    : getNodeInSource(graph, parentRow.ref);
  if (!source || source.node.children.size === 0) {
    return EMPTY_TREE_RESULT;
  }
  return {
    rows: source.node.children
      .map((childID, index) =>
        createChildRow(
          data,
          graph,
          parentRow,
          source.node,
          source.ref,
          childID,
          index
        )
      )
      .filter((row): row is Row => row !== undefined)
      .toList(),
  };
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
      childID === EMPTY_SEMANTIC_ID
        ? undefined
        : getNodeInSource(graph, {
            sourceId: directNode.ref.sourceId,
            id: childID,
          })?.node
    )
    .filter((node): node is GraphNode => node !== undefined)
    .toList();

  const childRows = nodes.children
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
        ? row !== undefined && childID !== EMPTY_SEMANTIC_ID
        : childID === EMPTY_SEMANTIC_ID ||
          (row !== undefined && itemPassesFilters(row.node, activeFilters))
    )
    .map(({ row }) => row)
    .filter((row): row is Row => row !== undefined)
    .toList();

  if (options?.isMarkdownExport) {
    return { rows: childRows };
  }

  const containingNodeID = parentRow.parentNode?.id;
  const visibleAuthors = ImmutableSet<SourceId>([LOCAL, author, nodeSourceId]);

  const incomingCrefs = getIncomingCrefsForNode(
    graph,
    visibleAuthors,
    containingNodeID,
    nodes.id,
    author,
    nodeSourceId,
    allChildNodes,
    undefined,
    data.documents
  );

  const visibleIncomingCrefs = activeFilters.includes("incoming")
    ? incomingCrefs
    : List<NodeRef>();

  const isOwnContent = nodeSourceId === LOCAL;
  const { suggestions: diffItems, versionMetas } = getAlternativeFooterData(
    graph,
    visibleAuthors,
    activeFilters,
    directNode,
    isOwnContent,
    data.snapshotNodes
  );

  const footerResult = appendVirtualFooterRows(data, graph, {
    parentPath: parentRow.viewPath,
    parentRow,
    parentID: nodes.id,
    parentSourceId: nodeSourceId,
    parentRoot: nodes.root ?? rootNode ?? nodes.id,
    parentUpdated: nodes.updated ?? Date.now(),
    incomingCrefs: visibleIncomingCrefs,
    suggestions: diffItems,
    versionMetas,
  });

  return {
    rows: childRows.concat(footerResult.rows),
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
  if (parentRow.parentNode && isBlockLink(parentRow.node)) {
    return getChildrenForConcreteRef(data, graph, parentRow);
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
  const parentRow = resolveRowForPath(data, graph, parentPath);
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
    const row = { ...rootRow, hasChildren: childResult.rows.size > 0 };
    const withRoot = {
      rows: result.rows.push(row),
    };
    const shouldRecurse = options?.isMarkdownExport
      ? !isBlockLink(rootRow.node)
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
    .map((rootPath) => resolveRowForPath(data, graph, rootPath))
    .filter((row): row is Row => row !== undefined)
    .toList();
  const contextRows = ctx
    .map((path) => resolveRowForPath(data, graph, path))
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

  const visibleAuthors = ImmutableSet<SourceId>([LOCAL, document.sourceId]);
  const incomingCrefs = getIncomingCrefsForNode(
    graph,
    visibleAuthors,
    undefined,
    undefined,
    document.sourceId,
    document.sourceId,
    topNodes,
    document.filePath,
    data.documents
  );

  const withFooter = appendVirtualFooterRows(
    data,
    graph,
    {
      parentPath: documentRootPath,
      parentSourceId: document.sourceId,
      parentRoot: topNodes.first()?.root ?? EMPTY_SEMANTIC_ID,
      parentUpdated: document.updatedMs,
      incomingCrefs,
      suggestions: List<ID>(),
      versionMetas: Map<
        ID,
        { updated: number; addCount: number; removeCount: number }
      >(),
    },
    treeResult
  );
  return { rows: reindexRows(withFooter.rows) };
}
