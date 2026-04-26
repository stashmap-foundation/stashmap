import { List, Map, OrderedMap, Set as ImmutableSet } from "immutable";
import {
  EMPTY_SEMANTIC_ID,
  getChildNodes,
  shortID,
  splitID,
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
} from "./connections";
import { getBlockLinkTarget, nodeText } from "./nodeSpans";
import { suggestionSettings } from "./constants";
import { LOG_ROOT_ROLE } from "./systemRoots";
import { computeVersionDiff } from "./domain/snapshotBaseline";

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

  const [remote, localID] = splitID(semanticID as ID);
  const preferredAuthor = remote || author;
  const preferredDB = knowledgeDBs.get(preferredAuthor);
  const otherDBs = remote
    ? []
    : knowledgeDBs
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
  semanticIndex: SemanticIndex,
  semanticKey: string
): List<GraphNode> {
  const nodeIDs = semanticIndex.semantic.get(semanticKey);
  if (!nodeIDs) {
    return List<GraphNode>();
  }

  return List(
    [...nodeIDs]
      .map((nodeID) => semanticIndex.nodeByID.get(nodeID))
      .filter((node): node is GraphNode => node !== undefined)
      .sort((left, right) => right.updated - left.updated)
  );
}

export function findRefsToNode(
  knowledgeDBs: KnowledgeDBs,
  semanticIndex: SemanticIndex,
  semanticID: ID,
  filterContext?: Context,
  targetAuthor?: PublicKey,
  targetRoot?: ID
): List<ReferencedByRef> {
  const targetSemanticKey =
    targetAuthor && targetRoot ? semanticID : (shortID(semanticID as ID) as ID);
  const resolvedRefs = getSemanticCandidates(semanticIndex, targetSemanticKey)
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
            const [author] = splitID(ref.nodeID);
            const isOther =
              preferAuthor && author !== undefined && author !== preferAuthor
                ? 1
                : 0;
            return [isOther, -ref.updated];
          })
          .first()!
    )
    .valueSeq()
    .toList();
}

export function getIncomingCrefsForNode(
  knowledgeDBs: KnowledgeDBs,
  semanticIndex: SemanticIndex,
  visibleAuthors: ImmutableSet<PublicKey>,
  currentSemanticID: ID,
  parentNodeID: LongID | undefined,
  currentNodeID: LongID | undefined,
  effectiveAuthor: PublicKey,
  currentItems?: List<GraphNode>
): List<LongID> {
  const outgoingCrefIDs = (currentItems || List<GraphNode>())
    .filter(isRefNode)
    .map((item) => item.id)
    .toList();
  const covered = coveredContextKeys(
    knowledgeDBs,
    outgoingCrefIDs,
    effectiveAuthor
  );
  const outgoingTargetRelIDs = (currentItems || List<GraphNode>()).reduce(
    (acc, item) => {
      const targetNode = resolveNode(knowledgeDBs, item);
      return targetNode ? acc.add(targetNode.id) : acc;
    },
    ImmutableSet<LongID>()
  );

  const refs = List(
    currentNodeID
      ? [
          ...(semanticIndex.incomingCrefs.get(currentNodeID) ||
            new globalThis.Set<LongID>()),
        ]
          .map((nodeID) => semanticIndex.nodeByID.get(nodeID))
          .filter((node): node is GraphNode => node !== undefined)
          .filter((node) => visibleAuthors.has(node.author))
          .filter((node) => node.id !== parentNodeID)
          .filter((node) => node.id !== currentNodeID)
          .filter(
            (node) =>
              node.systemRole !== LOG_ROOT_ROLE &&
              !isInSystemRoot(knowledgeDBs, node, LOG_ROOT_ROLE)
          )
          .filter((node) => !outgoingTargetRelIDs.has(node.id))
          .map((node) => ({
            nodeID: node.id,
            context: getNodeContext(knowledgeDBs, node),
            updated: node.updated,
          }))
      : []
  );

  const deduped = deduplicateRefsByContext(refs, knowledgeDBs, effectiveAuthor);
  return deduped
    .filter((ref) => !covered.has(getRefContextKey(knowledgeDBs, ref)))
    .sortBy((ref) => `${-ref.updated}:${ref.context.join(":")}`)
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
  semanticIndex: SemanticIndex,
  visibleAuthors: ImmutableSet<PublicKey>,
  currentNode: GraphNode
): List<GraphNode> {
  if (!currentNode.basedOn) {
    return List<GraphNode>();
  }

  const pastVersion = semanticIndex.nodeByID.get(currentNode.basedOn);
  if (!pastVersion) {
    return List<GraphNode>();
  }

  const visiblePast = isVisibleVersion(pastVersion, visibleAuthors)
    ? List<GraphNode>([pastVersion])
    : List<GraphNode>();

  return visiblePast
    .concat(getPastVersions(semanticIndex, visibleAuthors, pastVersion))
    .toList();
}

function getFutureVersions(
  semanticIndex: SemanticIndex,
  visibleAuthors: ImmutableSet<PublicKey>,
  currentNode: GraphNode,
  excludedIDs: ImmutableSet<LongID> = ImmutableSet<LongID>(),
  visited: ImmutableSet<LongID> = ImmutableSet<LongID>([currentNode.id])
): List<GraphNode> {
  const futureIDs = List([
    ...(semanticIndex.basedOnIndex.get(currentNode.id) || []),
  ] as LongID[]).filter((nextID) => !visited.has(nextID));

  return futureIDs
    .reduce((collected, futureID) => {
      const futureVersion = semanticIndex.nodeByID.get(futureID);
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
            semanticIndex,
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
  semanticIndex: SemanticIndex,
  visibleAuthors: ImmutableSet<PublicKey>,
  currentNode: GraphNode
): List<GraphNode> {
  const pastVersions = getPastVersions(
    semanticIndex,
    visibleAuthors,
    currentNode
  );
  const lineageNodes = List<GraphNode>([currentNode]).concat(pastVersions);
  const lineageIDs = lineageNodes
    .map((node) => node.id as LongID)
    .toSet() as ImmutableSet<LongID>;
  const futureVersions = lineageNodes.reduce(
    (collected, lineageNode) =>
      collected
        .concat(
          getFutureVersions(
            semanticIndex,
            visibleAuthors,
            lineageNode,
            lineageIDs
          )
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
  semanticIndex: SemanticIndex,
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

  const versionNodes = getVersions(semanticIndex, visibleAuthors, currentNode);
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
