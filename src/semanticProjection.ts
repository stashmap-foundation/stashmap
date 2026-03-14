import { List, OrderedMap, Set as ImmutableSet } from "immutable";
import {
  EMPTY_SEMANTIC_ID,
  getRelationChildNodes,
  shortID,
  splitID,
  isSearchId,
  parseSearchId,
  itemMatchesType,
  itemPassesFilters,
  getNodeSemanticID,
  getSemanticID,
  getRelationContext,
  getNodeText,
  getNode,
  resolveNode,
  isRefNode,
} from "./connections";
import { suggestionSettings } from "./constants";
import { isStandaloneRoot, LOG_ROOT_ROLE } from "./systemRoots";

type FooterTypeFilters = (
  | Relevance
  | Argument
  | "suggestions"
  | "versions"
  | "incoming"
  | "occurrence"
  | "contains"
)[];

export type ReferencedByRef = {
  relationID: LongID;
  context: Context;
  updated: number;
};

export function contextsMatch(a: Context, b: Context): boolean {
  return a.equals(b);
}

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

  const directRelation = getNode(knowledgeDBs, semanticID, author);
  if (directRelation) {
    if (isRefNode(directRelation)) {
      return [];
    }
    return [directRelation];
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
          (relation) =>
            !isRefNode(relation) &&
            (shortID(getNodeSemanticID(relation)) === localID ||
              relation.text === localID)
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

export function getConcreteNodeForSemanticID(
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

  const directRelation = getNode(knowledgeDBs, semanticID, author);
  if (directRelation) {
    if (isRefNode(directRelation)) {
      return undefined;
    }
    return getNodeText(directRelation);
  }

  const relation = getConcreteNodeForSemanticID(
    knowledgeDBs,
    semanticID,
    author
  );
  const relationText = getNodeText(relation);
  if (relationText !== undefined) {
    return relationText;
  }

  const fallbackText = getFallbackSemanticText(semanticID);
  return fallbackText !== "" || localID === EMPTY_SEMANTIC_ID
    ? fallbackText
    : undefined;
}

export function getTextHashForSemanticID(
  knowledgeDBs: KnowledgeDBs,
  semanticID: ID,
  author: PublicKey
): ID | undefined {
  const directRelation = getNode(knowledgeDBs, semanticID, author);
  if (directRelation) {
    return directRelation.text as ID;
  }

  const relation = getConcreteNodeForSemanticID(
    knowledgeDBs,
    semanticID,
    author
  );
  if (relation) {
    return relation.text as ID;
  }

  const localID = shortID(semanticID as ID) as ID;
  const fallbackText = getFallbackSemanticText(semanticID);
  return fallbackText !== "" || localID === EMPTY_SEMANTIC_ID
    ? (fallbackText as ID)
    : undefined;
}

export function getSemanticNodeKey(
  knowledgeDBs: KnowledgeDBs,
  semanticID: ID,
  author: PublicKey
): string {
  return (
    getTextHashForSemanticID(knowledgeDBs, semanticID, author) ||
    shortID(semanticID)
  );
}

export function nodesSemanticallyMatch(
  knowledgeDBs: KnowledgeDBs,
  leftSemanticID: ID,
  leftAuthor: PublicKey,
  rightSemanticID: ID,
  rightAuthor: PublicKey
): boolean {
  return (
    getSemanticNodeKey(knowledgeDBs, leftSemanticID, leftAuthor) ===
    getSemanticNodeKey(knowledgeDBs, rightSemanticID, rightAuthor)
  );
}

export function contextsSemanticallyMatch(
  knowledgeDBs: KnowledgeDBs,
  leftContext: Context,
  leftAuthor: PublicKey,
  rightContext: Context,
  rightAuthor: PublicKey
): boolean {
  return (
    leftContext.size === rightContext.size &&
    leftContext.every((id, index) =>
      nodesSemanticallyMatch(
        knowledgeDBs,
        id,
        leftAuthor,
        rightContext.get(index) as ID,
        rightAuthor
      )
    )
  );
}

function getSemanticCandidates(
  semanticIndex: SemanticIndex,
  semanticKey: string
): List<GraphNode> {
  const relationIDs = semanticIndex.semantic.get(semanticKey);
  if (!relationIDs) {
    return List<GraphNode>();
  }

  return List(
    [...relationIDs]
      .map((relationID) => semanticIndex.relationByID.get(relationID))
      .filter((relation): relation is GraphNode => relation !== undefined)
      .sort((left, right) => right.updated - left.updated)
  );
}

function nodesMatchForRefs(
  knowledgeDBs: KnowledgeDBs,
  candidateSemanticID: ID,
  candidateAuthor: PublicKey,
  candidateRoot: ID,
  targetSemanticID: ID,
  targetAuthor?: PublicKey,
  targetRoot?: ID
): boolean {
  if (
    targetAuthor !== undefined &&
    targetRoot !== undefined &&
    candidateAuthor === targetAuthor &&
    candidateRoot === targetRoot
  ) {
    return (
      shortID(candidateSemanticID as ID) === shortID(targetSemanticID as ID)
    );
  }

  return (
    getSemanticNodeKey(knowledgeDBs, candidateSemanticID, candidateAuthor) ===
    getSemanticNodeKey(
      knowledgeDBs,
      targetSemanticID,
      targetAuthor || candidateAuthor
    )
  );
}

function contextsMatchForRefs(
  knowledgeDBs: KnowledgeDBs,
  candidateContext: Context,
  candidateAuthor: PublicKey,
  candidateRoot: ID,
  targetContext: Context,
  targetAuthor?: PublicKey,
  targetRoot?: ID
): boolean {
  if (
    targetAuthor !== undefined &&
    targetRoot !== undefined &&
    candidateAuthor === targetAuthor &&
    candidateRoot === targetRoot
  ) {
    return candidateContext.equals(targetContext);
  }

  return (
    candidateContext.size === targetContext.size &&
    candidateContext.every((semanticID, index) =>
      nodesMatchForRefs(
        knowledgeDBs,
        semanticID,
        candidateAuthor,
        candidateRoot,
        targetContext.get(index) as ID,
        targetAuthor,
        targetRoot
      )
    )
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
  const targetSemanticKey = targetAuthor
    ? getSemanticNodeKey(knowledgeDBs, semanticID, targetAuthor)
    : shortID(semanticID as ID);
  const resolvedRefs = getSemanticCandidates(semanticIndex, targetSemanticKey)
    .filter((relation) => !isSearchId(getSemanticID(knowledgeDBs, relation)))
    .filter(
      (relation) =>
        !getRelationContext(knowledgeDBs, relation).some((id) =>
          isSearchId(id as ID)
        )
    )
    .map((relation) => ({
      ref: {
        relationID: relation.id,
        context: getRelationContext(knowledgeDBs, relation),
        updated: relation.updated,
      },
      author: relation.author,
      root: relation.root,
    }))
    .toList();

  const allRefs = filterContext
    ? resolvedRefs
        .filter(({ ref, author, root }) =>
          contextsMatchForRefs(
            knowledgeDBs,
            ref.context,
            author,
            root,
            filterContext,
            targetAuthor,
            targetRoot
          )
        )
        .map(({ ref }) => ref)
        .toList()
    : resolvedRefs.map(({ ref }) => ref).toList();

  return allRefs
    .groupBy((ref) => ref.relationID)
    .map((grp) => grp.first()!)
    .valueSeq()
    .toList();
}

function getSemanticContextKey(
  knowledgeDBs: KnowledgeDBs,
  context: Context,
  author: PublicKey
): string {
  return context
    .map((semanticID) => getSemanticNodeKey(knowledgeDBs, semanticID, author))
    .join(":");
}

function getRefContextKey(
  knowledgeDBs: KnowledgeDBs,
  ref: ReferencedByRef,
  effectiveAuthor?: PublicKey
): string {
  const [author] = splitID(ref.relationID);
  const contextAuthor = author || effectiveAuthor;
  if (!contextAuthor) {
    return ref.context.join(":");
  }
  return getSemanticContextKey(knowledgeDBs, ref.context, contextAuthor);
}

function contextKeyForCref(
  knowledgeDBs: KnowledgeDBs,
  crefID: ID,
  effectiveAuthor: PublicKey
): string | undefined {
  const targetRelation = resolveNode(
    knowledgeDBs,
    getNode(knowledgeDBs, crefID, effectiveAuthor)
  );
  if (!targetRelation) {
    return undefined;
  }
  return getSemanticContextKey(
    knowledgeDBs,
    getRelationContext(knowledgeDBs, targetRelation),
    targetRelation.author
  );
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
  relation: GraphNode | undefined,
  systemRole: RootSystemRole
): boolean {
  if (!relation) {
    return false;
  }
  const rootRelation = getNode(knowledgeDBs, relation.root, relation.author);
  return rootRelation?.systemRole === systemRole;
}

export function deduplicateRefsByContext(
  refs: List<ReferencedByRef>,
  knowledgeDBs: KnowledgeDBs,
  preferAuthor?: PublicKey
): List<ReferencedByRef> {
  return refs
    .groupBy((ref) => getRefContextKey(knowledgeDBs, ref, preferAuthor))
    .map(
      (group) =>
        group
          .sortBy((ref) => {
            const [author] = splitID(ref.relationID);
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

export function getOccurrencesForNode(
  knowledgeDBs: KnowledgeDBs,
  semanticIndex: SemanticIndex,
  visibleAuthors: ImmutableSet<PublicKey>,
  semanticID: ID,
  currentRelationID: LongID | undefined,
  effectiveAuthor: PublicKey,
  currentContext: Context,
  currentRoot?: ID,
  currentItems?: List<GraphNode>,
  incomingCrefIDs?: List<LongID>
): List<LongID> {
  const allRefs = findRefsToNode(
    knowledgeDBs,
    semanticIndex,
    semanticID,
    undefined,
    effectiveAuthor,
    currentRoot
  );
  const contextRoot = currentContext.first();
  const isInCurrentRootTree = (ref: ReferencedByRef): boolean => {
    if (!currentRoot) {
      return false;
    }
    return semanticIndex.relationByID.get(ref.relationID)?.root === currentRoot;
  };
  const outgoingCrefIDs = currentItems
    ? currentItems
        .filter(isRefNode)
        .map((item) => item.id)
        .toList()
    : List<ID>();
  const outgoingTargetRelationIDs = currentItems
    ? currentItems
        .filter(isRefNode)
        .flatMap((item) => {
          const { targetID } = item;
          return targetID ? [targetID] : [];
        })
        .toSet()
    : ImmutableSet<LongID>();
  const covered = coveredContextKeys(
    knowledgeDBs,
    outgoingCrefIDs.concat(incomingCrefIDs || List<LongID>()),
    effectiveAuthor
  );
  const sharesSemanticRoot = (ref: ReferencedByRef): boolean => {
    const refRoot = ref.context.first();
    if (!contextRoot || !refRoot) {
      return false;
    }
    const [refAuthor] = splitID(ref.relationID);
    return (
      getSemanticNodeKey(
        knowledgeDBs,
        refRoot as ID,
        refAuthor || effectiveAuthor
      ) === getSemanticNodeKey(knowledgeDBs, contextRoot as ID, effectiveAuthor)
    );
  };
  const filtered = allRefs
    .filter((ref) => {
      const [author] = splitID(ref.relationID);
      return !!author && visibleAuthors.has(author);
    })
    .filter((ref) => {
      const relation = semanticIndex.relationByID.get(ref.relationID);
      return !(
        relation &&
        isRefNode(relation) &&
        relation.parent &&
        ((incomingCrefIDs || List<LongID>()).includes(relation.parent) ||
          outgoingTargetRelationIDs.has(relation.parent))
      );
    })
    .filter(
      (ref) =>
        !isInSystemRoot(
          knowledgeDBs,
          semanticIndex.relationByID.get(ref.relationID),
          LOG_ROOT_ROLE
        )
    )
    .filter((ref) => !isInCurrentRootTree(ref))
    .filter((ref) => ref.relationID !== currentRelationID)
    .filter((ref) =>
      ref.context.size === 0
        ? currentContext.size > 0
        : !contextRoot || !sharesSemanticRoot(ref)
    )
    .filter(
      (ref) =>
        !covered.has(getRefContextKey(knowledgeDBs, ref, effectiveAuthor))
    );
  const deduped = filtered
    .groupBy((ref) => getRefContextKey(knowledgeDBs, ref, effectiveAuthor))
    .map(
      (group) =>
        group
          .sortBy((ref) => {
            const [author] = splitID(ref.relationID);
            const isOther =
              effectiveAuthor &&
              author !== undefined &&
              author !== effectiveAuthor
                ? 1
                : 0;
            return [isOther, -ref.updated];
          })
          .first()!
    )
    .valueSeq()
    .toList();
  return deduped
    .sortBy((ref) => `${-ref.updated}:${ref.context.join(":")}`)
    .map((ref) => ref.relationID)
    .toList();
}

export function getIncomingCrefsForNode(
  knowledgeDBs: KnowledgeDBs,
  semanticIndex: SemanticIndex,
  visibleAuthors: ImmutableSet<PublicKey>,
  currentSemanticID: ID,
  parentRelationID: LongID | undefined,
  currentRelationID: LongID | undefined,
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
      const targetRelation = resolveNode(knowledgeDBs, item);
      return targetRelation ? acc.add(targetRelation.id) : acc;
    },
    ImmutableSet<LongID>()
  );

  const refs = List(
    currentRelationID
      ? [
          ...(semanticIndex.incomingCrefs.get(currentRelationID) ||
            new globalThis.Set<LongID>()),
        ]
          .map((relationID) => semanticIndex.relationByID.get(relationID))
          .filter((relation): relation is GraphNode => relation !== undefined)
          .filter((relation) => visibleAuthors.has(relation.author))
          .filter((relation) => relation.id !== parentRelationID)
          .filter((relation) => relation.id !== currentRelationID)
          .filter(
            (relation) =>
              relation.systemRole !== LOG_ROOT_ROLE &&
              !isInSystemRoot(knowledgeDBs, relation, LOG_ROOT_ROLE)
          )
          .filter((relation) => !outgoingTargetRelIDs.has(relation.id))
          .map((relation) => ({
            relationID: relation.id,
            context: getRelationContext(knowledgeDBs, relation),
            updated: relation.updated,
          }))
      : []
  );

  const deduped = deduplicateRefsByContext(refs, knowledgeDBs, effectiveAuthor);
  return deduped
    .filter(
      (ref) =>
        !covered.has(getRefContextKey(knowledgeDBs, ref, effectiveAuthor))
    )
    .sortBy((ref) => `${-ref.updated}:${ref.context.join(":")}`)
    .map((ref) => ref.relationID)
    .toList();
}

function getComparableSuggestionKey(
  knowledgeDBs: KnowledgeDBs,
  itemSemanticID: ID,
  fallbackAuthor: PublicKey
): string {
  return getSemanticNodeKey(knowledgeDBs, itemSemanticID, fallbackAuthor);
}

export type SuggestionsResult = {
  suggestions: List<ID>;
  coveredCandidateIDs: ImmutableSet<string>;
};

const EMPTY_SUGGESTIONS_RESULT: SuggestionsResult = {
  suggestions: List<ID>(),
  coveredCandidateIDs: ImmutableSet<string>(),
};

export function getSuggestionsForNode(
  knowledgeDBs: KnowledgeDBs,
  semanticIndex: SemanticIndex,
  visibleAuthors: ImmutableSet<PublicKey>,
  myself: PublicKey,
  semanticID: ID,
  filterTypes: FooterTypeFilters,
  currentRelationId?: LongID,
  parentContext?: Context
): SuggestionsResult {
  if (!filterTypes || filterTypes.length === 0) {
    return EMPTY_SUGGESTIONS_RESULT;
  }

  if (!filterTypes.includes("suggestions")) {
    return EMPTY_SUGGESTIONS_RESULT;
  }

  const itemFilters = filterTypes.filter(
    (t): t is Relevance | Argument | "contains" =>
      t !== "suggestions" && t !== "versions" && t !== undefined
  );

  const semanticKey = getSemanticNodeKey(knowledgeDBs, semanticID, myself);

  const currentRelation = currentRelationId
    ? getNode(knowledgeDBs, currentRelationId, myself)
    : undefined;
  const currentRelationChildren = currentRelation
    ? getRelationChildNodes(
        knowledgeDBs,
        currentRelation,
        currentRelation.author
      )
    : List<GraphNode>();
  const currentRelationItems: ImmutableSet<ID> = currentRelation
    ? currentRelationChildren.map((item) => item.id).toSet()
    : ImmutableSet<ID>();
  const currentRelationItemKeys: ImmutableSet<string> = currentRelation
    ? currentRelationChildren
        .map((item) =>
          getComparableSuggestionKey(
            knowledgeDBs,
            getSemanticID(knowledgeDBs, item),
            currentRelation.author
          )
        )
        .toSet()
    : ImmutableSet<string>();

  const declinedRelationTargetIDs: ImmutableSet<LongID> = currentRelation
    ? currentRelationChildren
        .filter((item) => isRefNode(item) && item.relevance === "not_relevant")
        .flatMap((item) => {
          const { targetID } = item;
          return targetID ? [targetID] : [];
        })
        .toSet()
    : ImmutableSet<LongID>();

  const contextToMatch = parentContext || List<ID>();
  const otherRelations: List<GraphNode> = getSemanticCandidates(
    semanticIndex,
    semanticKey
  )
    .filter((relation) => relation.author !== myself)
    .filter((relation) => visibleAuthors.has(relation.author))
    .filter((relation) => relation.text === semanticKey)
    .filter((relation) => relation.id !== currentRelationId)
    .filter((relation) => !declinedRelationTargetIDs.has(relation.id))
    .filter((relation) =>
      contextsSemanticallyMatch(
        knowledgeDBs,
        getRelationContext(knowledgeDBs, relation),
        relation.author,
        contextToMatch,
        myself
      )
    )
    .sortBy((r) => -r.updated);

  const candidateItemIDs = otherRelations.reduce(
    (acc: OrderedMap<string, ID>, nodes: GraphNode) => {
      return getRelationChildNodes(knowledgeDBs, nodes, nodes.author).reduce(
        (itemAcc, item: GraphNode) => {
          if (
            !itemFilters.some((t) => itemMatchesType(item, t)) ||
            item.relevance === "not_relevant" ||
            currentRelationItems.has(item.id)
          ) {
            return itemAcc;
          }
          const candidateSemanticID = getSemanticID(knowledgeDBs, item);
          const candidateKey = getSemanticNodeKey(
            knowledgeDBs,
            candidateSemanticID,
            nodes.author
          );
          if (
            currentRelationItemKeys.has(candidateKey) ||
            itemAcc.has(candidateKey)
          ) {
            return itemAcc;
          }
          return itemAcc.set(candidateKey, item.id);
        },
        acc
      );
    },
    OrderedMap<string, ID>()
  );

  if (candidateItemIDs.size === 0) {
    return EMPTY_SUGGESTIONS_RESULT;
  }

  const cappedCandidates = candidateItemIDs
    .entrySeq()
    .take(suggestionSettings.maxSuggestions)
    .toList();

  return {
    suggestions: cappedCandidates
      .map(([, candidateID]) => candidateID as ID)
      .toList(),
    coveredCandidateIDs: cappedCandidates
      .map(([candidateKey]) => candidateKey)
      .toSet() as ImmutableSet<string>,
  };
}

export function getAlternativeRelations(
  knowledgeDBs: KnowledgeDBs,
  semanticIndex: SemanticIndex,
  visibleAuthors: ImmutableSet<PublicKey>,
  semanticID: ID,
  context: Context,
  excludeRelationId?: LongID,
  currentAuthor?: PublicKey,
  currentRoot?: ID
): List<GraphNode> {
  const author = currentAuthor;
  if (!author) {
    return List<GraphNode>();
  }
  const semanticKey = getSemanticNodeKey(knowledgeDBs, semanticID, author);
  return getSemanticCandidates(semanticIndex, semanticKey)
    .filter((relation) => visibleAuthors.has(relation.author))
    .filter((relation) => relation.text === semanticKey)
    .filter((relation) => relation.id !== excludeRelationId)
    .filter(
      (relation) =>
        !(
          currentRoot !== undefined &&
          relation.author === author &&
          relation.root === currentRoot
        )
    )
    .filter((relation) =>
      contextsSemanticallyMatch(
        knowledgeDBs,
        getRelationContext(knowledgeDBs, relation),
        relation.author,
        context,
        author
      )
    )
    .filter(
      (relation) => relation.children.size > 0 || isStandaloneRoot(relation)
    )
    .toList();
}

function useExactItemMatchForRelation(
  relation: GraphNode,
  currentRelation?: GraphNode
): boolean {
  return (
    !!currentRelation &&
    relation.author === currentRelation.author &&
    relation.root === currentRelation.root
  );
}

function getComparableRelationItemKeys(
  knowledgeDBs: KnowledgeDBs,
  relation: GraphNode,
  filterTypes: FooterTypeFilters,
  useExactMatch: boolean
): ImmutableSet<string> {
  return getRelationChildNodes(knowledgeDBs, relation, relation.author)
    .filter(
      (item) =>
        itemPassesFilters(item, filterTypes) &&
        item.relevance !== "not_relevant"
    )
    .map((item) =>
      useExactMatch
        ? shortID(item.id)
        : getSemanticNodeKey(
            knowledgeDBs,
            getSemanticID(knowledgeDBs, item),
            relation.author
          )
    )
    .toSet();
}

function computeComparableRelationDiff(
  knowledgeDBs: KnowledgeDBs,
  versionRelation: GraphNode,
  parentRelation: GraphNode | undefined,
  activeFilters: FooterTypeFilters,
  useExactMatch: boolean
): { addCount: number; removeCount: number } {
  const versionIDs = getComparableRelationItemKeys(
    knowledgeDBs,
    versionRelation,
    activeFilters,
    useExactMatch
  );
  const parentIDs = parentRelation
    ? getComparableRelationItemKeys(
        knowledgeDBs,
        parentRelation,
        activeFilters,
        useExactMatch
      )
    : ImmutableSet<string>();
  return {
    addCount: versionIDs.filter((id) => !parentIDs.has(id)).size,
    removeCount: parentIDs.filter((id) => !versionIDs.has(id)).size,
  };
}

export function getVersionsForRelation(
  knowledgeDBs: KnowledgeDBs,
  semanticIndex: SemanticIndex,
  visibleAuthors: ImmutableSet<PublicKey>,
  semanticID: ID,
  filterTypes: FooterTypeFilters,
  currentRelation?: GraphNode,
  parentContext?: Context,
  coveredSuggestionIDs?: ImmutableSet<string>
): List<LongID> {
  if (!filterTypes || !filterTypes.includes("versions") || !currentRelation) {
    return List<LongID>();
  }

  const contextToMatch = parentContext || List<ID>();
  const alternatives = getAlternativeRelations(
    knowledgeDBs,
    semanticIndex,
    visibleAuthors,
    semanticID,
    contextToMatch,
    currentRelation?.id,
    currentRelation?.author,
    currentRelation?.root
  );

  const currentRelationChildren = getRelationChildNodes(
    knowledgeDBs,
    currentRelation,
    currentRelation.author
  );
  const existingCrefTargetIDs = currentRelationChildren
    .map((item) => (isRefNode(item) ? item.targetID : undefined))
    .filter((id): id is LongID => !!id)
    .toSet();
  const currentExactItemIDs = getComparableRelationItemKeys(
    knowledgeDBs,
    currentRelation,
    filterTypes,
    true
  );
  const currentSemanticItemIDs = getComparableRelationItemKeys(
    knowledgeDBs,
    currentRelation,
    filterTypes,
    false
  );

  return alternatives
    .filter((r) => {
      const useExactMatch = useExactItemMatchForRelation(r, currentRelation);
      const currentItemIDs = useExactMatch
        ? currentExactItemIDs
        : currentSemanticItemIDs;
      if (existingCrefTargetIDs.has(r.id)) {
        return false;
      }
      const { addCount, removeCount } = computeComparableRelationDiff(
        knowledgeDBs,
        r,
        currentRelation,
        filterTypes,
        useExactMatch
      );
      if (addCount === 0 && removeCount === 0) {
        return false;
      }
      const coveredIDs = coveredSuggestionIDs || ImmutableSet<string>();
      const addIDs = getRelationChildNodes(knowledgeDBs, r, r.author)
        .filter(
          (item) =>
            itemPassesFilters(item, filterTypes) &&
            item.relevance !== "not_relevant"
        )
        .map((item) =>
          useExactMatch
            ? shortID(item.id)
            : getSemanticNodeKey(
                knowledgeDBs,
                getSemanticID(knowledgeDBs, item),
                r.author
              )
        )
        .filter((id) => !currentItemIDs.has(id));
      const hasUncoveredAdds = addIDs.some((id) => !coveredIDs.has(id));
      return (
        hasUncoveredAdds || removeCount > suggestionSettings.maxSuggestions
      );
    })
    .sortBy((r) => -r.updated)
    .map((r) => r.id)
    .toList();
}
