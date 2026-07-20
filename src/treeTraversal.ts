import { List, Map, Set as ImmutableSet } from "immutable";
import { LOCAL, nodeRefKey } from "./core/nodeRef";
import {
  ViewPath,
  addNodeToPathWithNodes,
  addNodesToLastElement,
  getParentView,
  getViewForNode,
  isEmbedRow,
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
import { isCanonicalId } from "./core/entityRecognition";
import { getAllLinks, linkSpan, nodeText, plainSpans } from "./core/nodeSpans";
import {
  IcalEntry,
  calendarEntryTarget,
  calendarFeedUrl,
  hiddenPastEntryCount,
  isCalendarEntryId,
  icalEntryDisplayText,
  mergeProjectedEntries,
} from "./core/ical";
import {
  getDocumentByIdOrFilePath,
  getDocumentForNode,
  type Document,
} from "./core/Document";
import { DEFAULT_TYPE_FILTERS } from "./core/constants";
import {
  getAlternativeFooterData,
  getIncomingCrefsForNode,
} from "./semanticProjection";
import { buildReferenceItem } from "./buildReferenceRow";
import { referenceToText } from "./editor/referenceText";
import {
  RELATED_SOURCE_MIN_OVERLAP,
  localDocumentTags,
  nodeRelatedTags,
} from "./pullSources";
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
const RELATED_SOURCE_INLINE_LIMIT = 7;

function emptyTreeResult(rows: List<Row> = List<Row>()): TreeResult {
  return { rows };
}

function sourceIdForPath(data: Data, path: ViewPath): SourceId {
  return data.panes[path[0]]?.sourceId ?? LOCAL;
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
  suggestions: List<ID>;
  versionMetas: Map<
    ID,
    {
      updated: number;
      addCount: number;
      removeCount: number;
    }
  >;
  renames: List<{
    versionId: ID;
    theirs: string;
    sourceId: SourceId;
    snapshotId: string;
    baselineNodeId: ID;
  }>;
  relatedSourceRefs: List<NodeRef>;
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
  virtualType: Row["virtualType"] | undefined,
  versionMeta: Row["versionMeta"] | undefined
): Row {
  const nodeID = node.id;
  const inheritedVirtualType =
    parentRow?.virtualType === "search" ||
    parentRow?.virtualType === "suggestion"
      ? parentRow.virtualType
      : undefined;
  const rowVirtualType =
    virtualType ?? (isSearchId(nodeID) ? "search" : inheritedVirtualType);
  const provenance =
    rowVirtualType === "suggestion" ||
    rowVirtualType === "incoming" ||
    rowVirtualType === "version" ||
    rowVirtualType === "related-source"
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
    isFirstVirtual,
    virtualType: rowVirtualType,
    provenance,
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
      undefined,
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
  const sourceNodeID = rowRef.id;
  const sourceRow =
    virtualType === "suggestion"
      ? lookupNode(graph, sourceNodeID, graph.localSourceId)
      : undefined;
  const incomingRow =
    virtualType === "incoming" ? getNodeInSource(graph, rowRef) : undefined;
  const versionRow =
    virtualType === "version"
      ? lookupNode(graph, sourceNodeID, graph.localSourceId)
      : undefined;
  const relatedSourceRow =
    virtualType === "related-source"
      ? getNodeInSource(graph, rowRef)
      : undefined;
  const resolvedSource =
    sourceRow ?? incomingRow ?? versionRow ?? relatedSourceRow;
  const sourceNode = resolvedSource?.node;
  if (virtualType === "related-source") {
    return {
      node: {
        children: List<ID>(),
        id: sourceNodeID,
        spans: [linkSpan(sourceNodeID, sourceNode ? nodeText(sourceNode) : "")],
        parent: input.parentID,
        updated: sourceNode?.updated ?? input.parentUpdated,
        root: sourceNode?.root ?? sourceNodeID,
        relevance: undefined,
        argument: undefined,
      },
      sourceId: resolvedSource?.ref.sourceId ?? rowRef.sourceId,
    };
  }
  if (virtualType !== "incoming") {
    return {
      node: sourceNode ?? {
        children: List<ID>(),
        id: sourceNodeID,
        spans: plainSpans(""),
        parent: input.parentID,
        updated: input.parentUpdated,
        root: input.parentRoot,
        relevance: undefined,
      },
      sourceId: resolvedSource?.ref.sourceId ?? input.parentSourceId,
    };
  }
  return {
    node: {
      children: List<ID>(),
      id: sourceNodeID,
      spans: [
        linkSpan(
          sourceNodeID,
          nodePathLabel(data.knowledgeDBs, incomingRow) ?? ""
        ),
      ],
      parent: input.parentID,
      updated: sourceNode?.updated ?? input.parentUpdated,
      root: sourceNode?.root ?? input.parentRoot,
      relevance: undefined,
      argument: undefined,
    },
    sourceId: resolvedSource?.ref.sourceId ?? input.parentSourceId,
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

function tagWeightMap(
  weights: readonly RelatedSourceTagWeight[]
): globalThis.Map<string, number> {
  return weights.reduce(
    (acc, weight) => new globalThis.Map(acc).set(weight.tag, weight.weight),
    new globalThis.Map<string, number>()
  );
}

function addContextTags(
  weights: readonly RelatedSourceTagWeight[],
  tags: readonly string[],
  weight: number
): RelatedSourceTagWeight[] {
  const merged = tags.reduce(
    (acc, tag) =>
      new globalThis.Map(acc).set(tag, (acc.get(tag) ?? 0) + weight),
    tagWeightMap(weights)
  );
  return [...merged.entries()].map(([tag, value]) => ({ tag, weight: value }));
}

function relatedContextScore(
  context: RelatedSourceContext,
  sourceTags: readonly string[]
): RelatedSourcePlacement {
  const sourceTagSet = new globalThis.Set(sourceTags);
  const overlapTags = context.weightedTags
    .filter((weight) => sourceTagSet.has(weight.tag))
    .map((weight) => weight.tag)
    .sort();
  const sourceWidth = sourceTags.length === 0 ? 1 : sourceTags.length;
  const score =
    context.weightedTags
      .filter((weight) => sourceTagSet.has(weight.tag))
      .reduce((sum, weight) => sum + weight.weight, 0) +
    overlapTags.length / sourceWidth;
  return {
    sourceId: "",
    targetRef: context.targetRef,
    score,
    overlapTags,
  };
}

function compareRelatedPlacement(
  left: RelatedSourcePlacement,
  right: RelatedSourcePlacement
): number {
  return (
    right.score - left.score ||
    right.overlapTags.length - left.overlapTags.length ||
    left.targetRef.id.localeCompare(right.targetRef.id) ||
    left.targetRef.sourceId.localeCompare(right.targetRef.sourceId)
  );
}

function visibleRelatedContextsForNode(
  data: Data,
  graph: GraphLookup,
  node: GraphNode,
  sourceId: SourceId,
  viewPath: ViewPath,
  rootIds: ReadonlySet<ID>,
  pathRefs: readonly NodeRef[],
  weights: readonly RelatedSourceTagWeight[]
): RelatedSourceContext[] {
  const ref = { sourceId, id: node.id };
  const nextPathRefs = [...pathRefs, ref];
  const nextWeights = addContextTags(
    weights,
    nodeRelatedTags(data, node, sourceId, rootIds),
    nextPathRefs.length
  );
  const context = {
    targetRef: ref,
    pathRefs: nextPathRefs,
    weightedTags: nextWeights,
  };
  const view = getViewForNode(data, viewPath, node.id);
  if (!view.expanded) {
    return [context];
  }
  return [
    context,
    ...node.children.toArray().flatMap((childId, index) => {
      const child = getNodeInSource(graph, { sourceId, id: childId })?.node;
      if (!child) {
        return [];
      }
      return visibleRelatedContextsForNode(
        data,
        graph,
        child,
        sourceId,
        addNodeToPathWithNodes(viewPath, node, index),
        rootIds,
        nextPathRefs,
        nextWeights
      );
    }),
  ];
}

function visibleRelatedContextsForRow(
  data: Data,
  graph: GraphLookup,
  row: Row
): RelatedSourceContext[] {
  if (row.sourceId !== LOCAL) {
    return [];
  }
  const topId = row.viewPath[1];
  const top = getNodeInSource(graph, {
    sourceId: row.sourceId,
    id: topId,
  })?.node;
  if (!top) {
    return [];
  }
  const topPath: ViewPath = [row.viewPath[0], topId];
  const rootIds = new globalThis.Set<ID>([top.root ?? top.id]);
  return visibleRelatedContextsForNode(
    data,
    graph,
    top,
    row.sourceId,
    topPath,
    rootIds,
    [],
    []
  );
}

function sourceRootRef(
  data: Data,
  graph: GraphLookup,
  sourceId: SourceId
): NodeRef | undefined {
  const rootId = data.pull?.metadataBySourceId.get(sourceId)?.rootIds[0];
  if (!rootId) {
    return undefined;
  }
  return getNodeInSource(graph, { sourceId, id: rootId })?.ref;
}

function pulledRelatedSourceCandidates(
  data: Data,
  graph: GraphLookup,
  pane: Pane | undefined
): RelatedSourceCandidate[] {
  const relatedSourceIds = pane
    ? data.pull?.relatedSourceIdsByPaneId.get(pane.id) ?? []
    : [];
  return relatedSourceIds.flatMap((sourceId) => {
    const metadata = data.pull?.metadataBySourceId.get(sourceId);
    const rootRef = sourceRootRef(data, graph, sourceId);
    return metadata && rootRef
      ? [
          {
            rootRef,
            sTags: metadata.sTags,
            ms: metadata.ms,
            title: metadata.title,
          },
        ]
      : [];
  });
}

function currentDocumentForRow(
  data: Data,
  graph: GraphLookup,
  row: Row
): Document | undefined {
  const pane = data.panes[row.viewPath[0]];
  const paneDocument = pane?.documentId
    ? getDocumentByIdOrFilePath(
        data.documents,
        data.documentByFilePath,
        LOCAL,
        pane.documentId
      )
    : undefined;
  if (paneDocument) {
    return paneDocument;
  }
  const topId = row.viewPath[1];
  const top = getNodeInSource(graph, {
    sourceId: row.sourceId,
    id: topId,
  })?.node;
  return top
    ? getDocumentForNode(data.knowledgeDBs, data.documents, top, row.sourceId)
    : undefined;
}

function localSourceCandidateTags(data: Data, document: Document): string[] {
  const rootIds = new globalThis.Set(document.topNodeShortIds);
  return localDocumentTags(document).filter(
    (tag) => !rootIds.has(tag) || isCanonicalId(tag)
  );
}

function localRelatedSourceCandidates(
  data: Data,
  graph: GraphLookup,
  rows: List<Row>
): RelatedSourceCandidate[] {
  const currentDocIds = new globalThis.Set(
    rows
      .map((row) => currentDocumentForRow(data, graph, row)?.docId)
      .filter((docId): docId is string => docId !== undefined)
      .toArray()
  );
  const currentRootIds = new globalThis.Set(
    rows
      .map((row) => row.viewPath[1])
      .filter((rootId): rootId is ID => rootId !== undefined)
      .toArray()
  );
  return data.documents
    .valueSeq()
    .toArray()
    .flatMap((document) => {
      const rootId = document.topNodeShortIds[0];
      if (
        document.sourceId !== LOCAL ||
        currentDocIds.has(document.docId) ||
        (rootId !== undefined && currentRootIds.has(rootId))
      ) {
        return [];
      }
      const root = rootId
        ? getNodeInSource(graph, { sourceId: LOCAL, id: rootId })
        : undefined;
      const sTags = localSourceCandidateTags(data, document);
      return root &&
        sTags.length >= RELATED_SOURCE_MIN_OVERLAP &&
        sTags.some(isCanonicalId)
        ? [
            {
              rootRef: root.ref,
              sTags,
              ms: document.updatedMs,
              title: document.title,
            },
          ]
        : [];
    });
}

function rowAlreadyLinksSourceRoot(
  graph: GraphLookup,
  row: Row,
  rootRef: NodeRef
): boolean {
  if (row.node.id === rootRef.id) {
    return true;
  }
  if (getAllLinks(row.node).some((link) => link.targetID === rootRef.id)) {
    return true;
  }
  return row.node.children.some((childId) => {
    if (childId === rootRef.id) {
      return true;
    }
    const child = getNodeInSource(graph, {
      sourceId: row.sourceId,
      id: childId,
    })?.node;
    return child
      ? getAllLinks(child).some((link) => link.targetID === rootRef.id)
      : false;
  });
}

function compareRelatedCandidatePlacement(
  left: {
    candidate: RelatedSourceCandidate;
    placement: RelatedSourcePlacement;
  },
  right: {
    candidate: RelatedSourceCandidate;
    placement: RelatedSourcePlacement;
  }
): number {
  const leftWidth = left.candidate.sTags.length || 1;
  const rightWidth = right.candidate.sTags.length || 1;
  return (
    right.placement.score - left.placement.score ||
    right.placement.overlapTags.length - left.placement.overlapTags.length ||
    right.placement.overlapTags.length / rightWidth -
      left.placement.overlapTags.length / leftWidth ||
    right.candidate.ms - left.candidate.ms ||
    left.candidate.title.localeCompare(right.candidate.title) ||
    nodeRefKey(left.candidate.rootRef).localeCompare(
      nodeRefKey(right.candidate.rootRef)
    )
  );
}

function relatedSourceRefsByRow(
  data: Data,
  graph: GraphLookup,
  rows: List<Row>
): Map<string, List<NodeRef>> {
  const localRows = rows.filter((row) => row.sourceId === LOCAL).toList();
  if (localRows.size === 0) {
    return Map<string, List<NodeRef>>();
  }
  const pane = data.panes[localRows.first()?.viewPath[0] ?? 0];
  const contexts = localRows
    .toArray()
    .flatMap((row) => visibleRelatedContextsForRow(data, graph, row));
  const candidates = [
    ...pulledRelatedSourceCandidates(data, graph, pane),
    ...localRelatedSourceCandidates(data, graph, localRows),
  ];
  const placements = candidates.flatMap((candidate) => {
    const matchingPlacements = contexts
      .map((context) => ({
        ...relatedContextScore(context, candidate.sTags),
        sourceId: candidate.rootRef.sourceId,
      }))
      .filter(
        (placement) =>
          placement.overlapTags.length >= RELATED_SOURCE_MIN_OVERLAP
      );
    if (candidate.rootRef.sourceId === LOCAL) {
      return matchingPlacements.map((placement) => ({ candidate, placement }));
    }
    const best = matchingPlacements.slice().sort(compareRelatedPlacement)[0];
    return best ? [{ candidate, placement: best }] : [];
  });
  const grouped = placements.reduce(
    (acc, placement) => {
      const key = nodeRefKey(placement.placement.targetRef);
      return acc.set(key, [...(acc.get(key) ?? []), placement]);
    },
    Map<
      string,
      {
        candidate: RelatedSourceCandidate;
        placement: RelatedSourcePlacement;
      }[]
    >()
  );
  return grouped.map((placementsForRow) =>
    List(
      placementsForRow
        .slice()
        .sort(compareRelatedCandidatePlacement)
        .map(({ candidate }) => candidate.rootRef)
    )
  );
}

function relatedSourceRefsForRow(
  graph: GraphLookup,
  row: Row,
  incomingCrefs: List<NodeRef>,
  refsByRow: Map<string, List<NodeRef>>
): List<NodeRef> {
  if (row.sourceId !== LOCAL) {
    return List<NodeRef>();
  }
  const incomingRootKeys = new globalThis.Set(
    incomingCrefs
      .map((ref) => nodeRefKey(incomingSourceRootRef(graph, ref)))
      .toArray()
  );
  return (refsByRow.get(nodeRefKey(row.ref)) ?? List<NodeRef>()).filter(
    (rootRef) =>
      !incomingRootKeys.has(nodeRefKey(rootRef)) &&
      !rowAlreadyLinksSourceRoot(graph, row, rootRef)
  );
}

function createVirtualRow(
  data: Data,
  graph: GraphLookup,
  input: VirtualFooterInput,
  rowRef: NodeRef,
  virtualType: Row["virtualType"],
  isFirstVirtual: boolean,
  priorAnchors: ID[] = []
): Row {
  const sourceNodeID = rowRef.id;
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
  const viewNodeID =
    virtualType === "incoming" || virtualType === "related-source"
      ? (`${virtualType}:${sourceId}:${sourceNodeID}` as ID)
      : node.id;
  const viewPath =
    input.parentID === undefined
      ? addNodesToLastElement(parentPath, viewNodeID)
      : appendNodeToPath(parentPath, viewNodeID);
  const parentRef = input.parentID
    ? { sourceId: input.parentSourceId, id: input.parentID }
    : undefined;
  const versionMeta =
    virtualType === "version"
      ? input.versionMetas.get(sourceNodeID)
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
    virtualType,
    versionMeta
  );
  if (virtualType !== "incoming" && virtualType !== "related-source") {
    return row;
  }
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
        relevance:
          virtualType === "incoming" ? inherited?.relevance : undefined,
        argument: virtualType === "incoming" ? inherited?.argument : undefined,
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
    undefined,
    undefined
  );
  return { ...row, materialize: { precededBy } };
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
    undefined,
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

function createMoreRelatedSourcesActionRow(
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
    `action:related:${parentNode.id}` as ID,
    "Open to see more related sources",
    "open-related-sources"
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
  const feedUrl = calendarFeedUrl(parentNode);
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
        "incoming",
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
  const capRelatedSources = (input.parentRow?.depth ?? 1) > 1;
  const visibleRelatedSourceRefs = capRelatedSources
    ? input.relatedSourceRefs.take(RELATED_SOURCE_INLINE_LIMIT)
    : input.relatedSourceRefs;
  const hiddenRelatedSourceCount =
    input.relatedSourceRefs.size - visibleRelatedSourceRefs.size;
  const relatedRows = visibleRelatedSourceRefs.map((rowRef, index) =>
    createVirtualRow(
      data,
      graph,
      input,
      rowRef,
      "related-source",
      incomingRows.length + index === 0,
      []
    )
  );
  const moreRelatedSourcesRow =
    hiddenRelatedSourceCount > 0 && input.parentRow
      ? createMoreRelatedSourcesActionRow(
          data,
          graph,
          input.parentRow,
          input.parentRow.node,
          input.parentSourceId
        )
      : undefined;
  const relatedActionRows = moreRelatedSourcesRow
    ? List<Row>([
        {
          ...moreRelatedSourcesRow,
          isFirstVirtual: incomingRows.length + relatedRows.size === 0,
        },
      ])
    : List<Row>();
  const suggestionOffset =
    incomingRows.length + relatedRows.size + relatedActionRows.size;
  const suggestionRows = input.suggestions.map((nodeID, index) =>
    createVirtualRow(
      data,
      graph,
      input,
      { sourceId: graph.localSourceId, id: nodeID },
      "suggestion",
      suggestionOffset + index === 0
    )
  );
  const versionOffset = suggestionOffset + suggestionRows.size;
  const versionRows = input.versionMetas
    .keySeq()
    .toList()
    .map((nodeID, index) =>
      createVirtualRow(
        data,
        graph,
        input,
        { sourceId: graph.localSourceId, id: nodeID },
        "version",
        versionOffset + index === 0
      )
    );

  // Rename suggestions: replacement-shaped rows (strikethrough old, new
  // beside it). They ride the suggestion vocabulary — @ gutter, the
  // suggestions filter — but carry their own take/dismiss semantics.
  const renameOffset = versionOffset + versionRows.size;
  const parentText = input.parentRow ? nodeText(input.parentRow.node) : "";
  const renameRows = input.renames.map((rename, index) => {
    const base = createVirtualRow(
      data,
      graph,
      input,
      { sourceId: rename.sourceId, id: rename.versionId },
      "suggestion",
      renameOffset + index === 0
    );
    const renamePath = [
      ...base.viewPath.slice(0, -1),
      `rename:${rename.versionId}` as ID,
    ] as unknown as ViewPath;
    return {
      ...base,
      viewPath: renamePath,
      viewKey: viewPathToString(renamePath),
      // Replacement-shaped: the row is about text, not a subtree — it
      // never expands.
      hasChildren: false,
      renameSuggestion: {
        theirs: rename.theirs,
        mine: parentText,
        versionId: rename.versionId,
        snapshotId: rename.snapshotId,
        baselineNodeId: rename.baselineNodeId,
      },
    };
  });

  return {
    rows: initial.rows
      .concat(incomingRows)
      .concat(relatedRows)
      .concat(relatedActionRows)
      .concat(suggestionRows)
      .concat(versionRows)
      .concat(renameRows),
  };
}

// The embed seam (idea.md): the target's subtree as a computed, read-only
// block. One embed exists today — the suggestion preview.
function getEmbedChildren(
  data: Data,
  graph: GraphLookup,
  parentRow: Row
): TreeResult {
  const source = getNodeInSource(graph, parentRow.ref);
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
    "incoming",
    undefined
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

function getChildrenForRegularNode(
  data: Data,
  graph: GraphLookup,
  parentRow: Row,
  rootNode: ID | undefined,
  author: SourceId,
  typeFilters: Pane["typeFilters"],
  refsByRow: Map<string, List<NodeRef>>,
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

  // Overlays attach to file rows only: a proposal is a leaf of the
  // proposal system, not a node in it. No projections, no footers, no
  // feed fetches under suggested/version/incoming rows — their children
  // render as the plain preview they are.
  if (!isFileRow(parentRow)) {
    return { rows: childRows };
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
    childRows,
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
    allChildNodes,
    undefined
  ).filter((ref) => ref.id !== nodes.id);

  const visibleIncomingCrefs = activeFilters.includes("incoming")
    ? incomingCrefs
    : List<NodeRef>();
  const relatedSourceRefs = activeFilters.includes("incoming")
    ? relatedSourceRefsForRow(graph, parentRow, visibleIncomingCrefs, refsByRow)
    : List<NodeRef>();

  const isOwnContent = nodeSourceId === LOCAL;
  const {
    suggestions: diffItems,
    versionMetas,
    renames,
  } = getAlternativeFooterData(
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
    renames,
    relatedSourceRefs,
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
  refsByRow: Map<string, List<NodeRef>>,
  options?: TreeTraversalOptions
): TreeResult {
  if (isEmbedRow(parentRow)) {
    return getEmbedChildren(data, graph, parentRow);
  }
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
    refsByRow,
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
  const activeFilters = typeFilters || DEFAULT_TYPE_FILTERS;
  const refsByRow = activeFilters.includes("incoming")
    ? relatedSourceRefsByRow(data, graph, List<Row>([parentRow]))
    : Map<string, List<NodeRef>>();
  return {
    rows: reindexRows(
      getTreeChildrenForResolvedRow(
        data,
        graph,
        parentRow,
        rootNode,
        author,
        typeFilters,
        refsByRow,
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
  const feedUrl = calendarFeedUrl(node);
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
  refsByRow: Map<string, List<NodeRef>>,
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
      refsByRow,
      options
    );
    const row = {
      ...rootRow,
      // A calendar feed whose entries are all hidden past still expands
      // (and keeps its triangle): the children exist, they're behind the
      // past chip. File rows only — proposals don't host the feed.
      // Rename suggestions are replacement-shaped: about text, not a
      // subtree — they never expand.
      hasChildren:
        !rootRow.renameSuggestion &&
        (childResult.rows.size > 0 ||
          (isFileRow(rootRow) &&
            hasHiddenPastEntries(data, graph, rootRow.node, rootRow.sourceId))),
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
      refsByRow,
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
  const activeFilters = typeFilters || DEFAULT_TYPE_FILTERS;
  const refsByRow = activeFilters.includes("incoming")
    ? relatedSourceRefsByRow(data, graph, rootRows)
    : Map<string, List<NodeRef>>();
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
        refsByRow,
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
  const refsByRow = activeFilters.includes("incoming")
    ? relatedSourceRefsByRow(data, graph, topRows)
    : Map<string, List<NodeRef>>();
  const treeResult = {
    rows: reindexRows(
      getNodesInRows(
        data,
        graph,
        topRows,
        List<Row>(),
        undefined,
        document.sourceId,
        activeFilters,
        refsByRow
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
    suggestions: List<ID>(),
    versionMetas: Map<
      ID,
      { updated: number; addCount: number; removeCount: number }
    >(),
    renames: List<{
      versionId: ID;
      theirs: string;
      sourceId: SourceId;
      snapshotId: string;
      baselineNodeId: ID;
    }>(),
    relatedSourceRefs: List<NodeRef>(),
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
