import { List, OrderedMap, Set as ImmutableSet } from "immutable";
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
import { suggestionSettings } from "./constants";
import { LOG_ROOT_ROLE } from "./systemRoots";

type FooterTypeFilters = (
  | Relevance
  | Argument
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
              node.text === localID)
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
  const nodeText = getNodeText(node);
  if (nodeText !== undefined) {
    return nodeText;
  }

  const fallbackText = getFallbackSemanticText(semanticID);
  return fallbackText !== "" || localID === EMPTY_SEMANTIC_ID
    ? fallbackText
    : undefined;
}

function getNodeKey(knowledgeDBs: KnowledgeDBs, node: GraphNode): ID {
  return getSemanticID(knowledgeDBs, node);
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
  coveredCandidateIDs: ImmutableSet<string>;
  versions: List<LongID>;
};

const EMPTY_ALTERNATIVE_FOOTER_RESULT: AlternativeFooterResult = {
  suggestions: List<ID>(),
  coveredCandidateIDs: ImmutableSet<string>(),
  versions: List<LongID>(),
};

function getFooterItemFilters(
  filterTypes: FooterTypeFilters
): (Relevance | Argument | "contains")[] {
  return filterTypes.filter(
    (t): t is Relevance | Argument | "contains" =>
      t !== "suggestions" &&
      t !== "versions" &&
      t !== "incoming" &&
      t !== undefined
  );
}

function getFilteredNodeItems(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode,
  filterTypes: FooterTypeFilters
): List<GraphNode> {
  const itemFilters = getFooterItemFilters(filterTypes);
  return getChildNodes(knowledgeDBs, node, node.author)
    .filter(
      (item) =>
        itemPassesFilters(item, itemFilters) &&
        item.relevance !== "not_relevant"
    )
    .toList();
}

function useExactItemMatchForNode(
  node: GraphNode,
  currentNode: GraphNode
): boolean {
  return node.author === currentNode.author && node.root === currentNode.root;
}

function getComparableItemKey(
  knowledgeDBs: KnowledgeDBs,
  item: GraphNode,
  useExactMatch: boolean
): string {
  return useExactMatch ? shortID(item.id) : getNodeKey(knowledgeDBs, item);
}

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

type AlternativeSummary = {
  node: GraphNode;
  filteredChildren: List<GraphNode>;
  addKeys: ImmutableSet<string>;
  removeCount: number;
};

export function getAlternativeFooterData(
  knowledgeDBs: KnowledgeDBs,
  semanticIndex: SemanticIndex,
  visibleAuthors: ImmutableSet<PublicKey>,
  filterTypes: FooterTypeFilters,
  currentNode?: GraphNode,
  showSuggestions: boolean = true
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

  const versionNodes = getVersions(semanticIndex, visibleAuthors, currentNode);

  const currentNodeChildren = getChildNodes(
    knowledgeDBs,
    currentNode,
    currentNode.author
  );
  const existingCrefTargetIDs = currentNodeChildren
    .map((item) => (isRefNode(item) ? item.targetID : undefined))
    .filter((id): id is LongID => !!id)
    .toSet();
  const declinedTargetIDs = currentNodeChildren
    .filter((item) => isRefNode(item) && item.relevance === "not_relevant")
    .flatMap((item) => {
      const { targetID } = item;
      return targetID ? [targetID] : [];
    })
    .toSet();
  const currentNodeItemIDs = currentNodeChildren.map((item) => item.id).toSet();
  const currentNodeItemKeys = currentNodeChildren
    .map((item) => getNodeKey(knowledgeDBs, item))
    .toSet();
  const currentExactItemKeys = getFilteredNodeItems(
    knowledgeDBs,
    currentNode,
    filterTypes
  )
    .map((item) => shortID(item.id))
    .toSet();
  const currentSemanticItemKeys = getFilteredNodeItems(
    knowledgeDBs,
    currentNode,
    filterTypes
  )
    .map((item) => getNodeKey(knowledgeDBs, item))
    .toSet();

  const summarizeNodes = (nodes: List<GraphNode>): List<AlternativeSummary> =>
    nodes.map((node): AlternativeSummary => {
      const useExactMatch = useExactItemMatchForNode(node, currentNode);
      const filteredChildren = getFilteredNodeItems(
        knowledgeDBs,
        node,
        filterTypes
      );
      const candidateKeys = filteredChildren
        .map((item) => getComparableItemKey(knowledgeDBs, item, useExactMatch))
        .toSet();
      const currentKeys = useExactMatch
        ? currentExactItemKeys
        : currentSemanticItemKeys;
      return {
        node,
        filteredChildren,
        addKeys: candidateKeys.filter((key) => !currentKeys.has(key)).toSet(),
        removeCount: currentKeys.filter((key) => !candidateKeys.has(key)).size,
      };
    });

  const versionSummaries = summarizeNodes(versionNodes);

  const candidateItemIDs = suggestionsEnabled
    ? versionSummaries
        .filter(({ node }) => !declinedTargetIDs.has(node.id))
        .reduce((acc, { filteredChildren }) => {
          return filteredChildren.reduce((itemAcc, item) => {
            if (currentNodeItemIDs.has(item.id)) {
              return itemAcc;
            }
            const candidateKey = getNodeKey(knowledgeDBs, item);
            if (
              currentNodeItemKeys.has(candidateKey) ||
              itemAcc.has(candidateKey)
            ) {
              return itemAcc;
            }
            return itemAcc.set(candidateKey, item.id);
          }, acc);
        }, OrderedMap<string, ID>())
    : OrderedMap<string, ID>();

  const cappedCandidates = candidateItemIDs
    .entrySeq()
    .take(suggestionSettings.maxSuggestions)
    .toList();
  const coveredCandidateIDs = cappedCandidates
    .map(([candidateKey]) => candidateKey)
    .toSet() as ImmutableSet<string>;
  const versions = versionsEnabled
    ? versionSummaries
        .filter(({ node }) => !existingCrefTargetIDs.has(node.id))
        .filter(
          ({ addKeys, removeCount }) => addKeys.size > 0 || removeCount > 0
        )
        .filter(
          ({ addKeys, removeCount }) =>
            addKeys.some((key) => !coveredCandidateIDs.has(key)) ||
            removeCount > suggestionSettings.maxSuggestions
        )
        .map(({ node }) => node.id)
        .toList()
    : List<LongID>();

  return {
    suggestions: cappedCandidates
      .map(([, candidateID]) => candidateID as ID)
      .toList(),
    coveredCandidateIDs,
    versions,
  };
}
