import { List, OrderedMap, Set as ImmutableSet } from "immutable";
import {
  getChildNodes,
  getNode,
  LOG_ROOT_ROLE,
  nodePassesFilters,
} from "../graph/queries";
import {
  splitID,
  shortID,
  getSemanticID,
  getNodeContext,
} from "../graph/context";
import { resolveNode, isRefNode } from "../graph/references";
import { suggestionSettings } from "./settings";

type AlternativeNodeFilters = (
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

function getNodeKey(knowledgeDBs: KnowledgeDBs, node: GraphNode): ID {
  return getSemanticID(knowledgeDBs, node);
}

function getContextKey(context: Context): string {
  return context.join(":");
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
  const node = resolveNode(
    knowledgeDBs,
    getNode(knowledgeDBs, crefID, effectiveAuthor)
  );
  if (!node) {
    return undefined;
  }
  return getContextKey(getNodeContext(knowledgeDBs, node));
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

function deduplicateRefsByContext(
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

export function getIncomingReferenceNodeIds(
  knowledgeDBs: KnowledgeDBs,
  semanticIndex: SemanticIndex,
  visibleAuthors: ImmutableSet<PublicKey>,
  parentNodeID: LongID | undefined,
  currentNodeID: LongID | undefined,
  effectiveAuthor: PublicKey,
  currentChildNodes?: List<GraphNode>
): List<LongID> {
  const outgoingCrefIDs = (currentChildNodes || List<GraphNode>())
    .filter(isRefNode)
    .map((node) => node.id)
    .toList();
  const covered = coveredContextKeys(
    knowledgeDBs,
    outgoingCrefIDs,
    effectiveAuthor
  );
  const outgoingTargetNodeIDs = (currentChildNodes || List<GraphNode>()).reduce(
    (acc, node) => {
      const targetNode = resolveNode(knowledgeDBs, node);
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
          .filter((node) => !outgoingTargetNodeIDs.has(node.id))
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

type AlternativeNodeResult = {
  suggestions: List<ID>;
  coveredCandidateIDs: ImmutableSet<string>;
  versions: List<LongID>;
};

const EMPTY_ALTERNATIVE_NODE_RESULT: AlternativeNodeResult = {
  suggestions: List<ID>(),
  coveredCandidateIDs: ImmutableSet<string>(),
  versions: List<LongID>(),
};

function getAlternativeNodeFilters(
  filterTypes: AlternativeNodeFilters
): (Relevance | Argument | "contains")[] {
  return filterTypes.filter(
    (t): t is Relevance | Argument | "contains" =>
      t !== "suggestions" &&
      t !== "versions" &&
      t !== "incoming" &&
      t !== undefined
  );
}

function getFilteredChildNodes(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode,
  filterTypes: AlternativeNodeFilters
): List<GraphNode> {
  const nodeFilters = getAlternativeNodeFilters(filterTypes);
  return getChildNodes(knowledgeDBs, node, node.author)
    .filter(
      (childNode) =>
        nodePassesFilters(childNode, nodeFilters) &&
        childNode.relevance !== "not_relevant"
    )
    .toList();
}

function useExactChildNodeMatch(
  node: GraphNode,
  currentNode: GraphNode
): boolean {
  return node.author === currentNode.author && node.root === currentNode.root;
}

function getComparableNodeKey(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode,
  useExactMatch: boolean
): string {
  return useExactMatch ? shortID(node.id) : getNodeKey(knowledgeDBs, node);
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
  filteredChildNodes: List<GraphNode>;
  addKeys: ImmutableSet<string>;
  removeCount: number;
};

export function getAlternativeNodeData(
  knowledgeDBs: KnowledgeDBs,
  semanticIndex: SemanticIndex,
  visibleAuthors: ImmutableSet<PublicKey>,
  filterTypes: AlternativeNodeFilters,
  currentNode?: GraphNode,
  showSuggestions: boolean = true
): AlternativeNodeResult {
  if (!currentNode || !filterTypes || filterTypes.length === 0) {
    return EMPTY_ALTERNATIVE_NODE_RESULT;
  }

  const suggestionsEnabled =
    showSuggestions && filterTypes.includes("suggestions");
  const versionsEnabled = filterTypes.includes("versions");

  if (!suggestionsEnabled && !versionsEnabled) {
    return EMPTY_ALTERNATIVE_NODE_RESULT;
  }

  const versionNodes = getVersions(semanticIndex, visibleAuthors, currentNode);

  const currentChildNodes = getChildNodes(
    knowledgeDBs,
    currentNode,
    currentNode.author
  );
  const existingCrefTargetNodeIDs = currentChildNodes
    .map((node) => (isRefNode(node) ? node.targetID : undefined))
    .filter((id): id is LongID => !!id)
    .toSet();
  const declinedTargetNodeIDs = currentChildNodes
    .filter((node) => isRefNode(node) && node.relevance === "not_relevant")
    .flatMap((node) => {
      const { targetID } = node;
      return targetID ? [targetID] : [];
    })
    .toSet();
  const currentChildNodeIDs = currentChildNodes.map((node) => node.id).toSet();
  const currentChildNodeKeys = currentChildNodes
    .map((node) => getNodeKey(knowledgeDBs, node))
    .toSet();
  const currentExactChildNodeKeys = getFilteredChildNodes(
    knowledgeDBs,
    currentNode,
    filterTypes
  )
    .map((node) => shortID(node.id))
    .toSet();
  const currentSemanticChildNodeKeys = getFilteredChildNodes(
    knowledgeDBs,
    currentNode,
    filterTypes
  )
    .map((node) => getNodeKey(knowledgeDBs, node))
    .toSet();

  const summarizeNodes = (nodes: List<GraphNode>): List<AlternativeSummary> =>
    nodes.map((node): AlternativeSummary => {
      const useExactMatch = useExactChildNodeMatch(node, currentNode);
      const filteredChildNodes = getFilteredChildNodes(
        knowledgeDBs,
        node,
        filterTypes
      );
      const candidateKeys = filteredChildNodes
        .map((childNode) =>
          getComparableNodeKey(knowledgeDBs, childNode, useExactMatch)
        )
        .toSet();
      const currentKeys = useExactMatch
        ? currentExactChildNodeKeys
        : currentSemanticChildNodeKeys;
      return {
        node,
        filteredChildNodes,
        addKeys: candidateKeys.filter((key) => !currentKeys.has(key)).toSet(),
        removeCount: currentKeys.filter((key) => !candidateKeys.has(key)).size,
      };
    });

  const versionSummaries = summarizeNodes(versionNodes);

  const candidateNodeIDs = suggestionsEnabled
    ? versionSummaries
        .filter(({ node }) => !declinedTargetNodeIDs.has(node.id))
        .reduce((acc, { filteredChildNodes }) => {
          return filteredChildNodes.reduce((nodeAcc, childNode) => {
            if (currentChildNodeIDs.has(childNode.id)) {
              return nodeAcc;
            }
            const candidateKey = getNodeKey(knowledgeDBs, childNode);
            if (
              currentChildNodeKeys.has(candidateKey) ||
              nodeAcc.has(candidateKey)
            ) {
              return nodeAcc;
            }
            return nodeAcc.set(candidateKey, childNode.id);
          }, acc);
        }, OrderedMap<string, ID>())
    : OrderedMap<string, ID>();

  const cappedCandidates = candidateNodeIDs
    .entrySeq()
    .take(suggestionSettings.maxSuggestions)
    .toList();
  const coveredCandidateIDs = cappedCandidates
    .map(([candidateKey]) => candidateKey)
    .toSet() as ImmutableSet<string>;
  const versions = versionsEnabled
    ? versionSummaries
        .filter(({ node }) => !existingCrefTargetNodeIDs.has(node.id))
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
