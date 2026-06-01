import { List, Map, OrderedMap, Set as ImmutableSet } from "immutable";
import {
  EMPTY_SEMANTIC_ID,
  getChildNodes,
  shortID,
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
import {
  GraphDataFields,
  filePathKeyOf,
  getNodeByKey,
  getNodeFromGraphData,
  getSourceNodeCandidates,
  nodeKeyOf,
  nodeKeyOfNode,
} from "./core/graphData";
import {
  getBlockFileLinkPath,
  getBlockLinkTarget,
  isBlockFileLink,
  nodeText,
} from "./core/nodeSpans";
import { resolveLinkPath } from "./core/linkPath";
import { suggestionSettings } from "./core/constants";
import { LOG_ROOT_ROLE } from "./core/systemRoots";
import { computeVersionDiff } from "./core/snapshotBaseline";
import { documentKeyOf, type Document } from "./core/Document";

type FooterTypeFilters = (
  | Relevance
  | "suggestions"
  | "versions"
  | "incoming"
  | "contains"
)[];

type ReferencedByRef = {
  nodeID: LongID;
  context: Context;
  updated: number;
  sortDepth?: number;
};

function getFallbackSemanticText(semanticID?: ID): string {
  if (!semanticID) {
    return "";
  }
  const localID = shortID(semanticID as ID) as ID;
  if (localID === EMPTY_SEMANTIC_ID) {
    return "";
  }
  if (isSearchId(localID)) {
    return parseSearchId(localID) || "";
  }
  return "";
}

function getConcreteNodesForSemanticID(
  knowledgeDBs: KnowledgeDBs,
  semanticID: ID,
  author: PublicKey
): GraphNode[] {
  if (isSearchId(semanticID as ID)) {
    return [];
  }

  const directNode = getNode(knowledgeDBs, semanticID, author);
  if (directNode) {
    if (isRefNode(directNode)) {
      return [];
    }
    return [directNode];
  }

  const localID = shortID(semanticID as ID);
  const preferredAuthor = author;
  const preferredDB = knowledgeDBs.get(preferredAuthor);
  const otherDBs = knowledgeDBs
    .filter((_, pk) => pk !== preferredAuthor)
    .valueSeq()
    .toArray();
  const candidateDBs = [preferredDB, ...otherDBs].filter(
    (db): db is KnowledgeData => db !== undefined
  );

  return List(
    candidateDBs.flatMap((db) =>
      db.nodes
        .valueSeq()
        .filter(
          (node) =>
            !isRefNode(node) &&
            (shortID(getNodeSemanticID(node)) === localID ||
              nodeText(node) === localID)
        )
        .toArray()
    )
  )
    .sort((left, right) => {
      const leftExact = shortID(getNodeSemanticID(left)) === localID ? 0 : 1;
      const rightExact = shortID(getNodeSemanticID(right)) === localID ? 0 : 1;
      if (leftExact !== rightExact) {
        return leftExact - rightExact;
      }
      const leftPreferred = left.author === preferredAuthor ? 0 : 1;
      const rightPreferred = right.author === preferredAuthor ? 0 : 1;
      if (leftPreferred !== rightPreferred) {
        return leftPreferred - rightPreferred;
      }
      return right.updated - left.updated;
    })
    .toArray();
}

function getConcreteNodeForSemanticID(
  knowledgeDBs: KnowledgeDBs,
  semanticID: ID,
  author: PublicKey
): GraphNode | undefined {
  return getConcreteNodesForSemanticID(knowledgeDBs, semanticID, author)[0];
}

export function getTextForSemanticID(
  knowledgeDBs: KnowledgeDBs,
  semanticID: ID,
  author: PublicKey
): string | undefined {
  const localID = shortID(semanticID as ID) as ID;
  if (isSearchId(localID)) {
    return parseSearchId(localID) || "";
  }

  const directNode = getNode(knowledgeDBs, semanticID, author);
  if (directNode) {
    if (isRefNode(directNode)) {
      return undefined;
    }
    return getNodeText(directNode);
  }

  const node = getConcreteNodeForSemanticID(knowledgeDBs, semanticID, author);
  const text = getNodeText(node);
  if (text !== undefined) {
    return text;
  }

  const fallbackText = getFallbackSemanticText(semanticID);
  return fallbackText !== "" || localID === EMPTY_SEMANTIC_ID
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
  graphData: GraphDataFields,
  semanticKey: string
): List<GraphNode> {
  const nodeKeys = graphData.semantic.get(semanticKey);
  if (!nodeKeys) {
    return List<GraphNode>();
  }

  return List(
    [...nodeKeys]
      .map((nodeKey) => getNodeByKey(graphData, nodeKey))
      .filter((node): node is GraphNode => node !== undefined)
      .sort((left, right) => right.updated - left.updated)
  );
}

export function findRefsToNode(
  knowledgeDBs: KnowledgeDBs,
  graphData: GraphDataFields,
  semanticID: ID,
  filterContext?: Context,
  targetAuthor?: PublicKey,
  targetRoot?: ID
): List<ReferencedByRef> {
  const targetSemanticKey =
    targetAuthor && targetRoot ? semanticID : (shortID(semanticID as ID) as ID);
  const resolvedRefs = getSemanticCandidates(graphData, targetSemanticKey)
    .filter((node) => !isSearchId(getSemanticID(knowledgeDBs, node)))
    .filter(
      (node) =>
        !getNodeContext(knowledgeDBs, node).some((id) => isSearchId(id as ID))
    )
    .map((node) => ({
      ref: {
        nodeID: node.id,
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

function resolveCrefTargetNode(
  knowledgeDBs: KnowledgeDBs,
  graphData: GraphDataFields,
  source: GraphNode | undefined,
  effectiveAuthor: PublicKey
): GraphNode | undefined {
  const targetID = getBlockLinkTarget(source);
  if (!targetID) {
    return resolveNode(knowledgeDBs, source);
  }
  return (
    getNodeFromGraphData(
      graphData,
      targetID as ID,
      effectiveAuthor as SourceId
    ) ??
    getSourceNodeCandidates(graphData, targetID as ID).find(
      (candidate) => candidate.sourceId !== effectiveAuthor
    )?.node ??
    resolveNode(knowledgeDBs, source)
  );
}

function contextKeyForCref(
  knowledgeDBs: KnowledgeDBs,
  graphData: GraphDataFields,
  crefID: ID,
  effectiveAuthor: PublicKey
): string | undefined {
  const source =
    getNode(knowledgeDBs, crefID, effectiveAuthor) ??
    getNodeFromGraphData(graphData, crefID, effectiveAuthor as SourceId);
  const targetNode = resolveCrefTargetNode(
    knowledgeDBs,
    graphData,
    source,
    effectiveAuthor
  );
  if (!targetNode) {
    return undefined;
  }
  return getContextKey(getNodeContext(knowledgeDBs, targetNode));
}

function coveredContextKeys(
  knowledgeDBs: KnowledgeDBs,
  graphData: GraphDataFields,
  crefIDs: List<ID>,
  effectiveAuthor: PublicKey
): ImmutableSet<string> {
  return crefIDs.reduce((acc, crefID) => {
    const key = contextKeyForCref(
      knowledgeDBs,
      graphData,
      crefID,
      effectiveAuthor
    );
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

function documentKeyForFileLink(
  item: GraphNode,
  sourceFilePath: string | undefined,
  documents: Map<string, Document>,
  documentByFilePath: Map<string, Document>
): string | undefined {
  if (!isBlockFileLink(item)) {
    return undefined;
  }
  const linkPath = getBlockFileLinkPath(item);
  if (!linkPath) {
    return undefined;
  }
  const targetDocument =
    documentByFilePath.get(resolveLinkPath(linkPath, sourceFilePath)) ??
    documents.get(documentKeyOf(item.author, linkPath));
  return targetDocument
    ? documentKeyOf(targetDocument.author, targetDocument.docId)
    : undefined;
}

function coveredDocumentKeys(
  knowledgeDBs: KnowledgeDBs,
  currentItems: List<GraphNode>,
  sourceFilePath: string | undefined,
  documents: Map<string, Document> | undefined,
  documentByFilePath: Map<string, Document> | undefined
): ImmutableSet<string> {
  if (!documents || !documentByFilePath) {
    return ImmutableSet<string>();
  }

  const collect = (
    covered: ImmutableSet<string>,
    item: GraphNode
  ): ImmutableSet<string> => {
    const documentKey = documentKeyForFileLink(
      item,
      sourceFilePath,
      documents,
      documentByFilePath
    );
    const withCurrent = documentKey ? covered.add(documentKey) : covered;
    return getChildNodes(knowledgeDBs, item, item.author).reduce(
      collect,
      withCurrent
    );
  };

  return currentItems.reduce(collect, ImmutableSet<string>());
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

function incomingFileLinkSourceKeys(
  graphData: GraphDataFields,
  rootFilePath: string | undefined,
  rootAuthor: PublicKey | undefined
): NodeKey[] {
  if (!rootFilePath || !rootAuthor) return [];
  const key = filePathKeyOf(rootAuthor as SourceId, rootFilePath);
  const ids = graphData.incomingFileLinks.get(key);
  return ids ? [...ids] : [];
}

function getGraphLinkOwner(
  graphData: GraphDataFields,
  linkItemKey: NodeKey
): GraphNode | undefined {
  const item = getNodeByKey(graphData, linkItemKey);
  if (!item) return undefined;
  return item.parent
    ? getNodeFromGraphData(
        graphData,
        item.parent as ID,
        item.author as SourceId
      ) ?? item
    : item;
}

function uniqueNodes(nodes: GraphNode[]): GraphNode[] {
  const seen = new globalThis.Set<LongID>();
  return nodes.filter((node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
}

function dedupeContextForSourceNode(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode
): List<ID> {
  const context = getNodeContext(knowledgeDBs, node);
  return context.size === 0
    ? context.push(getSemanticID(knowledgeDBs, node))
    : context;
}

export function getIncomingCrefsForDocument(
  knowledgeDBs: KnowledgeDBs,
  graphData: GraphDataFields,
  visibleAuthors: ImmutableSet<PublicKey>,
  document: Pick<Document, "author" | "filePath">,
  effectiveAuthor: PublicKey
): List<LongID> {
  const sourceIDs = incomingFileLinkSourceKeys(
    graphData,
    document.filePath,
    document.author
  );
  const refs = List(
    sourceIDs
      .map((nodeID) => getNodeByKey(graphData, nodeID))
      .filter((node): node is GraphNode => node !== undefined)
      .filter((node) => visibleAuthors.has(node.author))
      .filter(
        (node) =>
          node.systemRole !== LOG_ROOT_ROLE &&
          !isInSystemRoot(knowledgeDBs, node, LOG_ROOT_ROLE)
      )
      .map((node) => ({
        nodeID: node.id,
        context: dedupeContextForSourceNode(knowledgeDBs, node),
        updated: node.updated,
        sortDepth: getNodeContext(knowledgeDBs, node).size,
      }))
  );

  return deduplicateRefsByContext(refs, knowledgeDBs, effectiveAuthor)
    .sortBy(
      (ref) =>
        `${ref.sortDepth ?? ref.context.size}:${ref.context.join(":")}:${
          -ref.updated
        }`
    )
    .map((ref) => ref.nodeID)
    .toList();
}

export function getIncomingCrefsForNode(
  knowledgeDBs: KnowledgeDBs,
  graphData: GraphDataFields,
  visibleAuthors: ImmutableSet<PublicKey>,
  currentSemanticID: ID,
  parentNodeID: LongID | undefined,
  currentNodeID: LongID | undefined,
  effectiveAuthor: PublicKey,
  currentItems?: List<GraphNode>,
  currentNodeFilePath?: string,
  currentNodeAuthor?: PublicKey,
  documents?: Map<string, Document>,
  documentByFilePath?: Map<string, Document>
): List<LongID> {
  const current = currentItems || List<GraphNode>();
  const outgoingCrefIDs = current
    .filter(isRefNode)
    .map((item) => item.id)
    .toList();
  const covered = coveredContextKeys(
    knowledgeDBs,
    graphData,
    outgoingCrefIDs,
    effectiveAuthor
  );
  const coveredDocuments = coveredDocumentKeys(
    knowledgeDBs,
    current,
    currentNodeFilePath,
    documents,
    documentByFilePath
  );
  const outgoingTargetRelIDs = current.reduce((acc, item) => {
    const targetNode = resolveCrefTargetNode(
      knowledgeDBs,
      graphData,
      item,
      effectiveAuthor
    );
    return targetNode ? acc.add(targetNode.id) : acc;
  }, ImmutableSet<LongID>());

  const graphLinkSourceNodes = currentNodeID
    ? [
        ...(graphData.incomingCrefs.get(
          nodeKeyOf(
            (currentNodeAuthor ?? effectiveAuthor) as SourceId,
            currentNodeID as ID
          )
        ) || new globalThis.Set<NodeKey>()),
      ]
        .map((nodeID) => getGraphLinkOwner(graphData, nodeID))
        .filter((node): node is GraphNode => node !== undefined)
    : [];
  const fileLinkSourceNodes = incomingFileLinkSourceKeys(
    graphData,
    currentNodeFilePath,
    currentNodeAuthor
  )
    .map((nodeID) => getNodeByKey(graphData, nodeID))
    .filter((node): node is GraphNode => node !== undefined);
  const sourceNodes = uniqueNodes([
    ...graphLinkSourceNodes,
    ...fileLinkSourceNodes,
  ]);

  const refs = List(
    sourceNodes
      .filter((node) => visibleAuthors.has(node.author))
      .filter((node) => node.id !== parentNodeID)
      .filter((node) => node.id !== currentNodeID)
      .filter((node) => {
        const key = sourceDocumentKey(knowledgeDBs, documents, node);
        return key === undefined || !coveredDocuments.has(key);
      })
      .filter(
        (node) =>
          node.systemRole !== LOG_ROOT_ROLE &&
          !isInSystemRoot(knowledgeDBs, node, LOG_ROOT_ROLE)
      )
      .filter((node) => !outgoingTargetRelIDs.has(node.id))
      .map((node) => ({
        nodeID: node.id,
        context: dedupeContextForSourceNode(knowledgeDBs, node),
        updated: node.updated,
        sortDepth: getNodeContext(knowledgeDBs, node).size,
      }))
  );

  const deduped = deduplicateRefsByContext(refs, knowledgeDBs, effectiveAuthor);
  return deduped
    .filter((ref) => !covered.has(getRefContextKey(knowledgeDBs, ref)))
    .sortBy(
      (ref) =>
        `${ref.sortDepth ?? ref.context.size}:${ref.context.join(":")}:${
          -ref.updated
        }`
    )
    .map((ref) => ref.nodeID)
    .toList();
}

type AlternativeFooterResult = {
  suggestions: List<ID>;
  versionMetas: Map<LongID, VersionMeta>;
};

const EMPTY_ALTERNATIVE_FOOTER_RESULT: AlternativeFooterResult = {
  suggestions: List<ID>(),
  versionMetas: Map<LongID, VersionMeta>(),
};

function isVisibleVersion(
  node: GraphNode,
  visibleAuthors: ImmutableSet<PublicKey>
): boolean {
  return !isRefNode(node) && visibleAuthors.has(node.author);
}

function getPastVersions(
  graphData: GraphDataFields,
  visibleAuthors: ImmutableSet<PublicKey>,
  currentNode: GraphNode
): List<GraphNode> {
  if (!currentNode.basedOn) {
    return List<GraphNode>();
  }

  const explicitSource =
    currentNode.basedOnSource ?? currentNode.anchor?.sourceAuthor;
  const pastVersionCandidates = explicitSource
    ? [
        getNodeByKey(
          graphData,
          nodeKeyOf(explicitSource as SourceId, currentNode.basedOn as ID)
        ),
      ]
    : getSourceNodeCandidates(graphData, currentNode.basedOn as ID).map(
        (candidate) => candidate.node
      );
  const pastVersion = pastVersionCandidates.find(
    (candidate): candidate is GraphNode =>
      candidate !== undefined && isVisibleVersion(candidate, visibleAuthors)
  );
  if (!pastVersion) {
    return List<GraphNode>();
  }

  const visiblePast = isVisibleVersion(pastVersion, visibleAuthors)
    ? List<GraphNode>([pastVersion])
    : List<GraphNode>();

  return visiblePast
    .concat(getPastVersions(graphData, visibleAuthors, pastVersion))
    .toList();
}

function getFutureVersions(
  graphData: GraphDataFields,
  visibleAuthors: ImmutableSet<PublicKey>,
  currentNode: GraphNode,
  excludedIDs: ImmutableSet<LongID> = ImmutableSet<LongID>(),
  visited: ImmutableSet<NodeKey> = ImmutableSet<NodeKey>([
    nodeKeyOfNode(currentNode),
  ])
): List<GraphNode> {
  const futureIDs = List([
    ...(graphData.basedOnIndex.get(nodeKeyOfNode(currentNode)) || []),
  ] as NodeKey[]).filter((nextID) => !visited.has(nextID));

  return futureIDs
    .reduce((collected, futureID) => {
      const futureVersion = getNodeByKey(graphData, futureID);
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
            graphData,
            visibleAuthors,
            futureVersion,
            excludedIDs,
            visited.add(futureID) as ImmutableSet<NodeKey>
          )
        )
        .toList();
    }, List<GraphNode>())
    .toList();
}

function getVersions(
  graphData: GraphDataFields,
  visibleAuthors: ImmutableSet<PublicKey>,
  currentNode: GraphNode
): List<GraphNode> {
  const pastVersions = getPastVersions(graphData, visibleAuthors, currentNode);
  const lineageNodes = List<GraphNode>([currentNode]).concat(pastVersions);
  const lineageIDs = lineageNodes
    .map((node) => node.id as LongID)
    .toSet() as ImmutableSet<LongID>;
  const futureVersions = lineageNodes.reduce(
    (collected, lineageNode) =>
      collected
        .concat(
          getFutureVersions(graphData, visibleAuthors, lineageNode, lineageIDs)
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
  knowledgeDBs: KnowledgeDBs,
  graphData: GraphDataFields,
  visibleAuthors: ImmutableSet<PublicKey>,
  filterTypes: FooterTypeFilters,
  currentNode?: GraphNode,
  showSuggestions: boolean = true,
  snapshotNodes: SnapshotNodes = Map<string, Map<string, GraphNode>>()
): AlternativeFooterResult {
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

  const versionNodes = getVersions(graphData, visibleAuthors, currentNode);
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
        }, Map<LongID, VersionMeta>())
    : Map<LongID, VersionMeta>();

  return { suggestions, versionMetas };
}
