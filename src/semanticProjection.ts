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
import { findReciprocalLinkItem } from "./buildReferenceRow";
import {
  GraphLookup,
  ResolvedNode,
  getNodeInSource,
  graphLookupFromData,
  linkSpeaker,
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

function incomingFileLinkSourceRefs(
  graphIndex: GraphIndex,
  rootFilePath: string | undefined,
  rootAuthor: SourceId | undefined
): NodeRef[] {
  if (!rootFilePath || !rootAuthor) return [];
  const key = fileLinkIndexKey(rootAuthor, rootFilePath);
  return graphIndex.incomingFileLinks.get(key) ?? [];
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

function uniqueRefs(refs: NodeRef[]): NodeRef[] {
  const seen = new globalThis.Set<string>();
  return refs.filter((ref) => {
    const key = nodeRefKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pulledSourceOrder(data: Data, sourceId: SourceId): number | undefined {
  const indexes = [...(data.pull?.matchedSourceIdsByPaneId.values() ?? [])]
    .map((sourceIds) => sourceIds.indexOf(sourceId))
    .filter((index) => index >= 0);
  return indexes.length === 0 ? undefined : Math.min(...indexes);
}

export function getIncomingCrefsForNode(
  data: Data,
  visibleAuthors: ImmutableSet<SourceId>,
  currentNodeID: ID | undefined,
  itemsSourceId: SourceId,
  currentItems?: List<GraphNode>,
  currentNodeFilePath?: string
): List<NodeRef> {
  const graph = graphLookupFromData(data);
  const { graphIndex, knowledgeDBs } = graph;
  const current = currentItems || List<GraphNode>();
  const firstCurrent = current.first();
  const target = (() => {
    if (currentNodeID) {
      return getNodeInSource(graph, {
        sourceId: itemsSourceId,
        id: currentNodeID,
      });
    }
    return firstCurrent
      ? {
          ref: { sourceId: itemsSourceId, id: firstCurrent.id },
          node: firstCurrent,
        }
      : undefined;
  })();

  const graphLinkRefs = (() => {
    if (!currentNodeID) {
      return [];
    }
    const sourceScopedRefs =
      graphIndex.incomingCrefsByTarget.get(
        nodeRefKey({ sourceId: itemsSourceId, id: currentNodeID })
      ) ?? [];
    const unscopedRefs = graphIndex.incomingCrefs.get(currentNodeID) ?? [];
    return uniqueRefs([...sourceScopedRefs, ...unscopedRefs]);
  })();
  const graphLinkSourceNodes = graphLinkRefs
    .map((ref) => getNodeInSource(graph, ref))
    .filter((node): node is ResolvedNode => node !== undefined);
  const fileLinkSourceNodes = incomingFileLinkSourceRefs(
    graphIndex,
    currentNodeFilePath,
    itemsSourceId
  )
    .map((ref) => getNodeInSource(graph, ref))
    .filter((node): node is ResolvedNode => node !== undefined);
  const sourceNodes = uniqueNodes([
    ...graphLinkSourceNodes,
    ...fileLinkSourceNodes,
  ])
    .filter(
      (source) =>
        !isCalendarEntryPlacement(source.node, parentOf(graph, source)?.node)
    )
    .filter(
      (source) =>
        target === undefined ||
        findReciprocalLinkItem(graph, data, source, target) === undefined
    )
    .map((source) => linkSpeaker(graph, source));
  const seenIncomingIds = new globalThis.Set<ID>();
  const visibleSourceNodes = uniqueNodes(sourceNodes)
    .filter(({ ref }) => visibleAuthors.has(ref.sourceId))
    .filter(
      ({ ref }) =>
        target === undefined ||
        ref.sourceId !== target.ref.sourceId ||
        ref.id !== target.ref.id
    )
    .filter(
      ({ ref, node }) =>
        node.systemRole !== LOG_ROOT_ROLE &&
        !isInSystemRoot(knowledgeDBs, node, ref.sourceId, LOG_ROOT_ROLE)
    )
    .sort((left, right) => {
      const leftPullOrder = pulledSourceOrder(data, left.ref.sourceId);
      const rightPullOrder = pulledSourceOrder(data, right.ref.sourceId);
      if (leftPullOrder !== undefined && rightPullOrder !== undefined) {
        return leftPullOrder - rightPullOrder;
      }
      if (leftPullOrder !== undefined) {
        return 1;
      }
      if (rightPullOrder !== undefined) {
        return -1;
      }
      return nodePathLabel(
        knowledgeDBs,
        left.node,
        left.ref.sourceId
      ).localeCompare(
        nodePathLabel(knowledgeDBs, right.node, right.ref.sourceId)
      );
    })
    .filter(({ ref }) => {
      if (seenIncomingIds.has(ref.id)) {
        return false;
      }
      seenIncomingIds.add(ref.id);
      return true;
    });

  return List(
    visibleSourceNodes.map(({ ref }) => ({
      sourceId: ref.sourceId,
      id: ref.id,
    }))
  );
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

  const sameIdSuggestionCandidates = suggestionsEnabled
    ? lookupNodes(graph, currentNode.id)
        .filter(
          ({ ref }) =>
            visibleAuthors.has(ref.sourceId) &&
            ref.sourceId !== current.ref.sourceId
        )
        .reduce((acc, sourceNode) => {
          return getChildNodes(
            knowledgeDBs,
            sourceNode.node,
            sourceNode.ref.sourceId
          )
            .filter((item) => itemPassesFilters(item, filterTypes))
            .reduce((itemAcc, item) => {
              const originKey = (item.basedOn ?? item.id) as string;
              if (isCoveredItem(item) || itemAcc.has(originKey)) {
                return itemAcc;
              }
              return itemAcc.set(originKey, item.id);
            }, acc);
        }, OrderedMap<string, ID>())
    : OrderedMap<string, ID>();

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
        .merge(sameIdSuggestionCandidates)
    : sameIdSuggestionCandidates;

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
