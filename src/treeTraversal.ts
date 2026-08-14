import { List, Map, Set as ImmutableSet } from "immutable";
import { LOCAL, nodeRefKey } from "./core/nodeRef";
import {
  ViewPath,
  addNodeToPathWithNodes,
  addNodesToLastElement,
  getParentView,
  isEmptyViewPathID,
  isFileRow,
  rowChildIndex,
  rowID,
  rowNode,
  rowRef as refForRow,
  rowSourceId,
  rowSpans,
  viewKeyForIdentity,
  viewPathToString,
} from "./rowModel";
import {
  EMPTY_NODE_ID,
  computeEmptyNodeMetadata,
  createRefTarget,
  isEmptyNodeID,
  isSearchId,
  itemPassesFilters,
  nodePathLabel as nodePathLabelOf,
} from "./core/connections";
import { linkSpan, nodeText, plainSpans } from "./core/nodeSpans";
import {
  calendarFeedTargetUrl,
  hiddenPastEntryCount,
  isPastCalendarRowText,
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
  ComposedRow,
  CompositionResult,
  composeNote,
  createWriteRootRow,
  composedLine,
} from "./core/composition";

export type TreeResult = {
  rows: List<Row>;
};

type TreeTraversalOptions = {
  projectedRoot?: GraphNode;
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

function appendNodeToPath(
  [paneIndex, ...segments]: ViewPath,
  nodeID: ID
): ViewPath {
  return [paneIndex, ...segments, nodeID];
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
): {
  viewPath: ViewPath;
  viewKey: string;
  index: number;
  depth: number;
  node: GraphNode;
  sourceId: SourceId;
  ref: NodeRef;
  view: View;
  parentViewPath: ViewPath | undefined;
  parentRef: NodeRef | undefined;
  parentNode: GraphNode | undefined;
  parentChildIndex: number | undefined;
  childIndex: number | undefined;
  hasChildren: boolean;
  isFirstVirtual: boolean;
  virtualType: Row["virtualType"];
  reference: Row["reference"];
} {
  const nodeID = node.id;
  const inheritedVirtualType =
    parentRow?.virtualType === "search" ? parentRow.virtualType : undefined;
  const rowVirtualType =
    virtualType ?? (isSearchId(nodeID) ? "search" : inheritedVirtualType);
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
  const viewKey = viewPathToString(viewPath);
  return {
    viewPath,
    viewKey,
    index: 0,
    depth: viewPath.length - 1,
    node,
    sourceId,
    ref: { sourceId, id: node.id },
    view: data.views.get(viewKey) ?? {
      expanded: viewPath.length === 2 || isSearchId(nodeID),
    },
    parentViewPath: parentRow?.viewPath ?? getParentView(viewPath),
    parentRef,
    parentNode,
    parentChildIndex: parentRow ? rowChildIndex(parentRow) : undefined,
    childIndex,
    hasChildren: false,
    isFirstVirtual,
    virtualType: rowVirtualType,
    reference,
  };
}

function locateComposedRow(root: ComposedRow, id: ID): ComposedRow | undefined {
  if (root.id === id) {
    return root;
  }
  return root.children.reduce<ComposedRow | undefined>(
    (found, child) => found ?? locateComposedRow(child, id),
    undefined
  );
}

function occurrenceAt(
  graph: GraphLookup,
  segment: ID,
  sourceId: SourceId
): [CompositionResult, ComposedRow] | undefined {
  if (isSearchId(segment) || isEmptyViewPathID(segment)) {
    return undefined;
  }
  const resolved = lookupNode(graph, segment, sourceId);
  if (!resolved) {
    return undefined;
  }
  const root = getNodeInSource(graph, {
    sourceId: resolved.ref.sourceId,
    id: resolved.node.root,
  });
  if (root) {
    const composition = composeNote(graph, root.ref);
    const rooted = locateComposedRow(composition.root, segment);
    if (rooted) {
      return [composition, rooted];
    }
  }
  const composition = composeNote(graph, resolved.ref);
  return [composition, composition.root];
}

function occurrenceViewKey(
  viewPath: ViewPath,
  occurrence: ComposedRow
): string {
  return viewKeyForIdentity(
    viewPath[0],
    viewPath[1] ?? occurrence.id,
    occurrence.identity
  );
}

function occurrenceRow(
  data: Data,
  viewPath: ViewPath,
  parentRow: Row | undefined,
  composition: CompositionResult,
  occurrence: ComposedRow
): Row {
  const viewKey = occurrenceViewKey(viewPath, occurrence);
  return {
    viewPath,
    viewKey,
    index: 0,
    depth: viewPath.length - 1,
    view: data.views.get(viewKey) ?? {
      expanded: viewPath.length === 2,
    },
    parentViewPath: parentRow?.viewPath ?? getParentView(viewPath),
    hasChildren: false,
    isFirstVirtual: false,
    reference: undefined,
    rowType: "occurrence",
    occurrence,
    composition,
    incomingTarget: undefined,
    incomingParent: undefined,
    incomingEmbed: undefined,
    emptyParent: undefined,
    virtualType: undefined,
    action: undefined,
  };
}

function attachEmpty(
  row: ReturnType<typeof createRow>,
  parent: ComposedRow | undefined,
  composition: CompositionResult | undefined
): Row {
  return {
    ...row,
    rowType: "empty",
    occurrence: undefined,
    composition,
    incomingTarget: undefined,
    incomingParent: undefined,
    incomingEmbed: undefined,
    emptyParent: parent,
    virtualType: undefined,
    action: undefined,
  };
}

function attachSearch(row: ReturnType<typeof createRow>): Row {
  return {
    ...row,
    rowType: "search",
    occurrence: undefined,
    composition: undefined,
    incomingTarget: undefined,
    incomingParent: undefined,
    incomingEmbed: undefined,
    emptyParent: undefined,
    virtualType: "search",
    action: undefined,
  };
}

function rowFromComposedRow(
  data: Data,
  parentRow: Extract<Row, { rowType: "occurrence" }>,
  occurrence: ComposedRow
): Row {
  return occurrenceRow(
    data,
    appendNodeToPath(parentRow.viewPath, occurrence.id),
    parentRow,
    parentRow.composition,
    occurrence
  );
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

function resolveRowStep(
  data: Data,
  graph: GraphLookup,
  viewPath: ViewPath,
  parentRow: Row | undefined,
  options?: TreeTraversalOptions
): Row | undefined {
  const paneSourceId = sourceIdForPath(data, viewPath);
  const segments = expansionPathOf(viewPath);
  const pathID = segments[segments.length - 1];
  const found: [CompositionResult, ComposedRow] | undefined =
    parentRow?.rowType === "occurrence"
      ? (() => {
          const child = parentRow.occurrence.children.find(
            (candidate) => candidate.id === pathID
          );
          return child ? [parentRow.composition, child] : undefined;
        })()
      : occurrenceAt(graph, pathID, paneSourceId);
  const composition = found?.[0];
  const occurrence = found?.[1];
  if (occurrence && parentRow?.rowType === "occurrence") {
    return rowFromComposedRow(data, parentRow, occurrence);
  }
  if (occurrence && composition) {
    return occurrenceRow(data, viewPath, undefined, composition, occurrence);
  }
  if (segments.length === 1 && options?.projectedRoot?.id === pathID) {
    const rootNode: GraphNode = {
      ...options.projectedRoot,
      parent: undefined,
      root: options.projectedRoot.id,
    };
    const rootComposedRow = createWriteRootRow(rootNode, graph.localSourceId);
    const rootComposition: CompositionResult = {
      root: rootComposedRow,
      claims: [],
      diagnostics: [],
    };
    return occurrenceRow(
      data,
      viewPath,
      undefined,
      rootComposition,
      rootComposedRow
    );
  }
  if (
    pathID !== EMPTY_NODE_ID &&
    !isEmptyViewPathID(pathID) &&
    !isSearchId(pathID) &&
    parentRow?.rowType !== "search"
  ) {
    return undefined;
  }
  const childIndex = parentRow
    ? getNodeIndexForPath(rowNode(parentRow), pathID)
    : undefined;
  const childID =
    childIndex === undefined || parentRow === undefined
      ? undefined
      : rowNode(parentRow).children.get(childIndex);
  const edgeNode = (() => {
    if (!parentRow || childID === undefined) {
      return undefined;
    }
    if (childID === EMPTY_NODE_ID) {
      return getEmptyNodeItem(data, rowNode(parentRow));
    }
    return getNodeInSource(graph, {
      sourceId: rowSourceId(parentRow),
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
  const resolvedSourceId = (() => {
    if (edgeNode && parentRow) {
      return rowSourceId(parentRow);
    }
    if (edgeNode) {
      return resolved?.ref.sourceId ?? paneSourceId;
    }
    return (
      resolved?.ref.sourceId ??
      (parentRow === undefined ? paneSourceId : rowSourceId(parentRow))
    );
  })();
  const row = createRow(
    data,
    graph,
    viewPath,
    node,
    resolvedSourceId,
    parentRow,
    parentRow === undefined ? undefined : rowNode(parentRow),
    parentRow === undefined ? undefined : refForRow(parentRow),
    childIndex,
    false,
    undefined
  );
  return isEmptyNodeID(node.id)
    ? attachEmpty(
        row,
        parentRow?.rowType === "occurrence" ? parentRow.occurrence : undefined,
        parentRow?.composition
      )
    : attachSearch(row);
}

function resolveRowForPath(
  data: Data,
  graph: GraphLookup,
  viewPath: ViewPath,
  parentRow?: Row,
  options?: TreeTraversalOptions
): Row | undefined {
  const segments = expansionPathOf(viewPath);
  if (segments.length === 0) {
    return undefined;
  }
  if (parentRow) {
    return resolveRowStep(data, graph, viewPath, parentRow, options);
  }
  return segments.reduce<Row | undefined>((row, _, index) => {
    const prefix: ViewPath = [viewPath[0], ...segments.slice(0, index + 1)];
    return resolveRowStep(data, graph, prefix, row, options);
  }, undefined);
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
  if (childID === EMPTY_NODE_ID) {
    const emptyNode = getEmptyNodeItem(data, parentNode);
    return emptyNode
      ? attachEmpty(
          createRow(
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
          ),
          parentRow.rowType === "occurrence" ? parentRow.occurrence : undefined,
          parentRow.composition
        )
      : undefined;
  }
  const child = getNodeInSource(graph, {
    sourceId: parentRef.sourceId,
    id: childID,
  });
  return child
    ? attachSearch(
        createRow(
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

function withIncomingGroupChildren(
  row: Extract<Row, { rowType: "incoming" }>,
  refs: NodeRef[]
): Row {
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
  isFirstVirtual: boolean
): Extract<Row, { rowType: "incoming" }> {
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
    input.parentRow ? rowNode(input.parentRow) : undefined,
    parentRef,
    undefined,
    isFirstVirtual,
    "incoming"
  );
  const inherited = getNodeInSource(graph, {
    sourceId,
    id: sourceNodeID,
  })?.node;
  const resolvedParent = input.parentID
    ? occurrenceAt(graph, input.parentID, input.parentSourceId)
    : undefined;
  const fallbackRoot =
    input.parentID === undefined
      ? undefined
      : createWriteRootRow(
          {
            children: List<ID>(),
            id: input.parentID,
            spans:
              input.parentRow === undefined
                ? plainSpans(input.parentID)
                : rowSpans(input.parentRow),
            updated: input.parentUpdated,
            root: input.parentID,
            relevance: undefined,
          },
          graph.localSourceId
        );
  const writeParent =
    input.parentRow?.rowType === "occurrence"
      ? input.parentRow.occurrence
      : resolvedParent?.[1] ?? fallbackRoot;
  const composition =
    input.parentRow?.rowType === "occurrence"
      ? input.parentRow.composition
      : resolvedParent?.[0] ??
        (fallbackRoot
          ? { root: fallbackRoot, claims: [], diagnostics: [] }
          : undefined);
  return {
    ...row,
    rowType: "incoming",
    occurrence: undefined,
    composition,
    incomingTarget: incomingTakeTarget(graph, sourceNodeID, sourceId),
    incomingParent: writeParent,
    incomingEmbed:
      row.reference?.sourceId === LOCAL && input.parentSourceId === LOCAL
        ? true
        : undefined,
    emptyParent: undefined,
    virtualType: "incoming",
    action: undefined,
    node: {
      ...row.node,
      relevance: inherited?.relevance,
      argument: inherited?.argument,
    },
  };
}

function createFooterActionRow(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  parentNode: GraphNode,
  parentSourceId: SourceId,
  id: ID,
  label: string,
  action: "toggle-past-entries"
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
  return {
    ...row,
    rowType: "action",
    occurrence: undefined,
    composition: undefined,
    incomingTarget: undefined,
    incomingParent: undefined,
    incomingEmbed: undefined,
    emptyParent: undefined,
    virtualType: undefined,
    action,
  };
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

function appendVirtualFooterRows(
  data: Data,
  graph: GraphLookup,
  input: VirtualFooterInput,
  initial: TreeResult = emptyTreeResult()
): TreeResult {
  const groups = groupIncomingRefs(graph, input.incomingCrefs);
  const incomingRows = input.incomingCrefs.reduce<{
    rows: Row[];
    emittedGroupKeys: ImmutableSet<string>;
  }>(
    (acc, rowRef) => {
      const rootRef = incomingSourceRootRef(graph, rowRef);
      const key = nodeRefKey(rootRef);
      const group = groups.get(key);
      const grouped =
        group !== undefined && group.refs.length >= INCOMING_GROUP_THRESHOLD;
      if (grouped && acc.emittedGroupKeys.has(key)) {
        return acc;
      }
      const row = createVirtualRow(
        data,
        graph,
        input,
        grouped ? group.rootRef : rowRef,
        acc.rows.length === 0
      );
      return {
        rows: [
          ...acc.rows,
          grouped ? withIncomingGroupChildren(row, group.refs) : row,
        ],
        emittedGroupKeys: grouped
          ? acc.emittedGroupKeys.add(key)
          : acc.emittedGroupKeys,
      };
    },
    { rows: [], emittedGroupKeys: ImmutableSet<string>() }
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
  parentRow: Extract<Row, { rowType: "incoming" }>,
  childID: ID
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
  return {
    ...row,
    rowType: "incoming",
    occurrence: undefined,
    composition: parentRow.composition,
    reference: shortIncomingReference(row.reference),
    incomingTarget: incomingTakeTarget(graph, childID, parentRow.sourceId),
    incomingParent: parentRow.incomingParent,
    incomingEmbed: parentRow.incomingEmbed,
    emptyParent: undefined,
    virtualType: "incoming",
    action: undefined,
    node: {
      ...row.node,
      relevance: sourceNode.relevance,
      argument: sourceNode.argument,
    },
  };
}

function getIncomingGroupChildren(
  data: Data,
  graph: GraphLookup,
  parentRow: Extract<Row, { rowType: "incoming" }>
): TreeResult {
  return {
    rows: parentRow.node.children
      .map((childID) =>
        createIncomingGroupChildRow(data, graph, parentRow, childID)
      )
      .filter((row): row is Row => row !== undefined)
      .toList(),
  };
}

function spliceEmptyRows(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  rows: List<Row>
): List<Row> {
  const parentNode = rowNode(parentRow);
  const parentRef = refForRow(parentRow);
  return parentNode.children.toArray().reduce((current, id, index) => {
    if (id !== EMPTY_NODE_ID) {
      return current;
    }
    const empty = createChildRow(
      data,
      graph,
      parentRow,
      parentNode,
      parentRef,
      id,
      index
    );
    if (!empty) {
      return current;
    }
    const preceding = parentNode.children.slice(0, index).reverse();
    const anchor = preceding.reduce<number>(
      (found, candidate) =>
        found >= 0
          ? found
          : current.findIndex((row) => rowID(row) === candidate),
      -1
    );
    return current.insert(anchor + 1, empty);
  }, rows);
}

function getChildrenForRegularNode(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  rootNode: ID | undefined,
  author: SourceId,
  typeFilters: Pane["typeFilters"]
): TreeResult {
  const activeFilters = typeFilters || DEFAULT_TYPE_FILTERS;
  const directNode: ResolvedNode = {
    ref: refForRow(parentRow),
    node: rowNode(parentRow),
  };
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

  const rawChildRows = (): List<{ childID: ID; row: Row }> =>
    nodes.children
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
      .filter(
        ({ childID, row }) =>
          childID === EMPTY_NODE_ID ||
          (row !== undefined && itemPassesFilters(rowNode(row), activeFilters))
      )
      .filter(
        (pair): pair is { childID: ID; row: Row } => pair.row !== undefined
      )
      .toList();

  const childRowPairs =
    parentRow.rowType === "occurrence"
      ? List<{ childID: ID; row: Row }>()
      : rawChildRows();
  const combinedRows =
    parentRow.rowType === "occurrence"
      ? spliceEmptyRows(
          data,
          graph,
          parentRow,
          List(
            parentRow.occurrence.children
              .filter((child) =>
                itemPassesFilters(
                  {
                    ...composedLine(child).node,
                    relevance: child.relevance,
                    argument: child.argument,
                  },
                  activeFilters
                )
              )
              .map((child) => rowFromComposedRow(data, parentRow, child))
          )
        )
      : childRowPairs.map(({ row }) => row);

  if (!isFileRow(parentRow)) {
    return { rows: combinedRows };
  }

  const feedUrl =
    parentRow.rowType === "occurrence"
      ? calendarFeedTargetUrl(parentRow.occurrence.target)
      : undefined;
  const isBarePastRow = (row: Row): boolean =>
    row.rowType === "occurrence" &&
    row.occurrence.origin.kind === "projected" &&
    isPastCalendarRowText(row.occurrence.text, Date.now());
  const hiddenPastCount =
    feedUrl === undefined ? 0 : combinedRows.filter(isBarePastRow).size;
  const actionRow =
    hiddenPastCount > 0
      ? createPastDatesActionRow(data, graph, parentRow, nodes, nodeSourceId)
      : undefined;
  const rowsWithProjections =
    actionRow && actionRow.view.showPastEntries !== true
      ? combinedRows.filter((row) => !isBarePastRow(row))
      : combinedRows;

  const visibleAuthors = footerVisibleSources(data, parentRow.viewPath[0], [
    LOCAL,
    author,
    nodeSourceId,
  ]);

  const incomingCrefs = getIncomingCrefsForNode(
    data,
    visibleAuthors,
    (parentRow.rowType === "occurrence" &&
    (parentRow.occurrence.kind === "placement" ||
      parentRow.occurrence.kind === "speaking")
      ? parentRow.occurrence.target
      : undefined) ?? nodes.id,
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
  typeFilters: Pane["typeFilters"]
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
    typeFilters
  );
}

export function getTreeChildren(
  data: Data,
  parentRow: Row,
  rootNode: ID | undefined,
  author: SourceId,
  typeFilters: Pane["typeFilters"]
): TreeResult {
  return {
    rows: reindexRows(
      getTreeChildrenForResolvedRow(
        data,
        graphLookupFromData(data),
        parentRow,
        rootNode,
        author,
        typeFilters
      ).rows
    ),
  };
}

function hasHiddenPastEntries(data: Data, row: Row): boolean {
  if (row.rowType !== "occurrence") {
    return false;
  }
  const feedUrl = calendarFeedTargetUrl(row.occurrence.target);
  const entries = feedUrl ? data.calendarFeeds?.get(feedUrl) : undefined;
  if (!entries) {
    return false;
  }
  const childKeys = row.occurrence.children.flatMap((child) =>
    child.origin.kind === "written" &&
    child.origin.physicalParent?.id === row.occurrence.id
      ? [child.target ?? child.id]
      : []
  );
  return hiddenPastEntryCount(childKeys, entries, Date.now()) > 0;
}

function getNodesInRows(
  data: Data,
  graph: GraphLookup,
  rootRows: List<Row>,
  ctx: List<Row>,
  rootNode: ID | undefined,
  author: SourceId,
  typeFilters: Pane["typeFilters"]
): TreeResult {
  return rootRows.reduce<TreeResult>((result, rootRow) => {
    const childResult = getTreeChildrenForResolvedRow(
      data,
      graph,
      rootRow,
      rootNode,
      author,
      typeFilters
    );
    const row = {
      ...rootRow,
      hasChildren:
        childResult.rows.size > 0 ||
        (isFileRow(rootRow) && hasHiddenPastEntries(data, rootRow)),
    };
    const withRoot = {
      rows: result.rows.push(row),
    };
    if (!rootRow.view.expanded) {
      return withRoot;
    }

    return getNodesInRows(
      data,
      graph,
      childResult.rows,
      withRoot.rows,
      rootNode,
      author,
      typeFilters
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
        typeFilters
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
  const topNodes = topRows.map(rowNode);
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
