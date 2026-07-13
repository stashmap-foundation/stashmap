import { List, Map, OrderedMap, Set as ImmutableSet } from "immutable";
import {
  getChildNodes,
  isSearchId,
  itemPassesFilters,
  getNodeContext,
  getNode,
  nodePathLabel,
} from "./core/connections";
import { getAllLinks } from "./core/nodeSpans";
import { fileLinkIndexKey } from "./core/linkPath";
import { isCalendarEntryPlacement } from "./core/ical";
import { suggestionSettings } from "./core/constants";
import { LOG_ROOT_ROLE } from "./core/systemRoots";
import { computeVersionDiff, VersionDiff } from "./core/snapshotBaseline";
import { documentKeyOf, type Document } from "./core/Document";
import {
  GraphLookup,
  ResolvedNode,
  getNodeInSource,
  lookupNode,
  lookupNodes,
  parentOf,
} from "./core/graphLookup";
import { nodeRefKey } from "./core/nodeRef";

type FooterTypeFilters = (
  | Relevance
  | "suggestions"
  | "versions"
  | "incoming"
  | "contains"
)[];

type ReferencedByRef = {
  nodeID: ID;
  sourceId: SourceId;
  context: Context;
  updated: number;
};

function getContextKey(context: Context): string {
  return context.join(":");
}

function contextsMatch(leftContext: Context, rightContext: Context): boolean {
  return getContextKey(leftContext) === getContextKey(rightContext);
}

function getNodeCandidates(graph: GraphLookup, nodeID: ID): List<ResolvedNode> {
  return List(lookupNodes(graph, nodeID)).sortBy(
    (resolved) => -resolved.node.updated
  );
}

export function findRefsToNode(
  graph: GraphLookup,
  nodeID: ID,
  filterContext?: Context,
  targetAuthor?: SourceId,
  targetRoot?: ID
): List<ReferencedByRef> {
  const { knowledgeDBs } = graph;
  const resolvedRefs = getNodeCandidates(graph, nodeID)
    .filter(({ node }) => !isSearchId(node.id))
    .filter(({ node, ref }) =>
      getNodeContext(knowledgeDBs, node, ref.sourceId).every(
        (id) => !isSearchId(id)
      )
    )
    .map(({ node, ref }) => ({
      ref: {
        nodeID: node.id,
        sourceId: ref.sourceId,
        context: getNodeContext(knowledgeDBs, node, ref.sourceId),
        updated: node.updated,
      },
      author: ref.sourceId,
      root: node.root,
    }))
    .toList();

  const allRefs = filterContext
    ? resolvedRefs
        .filter(({ ref, author, root }) =>
          targetAuthor !== undefined &&
          targetRoot !== undefined &&
          author === targetAuthor &&
          root === targetRoot
            ? ref.context.equals(filterContext)
            : contextsMatch(ref.context, filterContext)
        )
        .map(({ ref }) => ref)
        .toList()
    : resolvedRefs.map(({ ref }) => ref).toList();

  return allRefs
    .groupBy((ref) => ref.nodeID)
    .map((grp) => grp.first()!)
    .valueSeq()
    .toList();
}

function getRefContextKey(
  _knowledgeDBs: KnowledgeDBs,
  ref: ReferencedByRef
): string {
  return getContextKey(ref.context);
}

function contextKeyForTarget(
  knowledgeDBs: KnowledgeDBs,
  targetID: ID,
  effectiveAuthor: SourceId
): string | undefined {
  const targetNode = getNode(knowledgeDBs, targetID, effectiveAuthor);
  if (!targetNode) {
    return undefined;
  }
  return getContextKey(
    getNodeContext(knowledgeDBs, targetNode, effectiveAuthor)
  );
}

function coveredContextKeys(
  knowledgeDBs: KnowledgeDBs,
  targetIDs: List<ID>,
  effectiveAuthor: SourceId
): ImmutableSet<string> {
  return targetIDs.reduce((acc, targetID) => {
    const key = contextKeyForTarget(knowledgeDBs, targetID, effectiveAuthor);
    return key !== undefined ? acc.add(key) : acc;
  }, ImmutableSet<string>());
}

function sourceDocumentKey(
  knowledgeDBs: KnowledgeDBs,
  documents: Map<string, Document> | undefined,
  node: GraphNode,
  sourceId: SourceId
): string | undefined {
  const rootNode =
    node.id === node.root ? node : getNode(knowledgeDBs, node.root, sourceId);
  if (!rootNode?.docId) {
    return undefined;
  }
  const key = documentKeyOf(sourceId, rootNode.docId);
  return documents?.has(key) ? key : undefined;
}

function documentLinkerRefs(
  graphIndex: GraphIndex,
  effectiveAuthor: SourceId,
  candidateDocument: Document
): NodeRef[] {
  const lookupPaths = ImmutableSet<string>([
    ...(candidateDocument.filePath ? [candidateDocument.filePath] : []),
    candidateDocument.docId,
  ]);
  return lookupPaths
    .toArray()
    .flatMap(
      (path) =>
        graphIndex.incomingFileLinks.get(
          fileLinkIndexKey(effectiveAuthor, path)
        ) ?? []
    );
}

function isWithinSubtree(
  knowledgeDBs: KnowledgeDBs,
  nodeID: ID,
  author: SourceId,
  subtreeRootIDs: ImmutableSet<ID>,
  visited: ImmutableSet<ID>
): boolean {
  if (subtreeRootIDs.has(nodeID)) {
    return true;
  }
  if (visited.has(nodeID)) {
    return false;
  }
  const node = getNode(knowledgeDBs, nodeID, author);
  if (!node?.parent) {
    return false;
  }
  return isWithinSubtree(
    knowledgeDBs,
    node.parent,
    author,
    subtreeRootIDs,
    visited.add(nodeID)
  );
}

function subtreeLinksToDocument(
  graph: GraphLookup,
  documents: Map<string, Document> | undefined,
  candidate: ResolvedNode,
  currentNodeID: ID | undefined,
  effectiveAuthor: SourceId,
  subtreeRootIDs: ImmutableSet<ID>
): boolean {
  const { graphIndex, knowledgeDBs } = graph;
  const key = sourceDocumentKey(
    knowledgeDBs,
    documents,
    candidate.node,
    candidate.ref.sourceId
  );
  const candidateDocument = key === undefined ? undefined : documents?.get(key);
  if (!candidateDocument) {
    return false;
  }
  return documentLinkerRefs(
    graphIndex,
    effectiveAuthor,
    candidateDocument
  ).some((ref) => {
    const linker = getNodeInSource(graph, ref);
    return (
      linker !== undefined &&
      linker.node.id !== currentNodeID &&
      isWithinSubtree(
        knowledgeDBs,
        linker.node.id,
        linker.ref.sourceId,
        subtreeRootIDs,
        ImmutableSet<ID>()
      )
    );
  });
}

function isInSystemRoot(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode | undefined,
  sourceId: SourceId,
  systemRole: RootSystemRole
): boolean {
  if (!node) {
    return false;
  }
  const rootNode = getNode(knowledgeDBs, node.root, sourceId);
  return rootNode?.systemRole === systemRole;
}

export function deduplicateRefsByContext(
  refs: List<ReferencedByRef>,
  knowledgeDBs: KnowledgeDBs,
  preferAuthor?: SourceId
): List<ReferencedByRef> {
  return refs
    .groupBy((ref) => getRefContextKey(knowledgeDBs, ref))
    .map(
      (group) =>
        group
          .sortBy((ref) => {
            const node = preferAuthor
              ? getNode(knowledgeDBs, ref.nodeID, preferAuthor)
              : undefined;
            const isOther = preferAuthor && !node ? 1 : 0;
            return [isOther, -ref.updated];
          })
          .first()!
    )
    .valueSeq()
    .toList();
}

function incomingFileLinkSourceRefs(
  graphIndex: GraphIndex,
  rootFilePath: string | undefined,
  rootAuthor: SourceId | undefined
): NodeRef[] {
  if (!rootFilePath || !rootAuthor) return [];
  const key = fileLinkIndexKey(rootAuthor, rootFilePath);
  return graphIndex.incomingFileLinks.get(key) ?? [];
}

function getGraphLinkOwner(
  graph: GraphLookup,
  linkItemRef: NodeRef
): ResolvedNode | undefined {
  const resolvedItem = getNodeInSource(graph, linkItemRef);
  return resolvedItem;
}

function uniqueNodes(nodes: ResolvedNode[]): ResolvedNode[] {
  const seen = new globalThis.Set<string>();
  return nodes.filter((node) => {
    const key = nodeRefKey(node.ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getIncomingCrefsForNode(
  graph: GraphLookup,
  visibleAuthors: ImmutableSet<SourceId>,
  parentNodeID: ID | undefined,
  currentNodeID: ID | undefined,
  effectiveAuthor: SourceId,
  itemsSourceId: SourceId,
  currentItems?: List<GraphNode>,
  currentNodeFilePath?: string,
  documents?: Map<string, Document>
): List<NodeRef> {
  const { graphIndex, knowledgeDBs } = graph;
  const current = currentItems || List<GraphNode>();

  const graphLinkRefs = (() => {
    if (!currentNodeID) {
      return [];
    }
    const sourceScopedRefs =
      graphIndex.incomingCrefsByTarget.get(
        nodeRefKey({ sourceId: itemsSourceId, id: currentNodeID })
      ) ?? [];
    return sourceScopedRefs.length > 0
      ? sourceScopedRefs
      : graphIndex.incomingCrefs.get(currentNodeID) ?? [];
  })();
  const graphLinkSourceNodes = graphLinkRefs
    .map((ref) => getGraphLinkOwner(graph, ref))
    .filter((node): node is ResolvedNode => node !== undefined);
  const fileLinkSourceNodes = incomingFileLinkSourceRefs(
    graphIndex,
    currentNodeFilePath,
    itemsSourceId
  )
    .map((ref) => getNodeInSource(graph, ref))
    .filter((node): node is ResolvedNode => node !== undefined);
  const sourceNodes = List(
    uniqueNodes([...graphLinkSourceNodes, ...fileLinkSourceNodes])
  )
    .filter(
      (source) =>
        !isCalendarEntryPlacement(source.node, parentOf(graph, source)?.node)
    )
    .sortBy(({ ref, node }) => nodePathLabel(knowledgeDBs, node, ref.sourceId))
    .toArray();
  if (sourceNodes.length === 0) {
    return List<NodeRef>();
  }

  const outgoingTargetIDs = current
    .flatMap((item) => getAllLinks(item).map((link) => link.targetID))
    .toList();
  const covered = coveredContextKeys(
    knowledgeDBs,
    outgoingTargetIDs,
    effectiveAuthor
  );
  const outgoingTargetRelIDs = current.reduce(
    (acc, item) =>
      acc.add(item.id).union(getAllLinks(item).map((link) => link.targetID)),
    ImmutableSet<ID>()
  );
  const subtreeRootIDs = ImmutableSet<ID>(current.map((item) => item.id)).union(
    currentNodeID ? [currentNodeID] : []
  );

  const refs = List(
    sourceNodes
      .filter(({ ref }) => visibleAuthors.has(ref.sourceId))
      .filter(({ node }) => node.id !== parentNodeID)
      .filter(({ node }) => node.id !== currentNodeID)
      .filter(
        (resolved) =>
          !subtreeLinksToDocument(
            graph,
            documents,
            resolved,
            currentNodeID,
            effectiveAuthor,
            subtreeRootIDs
          )
      )
      .filter(
        ({ ref, node }) =>
          node.systemRole !== LOG_ROOT_ROLE &&
          !isInSystemRoot(knowledgeDBs, node, ref.sourceId, LOG_ROOT_ROLE)
      )
      .filter(({ node }) => !outgoingTargetRelIDs.has(node.id))
      .map(({ ref, node }) => ({
        nodeID: node.id,
        sourceId: ref.sourceId,
        context: getNodeContext(knowledgeDBs, node, ref.sourceId),
        updated: node.updated,
      }))
  );

  const deduped = deduplicateRefsByContext(refs, knowledgeDBs, effectiveAuthor);
  return deduped
    .filter((ref) => !covered.has(getRefContextKey(knowledgeDBs, ref)))
    .map((ref) => ({ sourceId: ref.sourceId, id: ref.nodeID }))
    .toList();
}

export type RenameSuggestion = {
  versionId: ID;
  theirs: string;
  sourceId: SourceId;
  snapshotId: string;
  baselineNodeId: ID;
};

type AlternativeFooterResult = {
  suggestions: List<ID>;
  versionMetas: Map<ID, NonNullable<Row["versionMeta"]>>;
  renames: List<RenameSuggestion>;
};

const EMPTY_ALTERNATIVE_FOOTER_RESULT: AlternativeFooterResult = {
  suggestions: List<ID>(),
  versionMetas: Map<ID, NonNullable<Row["versionMeta"]>>(),
  renames: List<RenameSuggestion>(),
};

function isVisibleVersion(
  resolved: ResolvedNode,
  visibleAuthors: ImmutableSet<SourceId>
): boolean {
  return visibleAuthors.has(resolved.ref.sourceId);
}

function getPastVersions(
  graph: GraphLookup,
  visibleAuthors: ImmutableSet<SourceId>,
  current: ResolvedNode
): List<ResolvedNode> {
  if (!current.node.basedOn) {
    return List<ResolvedNode>();
  }

  const pastVersion =
    lookupNode(graph, current.node.basedOn, current.ref.sourceId) ??
    lookupNode(graph, current.node.basedOn, graph.localSourceId);
  if (!pastVersion) {
    return List<ResolvedNode>();
  }

  const visiblePast = isVisibleVersion(pastVersion, visibleAuthors)
    ? List<ResolvedNode>([pastVersion])
    : List<ResolvedNode>();

  return visiblePast
    .concat(getPastVersions(graph, visibleAuthors, pastVersion))
    .toList();
}

function getFutureVersions(
  graph: GraphLookup,
  visibleAuthors: ImmutableSet<SourceId>,
  current: ResolvedNode,
  excludedIDs: ImmutableSet<ID> = ImmutableSet<ID>(),
  visited: ImmutableSet<ID> = ImmutableSet<ID>([current.node.id])
): List<ResolvedNode> {
  const futureIDs = List([
    ...(graph.graphIndex.basedOnIndex.get(current.node.id) || []),
  ] as ID[]).filter((nextID) => !visited.has(nextID));

  return futureIDs
    .reduce((collected, futureID) => {
      const futureVersion = lookupNode(graph, futureID, graph.localSourceId);
      if (!futureVersion) {
        return collected;
      }

      const visibleFuture =
        isVisibleVersion(futureVersion, visibleAuthors) &&
        !excludedIDs.has(futureVersion.node.id)
          ? List<ResolvedNode>([futureVersion])
          : List<ResolvedNode>();

      return collected
        .concat(visibleFuture)
        .concat(
          getFutureVersions(
            graph,
            visibleAuthors,
            futureVersion,
            excludedIDs,
            visited.add(futureID) as ImmutableSet<ID>
          )
        )
        .toList();
    }, List<ResolvedNode>())
    .toList();
}

function getVersions(
  graph: GraphLookup,
  visibleAuthors: ImmutableSet<SourceId>,
  current: ResolvedNode
): List<ResolvedNode> {
  const pastVersions = getPastVersions(graph, visibleAuthors, current);
  const lineageNodes = List<ResolvedNode>([current]).concat(pastVersions);
  const lineageIDs = lineageNodes
    .map((resolved) => resolved.node.id as ID)
    .toSet() as ImmutableSet<ID>;
  const futureVersions = lineageNodes.reduce(
    (collected, lineageNode) =>
      collected
        .concat(
          getFutureVersions(graph, visibleAuthors, lineageNode, lineageIDs)
        )
        .toList(),
    List<ResolvedNode>()
  );

  return pastVersions
    .concat(futureVersions)
    .groupBy((resolved) => resolved.node.id)
    .map((group) => group.first())
    .valueSeq()
    .filter((resolved): resolved is ResolvedNode => resolved !== undefined)
    .sortBy((resolved) => -resolved.node.updated)
    .toList();
}

export function getAlternativeFooterData(
  graph: GraphLookup,
  visibleAuthors: ImmutableSet<SourceId>,
  filterTypes: FooterTypeFilters,
  current?: ResolvedNode,
  showSuggestions: boolean = true,
  snapshotNodes: SnapshotNodes = Map<string, Map<string, GraphNode>>()
): AlternativeFooterResult {
  const { knowledgeDBs } = graph;
  if (!current || !filterTypes || filterTypes.length === 0) {
    return EMPTY_ALTERNATIVE_FOOTER_RESULT;
  }
  const currentNode = current.node;

  const suggestionsEnabled =
    showSuggestions && filterTypes.includes("suggestions");
  const versionsEnabled = filterTypes.includes("versions");

  if (!suggestionsEnabled && !versionsEnabled) {
    return EMPTY_ALTERNATIVE_FOOTER_RESULT;
  }

  const currentNodeChildren = getChildNodes(
    knowledgeDBs,
    currentNode,
    current.ref.sourceId
  );
  const currentOriginKeys = currentNodeChildren
    .map((item) => (item.basedOn ?? item.id) as string)
    .toSet();
  const currentFilteredOutOriginKeys = currentNodeChildren
    .filter((item) => !itemPassesFilters(item, filterTypes))
    .map((item) => (item.basedOn ?? item.id) as string)
    .toSet();
  const declinedTargetIDs = currentNodeChildren
    .filter((item) => item.relevance === "not_relevant")
    .flatMap((item) => getAllLinks(item).map((link) => link.targetID))
    .toSet();
  const existingCrefTargetIDs = currentNodeChildren
    .flatMap((item) => getAllLinks(item).map((link) => link.targetID))
    .toSet();

  const coveredTargetIDs = declinedTargetIDs.union(existingCrefTargetIDs);
  const isCoveredItem = (item: GraphNode): boolean => {
    if (currentOriginKeys.has((item.basedOn ?? item.id) as string)) {
      return true;
    }
    return getAllLinks(item).some((link) =>
      coveredTargetIDs.has(link.targetID)
    );
  };

  const versionNodes = getVersions(graph, visibleAuthors, current);
  const versionDiffs = versionNodes
    .map((version) =>
      computeVersionDiff(snapshotNodes, knowledgeDBs, current, version)
    )
    .filter((diff): diff is VersionDiff => diff !== undefined);
  // Direction-less diffs (no baseline) propose nothing: "the other version
  // has X" is indistinguishable from "you deleted X".
  const baselinedDiffs = versionDiffs.filter((diff) => !diff.direct);

  const allSuggestionCandidates = suggestionsEnabled
    ? baselinedDiffs
        .filter(({ node }) => !declinedTargetIDs.has(node.id))
        .reduce(
          (acc, { additions }) =>
            additions
              .filter((item) => itemPassesFilters(item, filterTypes))
              .reduce((itemAcc, item) => {
                const originKey = (item.basedOn ?? item.id) as string;
                if (isCoveredItem(item) || itemAcc.has(originKey)) {
                  return itemAcc;
                }
                return itemAcc.set(originKey, item.id);
              }, acc),
          OrderedMap<string, ID>()
        )
    : OrderedMap<string, ID>();

  const suggestions = allSuggestionCandidates
    .valueSeq()
    .take(suggestionSettings.maxSuggestions)
    .toList();

  const displayedSuggestionOriginKeys = allSuggestionCandidates
    .keySeq()
    .take(suggestionSettings.maxSuggestions)
    .toSet();

  const versionMetas = versionsEnabled
    ? versionDiffs
        .filter(({ node }) => !existingCrefTargetIDs.has(node.id))
        .reduce((acc, { node, additions, deletions, textDiffers, direct }) => {
          if (direct) {
            // The text difference counts into the displayed ± (J1/J3 law:
            // silent when they agree, ±n when they differ) — a bare [V]
            // with hidden differences would lie.
            const directCount =
              additions.size + deletions.size + (textDiffers ? 1 : 0);
            return directCount > 0
              ? acc.set(node.id, {
                  updated: node.updated,
                  addCount: additions.size + (textDiffers ? 1 : 0),
                  removeCount: deletions.size,
                  direct: true,
                })
              : acc;
          }
          const addCount = additions.filter(
            (item) =>
              itemPassesFilters(item, filterTypes) && !isCoveredItem(item)
          ).size;
          const uncoveredAddCount =
            addCount -
            additions.filter(
              (item) =>
                itemPassesFilters(item, filterTypes) &&
                !isCoveredItem(item) &&
                displayedSuggestionOriginKeys.has(
                  (item.basedOn ?? item.id) as string
                )
            ).size;
          const removeCount = deletions.filter(
            (item) =>
              currentOriginKeys.has(item.id as string) &&
              !currentFilteredOutOriginKeys.has(item.id as string)
          ).size;
          if (uncoveredAddCount <= 0 && removeCount <= 0) {
            return acc;
          }
          return acc.set(node.id, {
            updated: node.updated,
            addCount,
            removeCount,
          });
        }, Map<ID, NonNullable<Row["versionMeta"]>>())
    : Map<ID, NonNullable<Row["versionMeta"]>>();

  // Renames travel as their own suggestion rows (strikethrough old, new
  // beside it), not inside the [V] counts.
  const renames = versionDiffs
    .filter(
      (diff) =>
        diff.textDrift !== undefined &&
        diff.baselineSnapshotId !== undefined &&
        diff.baselineNodeId !== undefined
    )
    .map((diff) => ({
      versionId: diff.node.id,
      theirs: diff.textDrift as string,
      sourceId: current.ref.sourceId,
      snapshotId: diff.baselineSnapshotId as string,
      baselineNodeId: diff.baselineNodeId as ID,
    }))
    .toList();

  return { suggestions, versionMetas, renames };
}
