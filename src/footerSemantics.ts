import { List, OrderedMap, Set as ImmutableSet } from "immutable";
import {
  shortID,
  splitID,
  isConcreteRefId,
  parseConcreteRefId,
  itemMatchesType,
  createConcreteRefId,
  findRefsToNode,
  getTextHashForMatching,
  itemPassesFilters,
  getRelationItemNodeID,
  getIndexedRelationsForKeys,
  getRelationContext,
  getRelationNodeID,
  getRelationsNoReferencedBy,
} from "./connections";
import { suggestionSettings } from "./constants";

type FooterTypeFilters = (
  | Relevance
  | Argument
  | "suggestions"
  | "versions"
  | "incoming"
  | "occurrence"
  | "contains"
)[];

export function contextsMatch(a: Context, b: Context): boolean {
  return a.equals(b);
}

export function getSemanticNodeKey(
  knowledgeDBs: KnowledgeDBs,
  nodeID: LongID | ID,
  author: PublicKey
): string {
  return getTextHashForMatching(knowledgeDBs, nodeID, author) || shortID(nodeID);
}

export function nodesSemanticallyMatch(
  knowledgeDBs: KnowledgeDBs,
  leftNodeID: LongID | ID,
  leftAuthor: PublicKey,
  rightNodeID: LongID | ID,
  rightAuthor: PublicKey
): boolean {
  return (
    getSemanticNodeKey(knowledgeDBs, leftNodeID, leftAuthor) ===
    getSemanticNodeKey(knowledgeDBs, rightNodeID, rightAuthor)
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

function getComparableSuggestionKey(
  knowledgeDBs: KnowledgeDBs,
  itemNodeID: LongID | ID,
  fallbackAuthor: PublicKey
): string {
  if (!isConcreteRefId(itemNodeID)) {
    return getSemanticNodeKey(knowledgeDBs, itemNodeID, fallbackAuthor);
  }

  const parsed = parseConcreteRefId(itemNodeID);
  if (!parsed) {
    return shortID(itemNodeID as ID);
  }

  const relation = getRelationsNoReferencedBy(
    knowledgeDBs,
    parsed.relationID,
    fallbackAuthor
  );
  if (!relation) {
    return shortID(itemNodeID as ID);
  }

  return getSemanticNodeKey(
    knowledgeDBs,
    parsed.targetNode || getRelationNodeID(relation),
    relation.author
  );
}

export type SuggestionsResult = {
  suggestions: List<LongID | ID>;
  coveredCandidateIDs: ImmutableSet<string>;
  crefSuggestionIDs: ImmutableSet<string>;
};

const EMPTY_SUGGESTIONS_RESULT: SuggestionsResult = {
  suggestions: List<LongID | ID>(),
  coveredCandidateIDs: ImmutableSet<string>(),
  crefSuggestionIDs: ImmutableSet<string>(),
};

export function getSuggestionsForNode(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  nodeID: LongID | ID,
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

  const [, localID] = splitID(nodeID);

  const currentRelation = currentRelationId
    ? getRelationsNoReferencedBy(knowledgeDBs, currentRelationId, myself)
    : undefined;
  const currentRelationItems: ImmutableSet<LongID | ID> = currentRelation
    ? currentRelation.items.map((item) => item.id).toSet()
    : ImmutableSet<LongID | ID>();
  const currentRelationItemKeys: ImmutableSet<string> = currentRelation
    ? currentRelation.items
        .map((item) =>
          getComparableSuggestionKey(
            knowledgeDBs,
            getRelationItemNodeID(knowledgeDBs, item, currentRelation.author),
            currentRelation.author
          )
        )
        .toSet()
    : ImmutableSet<string>();

  const declinedRelationCrefIDs: ImmutableSet<LongID | ID> = currentRelation
    ? currentRelation.items
        .filter(
          (item) => isConcreteRefId(item.id) && item.relevance === "not_relevant"
        )
        .map((item) => item.id)
        .toSet()
    : ImmutableSet<LongID | ID>();

  const contextToMatch = parentContext || List<ID>();
  const otherRelations: List<Relations> = knowledgeDBs
    .filter((_, pk) => pk !== myself)
    .toList()
    .flatMap((db) =>
      db.relations
        .filter(
          (r) =>
            nodesSemanticallyMatch(
              knowledgeDBs,
              getRelationNodeID(r),
              r.author,
              localID,
              myself
            ) &&
            r.id !== currentRelationId &&
            !declinedRelationCrefIDs.has(createConcreteRefId(r.id)) &&
            contextsSemanticallyMatch(
              knowledgeDBs,
              getRelationContext(knowledgeDBs, r),
              r.author,
              contextToMatch,
              myself
            )
        )
        .toList()
    )
    .sortBy((r) => -r.updated);

  const candidateNodeIDs = otherRelations.reduce(
    (acc: OrderedMap<string, ID>, relations: Relations) => {
      return relations.items.reduce((itemAcc, item: RelationItem) => {
        if (
          !itemFilters.some((t) => itemMatchesType(item, t)) ||
          item.relevance === "not_relevant" ||
          currentRelationItems.has(item.id)
        ) {
          return itemAcc;
        }
        const candidateNodeID = getRelationItemNodeID(
          knowledgeDBs,
          item,
          relations.author
        );
        const candidateKey = getSemanticNodeKey(
          knowledgeDBs,
          candidateNodeID,
          relations.author
        );
        if (
          currentRelationItemKeys.has(candidateKey) ||
          itemAcc.has(candidateKey)
        ) {
          return itemAcc;
        }
        return itemAcc.set(candidateKey, shortID(candidateNodeID) as ID);
      }, acc);
    },
    OrderedMap<string, ID>()
  );

  if (candidateNodeIDs.size === 0) {
    return EMPTY_SUGGESTIONS_RESULT;
  }

  const cappedCandidates = candidateNodeIDs
    .entrySeq()
    .take(suggestionSettings.maxSuggestions)
    .toList();

  const itemContext = parentContext
    ? parentContext.push(localID as ID)
    : List<ID>([localID as ID]);

  const reduced = cappedCandidates.reduce(
    (acc, [, candidateID]) => {
      if (isConcreteRefId(candidateID as LongID)) {
        return {
          ...acc,
          suggestions: acc.suggestions.push(candidateID as LongID),
          crefSuggestionIDs: acc.crefSuggestionIDs.add(candidateID),
        };
      }
      const refs = findRefsToNode(
        knowledgeDBs,
        candidateID,
        itemContext,
        currentRelation?.author || myself,
        currentRelation?.root
      );
      const headRefs = refs.filter(
        (ref) => !ref.targetNode && splitID(ref.relationID)[0] !== myself
      );
      if (headRefs.size > 0) {
        const first = headRefs.sortBy((r) => -r.updated).first()!;
        return {
          ...acc,
          suggestions: acc.suggestions.push(
            createConcreteRefId(first.relationID)
          ),
        };
      }
      const expandableRelation = getAlternativeRelations(
        knowledgeDBs,
        candidateID,
        itemContext,
        undefined,
        currentRelation?.author || myself,
        currentRelation?.root
      )
        .filter((relation) => relation.author !== myself && relation.items.size > 0)
        .sortBy((relation) => -relation.updated)
        .first();
      if (expandableRelation) {
        return {
          ...acc,
          suggestions: acc.suggestions.push(
            createConcreteRefId(expandableRelation.id)
          ),
        };
      }
      return {
        suggestions: acc.suggestions.push(candidateID as LongID | ID),
        crefSuggestionIDs: isConcreteRefId(candidateID as LongID)
          ? acc.crefSuggestionIDs.add(candidateID)
          : acc.crefSuggestionIDs,
      };
    },
    {
      suggestions: List<LongID | ID>(),
      crefSuggestionIDs: ImmutableSet<string>(),
    }
  );

  return {
    suggestions: reduced.suggestions,
    coveredCandidateIDs: cappedCandidates
      .map(([candidateKey]) => candidateKey)
      .toSet() as ImmutableSet<string>,
    crefSuggestionIDs: reduced.crefSuggestionIDs,
  };
}

export function getAlternativeRelations(
  knowledgeDBs: KnowledgeDBs,
  nodeID: LongID | ID,
  context: Context,
  excludeRelationId?: LongID,
  currentAuthor?: PublicKey,
  currentRoot?: ID
): List<Relations> {
  const localID = shortID(nodeID);
  const author = currentAuthor;
  if (!author) {
    return List<Relations>();
  }
  const semanticKey = getSemanticNodeKey(knowledgeDBs, nodeID, author);
  return knowledgeDBs
    .entrySeq()
    .flatMap(([, db]) =>
      List(getIndexedRelationsForKeys(db, [localID, semanticKey])).filter(
        (r) => {
          if (
            currentRoot !== undefined &&
            r.author === author &&
            r.root === currentRoot
          ) {
            return false;
          }
          const useExactMatch =
            r.author === author &&
            currentRoot !== undefined &&
            r.root === currentRoot;
          const relationContext = getRelationContext(knowledgeDBs, r);
          const matchesNode = useExactMatch
            ? shortID(getRelationNodeID(r)) === localID
            : nodesSemanticallyMatch(
                knowledgeDBs,
                getRelationNodeID(r),
                r.author,
                localID,
                author
              );
          const matchesContext = useExactMatch
            ? contextsMatch(relationContext, context)
            : contextsSemanticallyMatch(
                knowledgeDBs,
                relationContext,
                r.author,
                context,
                author
              );
          return (
            matchesNode &&
            r.id !== excludeRelationId &&
            matchesContext &&
            (r.items.size > 0 || r.root === shortID(r.id))
          );
        }
      )
    )
    .toList();
}

function useExactItemMatchForRelation(
  relation: Relations,
  currentRelation?: Relations
): boolean {
  return (
    !!currentRelation &&
    relation.author === currentRelation.author &&
    relation.root === currentRelation.root
  );
}

function getComparableRelationItemKeys(
  knowledgeDBs: KnowledgeDBs,
  relation: Relations,
  filterTypes: FooterTypeFilters,
  useExactMatch: boolean
): ImmutableSet<string> {
  return relation.items
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
            getRelationItemNodeID(knowledgeDBs, item, relation.author),
            relation.author
          )
    )
    .toSet();
}

function computeComparableRelationDiff(
  knowledgeDBs: KnowledgeDBs,
  versionRelation: Relations,
  parentRelation: Relations | undefined,
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
  nodeID: LongID | ID,
  filterTypes: FooterTypeFilters,
  currentRelation?: Relations,
  parentContext?: Context,
  coveredSuggestionIDs?: ImmutableSet<string>
): List<LongID> {
  if (!filterTypes || !filterTypes.includes("versions") || !currentRelation) {
    return List<LongID>();
  }

  const contextToMatch = parentContext || List<ID>();
  const alternatives = getAlternativeRelations(
    knowledgeDBs,
    nodeID,
    contextToMatch,
    currentRelation?.id,
    currentRelation?.author,
    currentRelation?.root
  );

  const existingCrefIDs = currentRelation.items
    .map((item) => item.id)
    .filter((id) => isConcreteRefId(id))
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
      if (existingCrefIDs.has(createConcreteRefId(r.id))) {
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
      const addIDs = r.items
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
                getRelationItemNodeID(knowledgeDBs, item, r.author),
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
    .map((r) => createConcreteRefId(r.id))
    .toList();
}
