import { List, Map, OrderedMap, Set as ImmutableSet } from "immutable";
import {
  EMPTY_SEMANTIC_ID,
  getChildNodes,
  isSearchId,
  parseSearchId,
  itemPassesFilters,
  getNodeSemanticID,
  getSemanticID,
  getNodeContext,
  getNodeText,
  getNode,
  resolveNode,
  isRefNode,
} from "./core/connections";
import { getBlockLinkTarget } from "./core/nodeSpans";
import { fileLinkIndexKey, resolveLinkPath } from "./core/linkPath";
import { suggestionSettings } from "./core/constants";
import { LOG_ROOT_ROLE } from "./core/systemRoots";
import { computeVersionDiff } from "./core/snapshotBaseline";
import { documentKeyOf, type Document } from "./core/Document";
import {
  GraphLookup,
  ResolvedNode,
  getNodeInSource,
  lookupNode,
  resolveBlockLinkTarget,
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
  nodeID: LongID;
  sourceId: SourceId;
  context: Context;
  updated: number;
};

function getFallbackSemanticText(semanticID?: ID): string {
  if (!semanticID) {
    return "";
  }
  if (semanticID === EMPTY_SEMANTIC_ID) {
    return "";
  }
  if (isSearchId(semanticID)) {
    return parseSearchId(semanticID) || "";
  }
  return "";
}

export function getTextForSemanticID(
  knowledgeDBs: KnowledgeDBs,
  semanticID: ID,
  author: PublicKey
): string | undefined {
  if (isSearchId(semanticID)) {
    return parseSearchId(semanticID) || "";
  }

  const directNode = getNode(knowledgeDBs, semanticID, author);
  if (directNode) {
    if (isRefNode(directNode)) {
      return undefined;
    }
    return getNodeText(directNode);
  }

  const fallbackText = getFallbackSemanticText(semanticID);
  return fallbackText !== "" || semanticID === EMPTY_SEMANTIC_ID
    ? fallbackText
    : undefined;
}

function getContextKey(context: Context): string {
  return context.join(":");
}

function contextsSemanticallyMatch(
  leftContext: Context,
  rightContext: Context
): boolean {
  return getContextKey(leftContext) === getContextKey(rightContext);
}

function getSemanticCandidates(
  graph: GraphLookup,
  semanticKey: string
): List<GraphNode> {
  const refs = graph.graphIndex.semanticRefs.get(semanticKey);
  const nodes = refs
    ? refs.map((ref) => getNodeInSource(graph, ref)?.node)
    : [...(graph.graphIndex.semantic.get(semanticKey) ?? [])].map(
        (nodeID) => lookupNode(graph, nodeID, graph.localSourceId)?.node
      );

  return List(
    nodes
      .filter((node): node is GraphNode => node !== undefined)
      .sort((left, right) => right.updated - left.updated)
  );
}

export function findRefsToNode(
  graph: GraphLookup,
  semanticID: ID,
  filterContext?: Context,
  targetAuthor?: PublicKey,
  targetRoot?: ID
): List<ReferencedByRef> {
  const { knowledgeDBs } = graph;
  const targetSemanticKey = semanticID;
  const resolvedRefs = getSemanticCandidates(graph, targetSemanticKey)
    .filter((node) => !isSearchId(getSemanticID(knowledgeDBs, node)))
    .filter(
      (node) =>
        !getNodeContext(knowledgeDBs, node).some((id) => isSearchId(id as ID))
    )
    .map((node) => ({
      ref: {
        nodeID: node.id,
        sourceId: node.author,
        context: getNodeContext(knowledgeDBs, node),
        updated: node.updated,
      },
      author: node.author,
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
            : contextsSemanticallyMatch(ref.context, filterContext)
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

function contextKeyForCref(
  knowledgeDBs: KnowledgeDBs,
  crefID: ID,
  effectiveAuthor: PublicKey
): string | undefined {
  const targetNode = resolveNode(
    knowledgeDBs,
    getNode(knowledgeDBs, crefID, effectiveAuthor)
  );
  if (!targetNode) {
    return undefined;
  }
  return getContextKey(getNodeContext(knowledgeDBs, targetNode));
}

function coveredContextKeys(
  knowledgeDBs: KnowledgeDBs,
  crefIDs: List<ID>,
  effectiveAuthor: PublicKey
): ImmutableSet<string> {
  return crefIDs.reduce((acc, crefID) => {
    const key = contextKeyForCref(knowledgeDBs, crefID, effectiveAuthor);
    return key !== undefined ? acc.add(key) : acc;
  }, ImmutableSet<string>());
}

function sourceDocumentKey(
  knowledgeDBs: KnowledgeDBs,
  documents: Map<string, Document> | undefined,
  node: GraphNode
): string | undefined {
  const rootNode =
    node.id === node.root
      ? node
      : getNode(knowledgeDBs, node.root, node.author);
  if (!rootNode?.docId) {
    return undefined;
  }
  const key = documentKeyOf(rootNode.author, rootNode.docId);
  return documents?.has(key) ? key : undefined;
}

function documentLinkerRefs(
  graphIndex: GraphIndex,
  effectiveAuthor: PublicKey,
  candidateDocument: Document,
  currentNodeFilePath: string | undefined
): NodeRef[] {
  const lookupPaths = ImmutableSet<string>([
    ...(candidateDocument.filePath ? [candidateDocument.filePath] : []),
    candidateDocument.docId,
    ...(currentNodeFilePath
      ? [resolveLinkPath(candidateDocument.docId, currentNodeFilePath)]
      : []),
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
  author: PublicKey,
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
    node.author,
    subtreeRootIDs,
    visited.add(nodeID)
  );
}

function subtreeLinksToDocument(
  graph: GraphLookup,
  documents: Map<string, Document> | undefined,
  candidate: GraphNode,
  currentNodeID: LongID | undefined,
  currentNodeFilePath: string | undefined,
  effectiveAuthor: PublicKey,
  subtreeRootIDs: ImmutableSet<ID>
): boolean {
  const { graphIndex, knowledgeDBs } = graph;
  const key = sourceDocumentKey(knowledgeDBs, documents, candidate);
  const candidateDocument = key === undefined ? undefined : documents?.get(key);
  if (!candidateDocument) {
    return false;
  }
  return documentLinkerRefs(
    graphIndex,
    effectiveAuthor,
    candidateDocument,
    currentNodeFilePath
  ).some((ref) => {
    const linker = getNodeInSource(graph, ref)?.node;
    return (
      linker !== undefined &&
      linker.id !== currentNodeID &&
      isWithinSubtree(
        knowledgeDBs,
        linker.id,
        linker.author,
        subtreeRootIDs,
        ImmutableSet<ID>()
      )
    );
  });
}

function isInSystemRoot(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode | undefined,
  systemRole: RootSystemRole
): boolean {
  if (!node) {
    return false;
  }
  const rootNode = getNode(knowledgeDBs, node.root, node.author);
  return rootNode?.systemRole === systemRole;
}

export function deduplicateRefsByContext(
  refs: List<ReferencedByRef>,
  knowledgeDBs: KnowledgeDBs,
  preferAuthor?: PublicKey
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
            const isOther =
              preferAuthor && node?.author !== preferAuthor ? 1 : 0;
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
  rootAuthor: PublicKey | undefined
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
  const item = resolvedItem?.node;
  if (!item || !resolvedItem) return undefined;
  return item.parent
    ? getNodeInSource(graph, {
        sourceId: resolvedItem.ref.sourceId,
        id: item.parent,
      }) ?? resolvedItem
    : resolvedItem;
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

export function getIncomingCrefsForDocument(
  graph: GraphLookup,
  visibleAuthors: ImmutableSet<PublicKey>,
  document: Pick<Document, "author" | "filePath">,
  effectiveAuthor: PublicKey
): List<NodeRef> {
  const { graphIndex, knowledgeDBs } = graph;
  const sourceRefs = incomingFileLinkSourceRefs(
    graphIndex,
    document.filePath,
    document.author
  );
  const refs = List(
    sourceRefs
      .map((ref) => getNodeInSource(graph, ref))
      .filter((node): node is ResolvedNode => node !== undefined)
      .filter(({ node }) => visibleAuthors.has(node.author))
      .filter(
        ({ node }) =>
          node.systemRole !== LOG_ROOT_ROLE &&
          !isInSystemRoot(knowledgeDBs, node, LOG_ROOT_ROLE)
      )
      .map(({ ref, node }) => ({
        nodeID: node.id,
        sourceId: ref.sourceId,
        context: getNodeContext(knowledgeDBs, node),
        updated: node.updated,
      }))
  );

  return deduplicateRefsByContext(refs, knowledgeDBs, effectiveAuthor)
    .sortBy((ref) => `${-ref.updated}:${ref.context.join(":")}`)
    .map((ref) => ({ sourceId: ref.sourceId, id: ref.nodeID }))
    .toList();
}

export function getIncomingCrefsForNode(
  graph: GraphLookup,
  visibleAuthors: ImmutableSet<PublicKey>,
  parentNodeID: LongID | undefined,
  currentNodeID: LongID | undefined,
  effectiveAuthor: PublicKey,
  currentItems?: List<GraphNode>,
  currentNodeFilePath?: string,
  currentNodeAuthor?: PublicKey,
  documents?: Map<string, Document>
): List<NodeRef> {
  const { graphIndex, knowledgeDBs } = graph;
  const current = currentItems || List<GraphNode>();

  const graphLinkRefs = (() => {
    if (!currentNodeID) {
      return [];
    }
    const sourceScopedRefs = currentNodeAuthor
      ? graphIndex.incomingCrefsByTarget.get(
          nodeRefKey({ sourceId: currentNodeAuthor, id: currentNodeID })
        ) ?? []
      : [];
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
    currentNodeAuthor
  )
    .map((ref) => getNodeInSource(graph, ref))
    .filter((node): node is ResolvedNode => node !== undefined);
  const sourceNodes = uniqueNodes([
    ...graphLinkSourceNodes,
    ...fileLinkSourceNodes,
  ]);
  if (sourceNodes.length === 0) {
    return List<NodeRef>();
  }

  const outgoingCrefIDs = current
    .filter(isRefNode)
    .map((item) => item.id)
    .toList();
  const covered = coveredContextKeys(
    knowledgeDBs,
    outgoingCrefIDs,
    effectiveAuthor
  );
  const outgoingTargetRelIDs = current.reduce((acc, item) => {
    const targetNode = isRefNode(item)
      ? resolveBlockLinkTarget(graph, {
          ref: { sourceId: item.author, id: item.id },
          node: item,
        })?.node
      : resolveNode(knowledgeDBs, item);
    return targetNode ? acc.add(targetNode.id) : acc;
  }, ImmutableSet<LongID>());
  const subtreeRootIDs = ImmutableSet<ID>(current.map((item) => item.id)).union(
    currentNodeID ? [currentNodeID] : []
  );

  const refs = List(
    sourceNodes
      .filter(({ node }) => visibleAuthors.has(node.author))
      .filter(({ node }) => node.id !== parentNodeID)
      .filter(({ node }) => node.id !== currentNodeID)
      .filter(
        ({ node }) =>
          !subtreeLinksToDocument(
            graph,
            documents,
            node,
            currentNodeID,
            currentNodeFilePath,
            effectiveAuthor,
            subtreeRootIDs
          )
      )
      .filter(
        ({ node }) =>
          node.systemRole !== LOG_ROOT_ROLE &&
          !isInSystemRoot(knowledgeDBs, node, LOG_ROOT_ROLE)
      )
      .filter(({ node }) => !outgoingTargetRelIDs.has(node.id))
      .map(({ ref, node }) => ({
        nodeID: node.id,
        sourceId: ref.sourceId,
        context: getNodeContext(knowledgeDBs, node),
        updated: node.updated,
      }))
  );

  const deduped = deduplicateRefsByContext(refs, knowledgeDBs, effectiveAuthor);
  return deduped
    .filter((ref) => !covered.has(getRefContextKey(knowledgeDBs, ref)))
    .sortBy((ref) => `${-ref.updated}:${ref.context.join(":")}`)
    .map((ref) => ({ sourceId: ref.sourceId, id: ref.nodeID }))
    .toList();
}

type AlternativeFooterResult = {
  suggestions: List<ID>;
  versionMetas: Map<LongID, NonNullable<Row["versionMeta"]>>;
};

const EMPTY_ALTERNATIVE_FOOTER_RESULT: AlternativeFooterResult = {
  suggestions: List<ID>(),
  versionMetas: Map<LongID, NonNullable<Row["versionMeta"]>>(),
};

function isVisibleVersion(
  node: GraphNode,
  visibleAuthors: ImmutableSet<PublicKey>
): boolean {
  return !isRefNode(node) && visibleAuthors.has(node.author);
}

function getPastVersions(
  graph: GraphLookup,
  visibleAuthors: ImmutableSet<PublicKey>,
  currentNode: GraphNode
): List<GraphNode> {
  if (!currentNode.basedOn) {
    return List<GraphNode>();
  }

  const pastVersion =
    lookupNode(graph, currentNode.basedOn, currentNode.author)?.node ??
    lookupNode(graph, currentNode.basedOn, graph.localSourceId)?.node;
  if (!pastVersion) {
    return List<GraphNode>();
  }

  const visiblePast = isVisibleVersion(pastVersion, visibleAuthors)
    ? List<GraphNode>([pastVersion])
    : List<GraphNode>();

  return visiblePast
    .concat(getPastVersions(graph, visibleAuthors, pastVersion))
    .toList();
}

function getFutureVersions(
  graph: GraphLookup,
  visibleAuthors: ImmutableSet<PublicKey>,
  currentNode: GraphNode,
  excludedIDs: ImmutableSet<LongID> = ImmutableSet<LongID>(),
  visited: ImmutableSet<LongID> = ImmutableSet<LongID>([currentNode.id])
): List<GraphNode> {
  const futureIDs = List([
    ...(graph.graphIndex.basedOnIndex.get(currentNode.id) || []),
  ] as LongID[]).filter((nextID) => !visited.has(nextID));

  return futureIDs
    .reduce((collected, futureID) => {
      const futureVersion = lookupNode(
        graph,
        futureID,
        graph.localSourceId
      )?.node;
      if (!futureVersion) {
        return collected;
      }

      const visibleFuture =
        isVisibleVersion(futureVersion, visibleAuthors) &&
        !excludedIDs.has(futureVersion.id)
          ? List<GraphNode>([futureVersion])
          : List<GraphNode>();

      return collected
        .concat(visibleFuture)
        .concat(
          getFutureVersions(
            graph,
            visibleAuthors,
            futureVersion,
            excludedIDs,
            visited.add(futureID) as ImmutableSet<LongID>
          )
        )
        .toList();
    }, List<GraphNode>())
    .toList();
}

function getVersions(
  graph: GraphLookup,
  visibleAuthors: ImmutableSet<PublicKey>,
  currentNode: GraphNode
): List<GraphNode> {
  const pastVersions = getPastVersions(graph, visibleAuthors, currentNode);
  const lineageNodes = List<GraphNode>([currentNode]).concat(pastVersions);
  const lineageIDs = lineageNodes
    .map((node) => node.id as LongID)
    .toSet() as ImmutableSet<LongID>;
  const futureVersions = lineageNodes.reduce(
    (collected, lineageNode) =>
      collected
        .concat(
          getFutureVersions(graph, visibleAuthors, lineageNode, lineageIDs)
        )
        .toList(),
    List<GraphNode>()
  );

  return pastVersions
    .concat(futureVersions)
    .groupBy((node) => node.id)
    .map((group) => group.first())
    .valueSeq()
    .filter((node): node is GraphNode => node !== undefined)
    .sortBy((node) => -node.updated)
    .toList();
}

export function getAlternativeFooterData(
  graph: GraphLookup,
  visibleAuthors: ImmutableSet<PublicKey>,
  filterTypes: FooterTypeFilters,
  currentNode?: GraphNode,
  showSuggestions: boolean = true,
  snapshotNodes: SnapshotNodes = Map<string, Map<string, GraphNode>>()
): AlternativeFooterResult {
  const { knowledgeDBs } = graph;
  if (!currentNode || !filterTypes || filterTypes.length === 0) {
    return EMPTY_ALTERNATIVE_FOOTER_RESULT;
  }

  const suggestionsEnabled =
    showSuggestions && filterTypes.includes("suggestions");
  const versionsEnabled = filterTypes.includes("versions");

  if (!suggestionsEnabled && !versionsEnabled) {
    return EMPTY_ALTERNATIVE_FOOTER_RESULT;
  }

  const currentNodeChildren = getChildNodes(
    knowledgeDBs,
    currentNode,
    currentNode.author
  );
  const currentOriginKeys = currentNodeChildren
    .map((item) => (item.basedOn ?? item.id) as string)
    .toSet();
  const currentSemanticIDs = currentNodeChildren
    .map((item) => getNodeSemanticID(item) as string)
    .toSet();
  const currentFilteredOutOriginKeys = currentNodeChildren
    .filter((item) => !itemPassesFilters(item, filterTypes))
    .map((item) => (item.basedOn ?? item.id) as string)
    .toSet();
  const declinedTargetIDs = currentNodeChildren
    .filter((item) => isRefNode(item) && item.relevance === "not_relevant")
    .flatMap((item) => {
      const t = getBlockLinkTarget(item);
      return t ? [t] : [];
    })
    .toSet();
  const existingCrefTargetIDs = currentNodeChildren
    .map((item) => getBlockLinkTarget(item))
    .filter((id): id is LongID => !!id)
    .toSet();

  const versionNodes = getVersions(graph, visibleAuthors, currentNode);
  const versionDiffs = versionNodes.map((versionNode) =>
    computeVersionDiff(snapshotNodes, knowledgeDBs, currentNode, versionNode)
  );

  const allSuggestionCandidates = suggestionsEnabled
    ? versionDiffs
        .filter(({ node }) => !declinedTargetIDs.has(node.id))
        .reduce(
          (acc, { additions }) =>
            additions
              .filter((item) => itemPassesFilters(item, filterTypes))
              .reduce((itemAcc, item) => {
                const originKey = (item.basedOn ?? item.id) as string;
                if (
                  currentOriginKeys.has(originKey) ||
                  currentSemanticIDs.has(getNodeSemanticID(item) as string) ||
                  itemAcc.has(originKey)
                ) {
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
        .reduce((acc, { node, additions, deletions }) => {
          const addCount = additions.filter(
            (item) =>
              itemPassesFilters(item, filterTypes) &&
              !currentOriginKeys.has((item.basedOn ?? item.id) as string) &&
              !currentSemanticIDs.has(getNodeSemanticID(item) as string)
          ).size;
          const uncoveredAddCount =
            addCount -
            additions.filter(
              (item) =>
                itemPassesFilters(item, filterTypes) &&
                !currentOriginKeys.has((item.basedOn ?? item.id) as string) &&
                !currentSemanticIDs.has(getNodeSemanticID(item) as string) &&
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
        }, Map<LongID, NonNullable<Row["versionMeta"]>>())
    : Map<LongID, NonNullable<Row["versionMeta"]>>();

  return { suggestions, versionMetas };
}
