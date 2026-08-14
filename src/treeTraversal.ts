import { List, Map, Set as ImmutableSet } from "immutable";
import { LOCAL, nodeRefKey } from "./core/nodeRef";
import {
  ViewPath,
  addNodeToPathWithNodes,
  addNodesToLastElement,
  getParentView,
  isEmptyViewPathID,
  isFileRow,
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
  composedContent,
  composedLine,
  writtenLine,
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
): Omit<
  Row,
  | "rowType"
  | "occurrence"
  | "composition"
  | "incomingTarget"
  | "incomingParent"
  | "incomingEmbed"
  | "emptyParent"
  | "action"
> {
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
    parentChildIndex: parentRow?.childIndex,
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

function occurrenceNode(occurrence: ComposedRow): GraphNode {
  return {
    ...composedLine(occurrence).node,
    spans: composedContent(occurrence).node.spans,
    relevance: occurrence.relevance,
    argument: occurrence.argument,
  };
}

function graphParent(
  graph: GraphLookup,
  occurrence: ComposedRow
): ResolvedNode | undefined {
  const parent =
    occurrence.origin.kind === "written"
      ? occurrence.origin.physicalParent
      : occurrence.source.parent;
  return parent ? getNodeInSource(graph, parent) : undefined;
}

type RowBase = ReturnType<typeof createRow>;

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

function attachComposedRow(
  data: Data,
  row: RowBase,
  composition: CompositionResult,
  occurrence: ComposedRow
): Row {
  const viewKey = occurrenceViewKey(row.viewPath, occurrence);
  return {
    ...row,
    viewKey,
    view: data.views.get(viewKey) ?? row.view,
    rowType: "occurrence",
    node: occurrenceNode(occurrence),
    composition,
    ref: composedLine(occurrence).ref,
    sourceId: composedLine(occurrence).ref.sourceId,
    occurrence,
    incomingTarget: undefined,
    incomingParent: undefined,
    incomingEmbed: undefined,
    emptyParent: undefined,
    virtualType: undefined,
    action: undefined,
  };
}

function attachEmpty(
  row: RowBase,
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

function attachSearch(row: RowBase): Row {
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
  graph: GraphLookup,
  parentRow: Row,
  occurrence: ComposedRow
): Row {
  const viewPath = appendNodeToPath(parentRow.viewPath, occurrence.id);
  const parent = graphParent(graph, occurrence);
  const childIndex =
    writtenLine(occurrence) && parent
      ? parent.node.children.findIndex((id) => id === occurrence.id)
      : -1;
  const node = occurrenceNode(occurrence);
  const row = createRow(
    data,
    graph,
    viewPath,
    node,
    composedLine(occurrence).ref.sourceId,
    parentRow,
    parentRow.node,
    parentRow.ref,
    childIndex >= 0 ? childIndex : undefined,
    false,
    undefined
  );
  if (!parentRow.composition) {
    throw new Error("Composed parent has no composition");
  }
  return attachComposedRow(data, row, parentRow.composition, occurrence);
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
  if (occurrence && parentRow) {
    return rowFromComposedRow(data, graph, parentRow, occurrence);
  }
  if (occurrence && composition) {
    const root = createRow(
      data,
      graph,
      viewPath,
      occurrenceNode(occurrence),
      composedLine(occurrence).ref.sourceId,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined
    );
    return attachComposedRow(data, root, composition, occurrence);
  }
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
    return attachComposedRow(data, row, rootComposition, rootComposedRow);
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
    ? getNodeIndexForPath(parentRow.node, pathID)
    : undefined;
  const childID =
    childIndex === undefined
      ? undefined
      : parentRow?.node.children.get(childIndex);
  const edgeNode = (() => {
    if (!parentRow || childID === undefined) {
      return undefined;
    }
    if (childID === EMPTY_NODE_ID) {
      return getEmptyNodeItem(data, parentRow.node);
    }
    return getNodeInSource(graph, {
      sourceId: parentRow.sourceId,
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
  const rowSourceId = edgeNode
    ? parentRow?.sourceId ?? resolved?.ref.sourceId ?? paneSourceId
    : resolved?.ref.sourceId ?? parentRow?.sourceId ?? paneSourceId;
  const row = createRow(
    data,
    graph,
    viewPath,
    node,
    rowSourceId,
    parentRow,
    parentRow?.node,
    parentRow?.ref,
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
  isFirstVirtual: boolean
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
            spans: input.parentRow?.node.spans ?? plainSpans(input.parentID),
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
  parentRow: Row,
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
  parentRow: Row
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
  return parentRow.node.children.toArray().reduce((current, id, index) => {
    if (id !== EMPTY_NODE_ID) {
      return current;
    }
    const empty = createChildRow(
      data,
      graph,
      parentRow,
      parentRow.node,
      parentRow.ref,
      id,
      index
    );
    if (!empty) {
      return current;
    }
    const preceding = parentRow.node.children.slice(0, index).reverse();
    const anchor = preceding.reduce<number>(
      (found, candidate) =>
        found >= 0
          ? found
          : current.findIndex((row) => row.node.id === candidate),
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
          (row !== undefined && itemPassesFilters(row.node, activeFilters))
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
              .map((child) => rowFromComposedRow(data, graph, parentRow, child))
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
    isPastCalendarRowText(nodeText(row.node), Date.now());
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
