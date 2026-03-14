import { List, OrderedMap, Set as ImmutableSet } from "immutable";
import {
  EMPTY_SEMANTIC_ID,
  getRelationChildNodes,
  shortID,
  splitID,
  isSearchId,
  parseSearchId,
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
    .groupBy((ref) => ref.relationID)
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
  const targetRelation = resolveNode(
    knowledgeDBs,
    getNode(knowledgeDBs, crefID, effectiveAuthor)
  );
  if (!targetRelation) {
    return undefined;
  }
  return getContextKey(getRelationContext(knowledgeDBs, targetRelation));
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
    .groupBy((ref) => getRefContextKey(knowledgeDBs, ref))
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
  const semanticKey = semanticID;
  const contextRoot = currentContext.first();
  const isInCurrentRootTree = (relation: GraphNode): boolean =>
    !!currentRoot && relation.root === currentRoot;
  const outgoingCrefIDs = currentItems
    ? currentItems
        .filter(isRefNode)
        .map((item) => item.id)
        .toList()
    : List<ID>();
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
    return refRoot === contextRoot;
  };
  const filtered = getSemanticCandidates(semanticIndex, semanticKey)
    .filter((relation) => !isRefNode(relation))
    .filter((relation) => visibleAuthors.has(relation.author))
    .filter(
      (relation) => !isInSystemRoot(knowledgeDBs, relation, LOG_ROOT_ROLE)
    )
    .filter((relation) => !isInCurrentRootTree(relation))
    .filter((relation) => relation.id !== currentRelationID)
    .map((relation) => ({
      ref: {
        relationID: relation.id,
        context: getRelationContext(knowledgeDBs, relation),
        updated: relation.updated,
      },
    }))
    .filter(({ ref }) => !ref.context.some((id) => isSearchId(id as ID)))
    .map(({ ref }) => ref)
    .filter((ref) =>
      ref.context.size === 0
        ? currentContext.size > 0
        : !contextRoot || !sharesSemanticRoot(ref)
    )
    .filter((ref) => !covered.has(getRefContextKey(knowledgeDBs, ref)));
  const deduped = filtered
    .groupBy((ref) => getRefContextKey(knowledgeDBs, ref))
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
    .sortBy((ref) => getRefContextKey(knowledgeDBs, ref))
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
    .filter((ref) => !covered.has(getRefContextKey(knowledgeDBs, ref)))
    .sortBy((ref) => `${-ref.updated}:${ref.context.join(":")}`)
    .map((ref) => ref.relationID)
    .toList();
}

export type AlternativeFooterResult = {
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
      t !== "occurrence" &&
      t !== undefined
  );
}

function getFilteredRelationItems(
  knowledgeDBs: KnowledgeDBs,
  relation: GraphNode,
  filterTypes: FooterTypeFilters
): List<GraphNode> {
  const itemFilters = getFooterItemFilters(filterTypes);
  return getRelationChildNodes(knowledgeDBs, relation, relation.author)
    .filter(
      (item) =>
        itemPassesFilters(item, itemFilters) &&
        item.relevance !== "not_relevant"
    )
    .toList();
}

function useExactItemMatchForRelation(
  relation: GraphNode,
  currentRelation: GraphNode
): boolean {
  return (
    relation.author === currentRelation.author &&
    relation.root === currentRelation.root
  );
}

function getComparableItemKey(
  knowledgeDBs: KnowledgeDBs,
  item: GraphNode,
  useExactMatch: boolean
): string {
  return useExactMatch ? shortID(item.id) : getNodeKey(knowledgeDBs, item);
}

function getAlternativeRelations(
  knowledgeDBs: KnowledgeDBs,
  semanticIndex: SemanticIndex,
  visibleAuthors: ImmutableSet<PublicKey>,
  semanticID: ID,
  context: Context,
  currentRelation: GraphNode
): List<GraphNode> {
  return getSemanticCandidates(semanticIndex, semanticID)
    .filter((relation) => !isRefNode(relation))
    .filter((relation) => visibleAuthors.has(relation.author))
    .filter((relation) => relation.id !== currentRelation.id)
    .filter(
      (relation) =>
        !(
          relation.author === currentRelation.author &&
          relation.root === currentRelation.root
        )
    )
    .filter(
      (relation) =>
        relation.systemRole === LOG_ROOT_ROLE ||
        !isInSystemRoot(knowledgeDBs, relation, LOG_ROOT_ROLE)
    )
    .filter((relation) =>
      contextsSemanticallyMatch(
        getRelationContext(knowledgeDBs, relation),
        context
      )
    )
    .filter(
      (relation) => relation.children.size > 0 || isStandaloneRoot(relation)
    )
    .sortBy((relation) => -relation.updated)
    .toList();
}

type AlternativeSummary = {
  relation: GraphNode;
  filteredChildren: List<GraphNode>;
  addKeys: ImmutableSet<string>;
  removeCount: number;
};

export function getAlternativeFooterData(
  knowledgeDBs: KnowledgeDBs,
  semanticIndex: SemanticIndex,
  visibleAuthors: ImmutableSet<PublicKey>,
  semanticID: ID,
  filterTypes: FooterTypeFilters,
  currentRelation?: GraphNode,
  parentContext?: Context,
  showSuggestions: boolean = true
): AlternativeFooterResult {
  if (!currentRelation || !filterTypes || filterTypes.length === 0) {
    return EMPTY_ALTERNATIVE_FOOTER_RESULT;
  }

  const suggestionsEnabled =
    showSuggestions && filterTypes.includes("suggestions");
  const versionsEnabled = filterTypes.includes("versions");

  if (!suggestionsEnabled && !versionsEnabled) {
    return EMPTY_ALTERNATIVE_FOOTER_RESULT;
  }

  const contextToMatch = parentContext || List<ID>();
  const alternatives = getAlternativeRelations(
    knowledgeDBs,
    semanticIndex,
    visibleAuthors,
    semanticID,
    contextToMatch,
    currentRelation
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
  const declinedTargetIDs = currentRelationChildren
    .filter((item) => isRefNode(item) && item.relevance === "not_relevant")
    .flatMap((item) => {
      const { targetID } = item;
      return targetID ? [targetID] : [];
    })
    .toSet();
  const currentRelationItemIDs = currentRelationChildren
    .map((item) => item.id)
    .toSet();
  const currentRelationItemKeys = currentRelationChildren
    .map((item) => getNodeKey(knowledgeDBs, item))
    .toSet();
  const currentExactItemKeys = getFilteredRelationItems(
    knowledgeDBs,
    currentRelation,
    filterTypes
  )
    .map((item) => shortID(item.id))
    .toSet();
  const currentSemanticItemKeys = getFilteredRelationItems(
    knowledgeDBs,
    currentRelation,
    filterTypes
  )
    .map((item) => getNodeKey(knowledgeDBs, item))
    .toSet();

  const summaries = alternatives.map((relation): AlternativeSummary => {
    const useExactMatch = useExactItemMatchForRelation(
      relation,
      currentRelation
    );
    const filteredChildren = getFilteredRelationItems(
      knowledgeDBs,
      relation,
      filterTypes
    );
    const candidateKeys = filteredChildren
      .map((item) => getComparableItemKey(knowledgeDBs, item, useExactMatch))
      .toSet();
    const currentKeys = useExactMatch
      ? currentExactItemKeys
      : currentSemanticItemKeys;
    return {
      relation,
      filteredChildren,
      addKeys: candidateKeys.filter((key) => !currentKeys.has(key)).toSet(),
      removeCount: currentKeys.filter((key) => !candidateKeys.has(key)).size,
    };
  });

  const candidateItemIDs = suggestionsEnabled
    ? summaries
        .filter(({ relation }) => relation.author !== currentRelation.author)
        .filter(({ relation }) => !declinedTargetIDs.has(relation.id))
        .reduce((acc, { filteredChildren }) => {
          return filteredChildren.reduce((itemAcc, item) => {
            if (currentRelationItemIDs.has(item.id)) {
              return itemAcc;
            }
            const candidateKey = getNodeKey(knowledgeDBs, item);
            if (
              currentRelationItemKeys.has(candidateKey) ||
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
    ? summaries
        .filter(({ relation }) => !existingCrefTargetIDs.has(relation.id))
        .filter(
          ({ addKeys, removeCount }) => addKeys.size > 0 || removeCount > 0
        )
        .filter(
          ({ addKeys, removeCount }) =>
            addKeys.some((key) => !coveredCandidateIDs.has(key)) ||
            removeCount > suggestionSettings.maxSuggestions
        )
        .map(({ relation }) => relation.id)
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
