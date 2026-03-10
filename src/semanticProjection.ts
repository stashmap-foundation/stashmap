import { List, OrderedMap, Set as ImmutableSet } from "immutable";
import {
  EMPTY_SEMANTIC_ID,
  hashText,
  shortID,
  splitID,
  isRefId,
  isSearchId,
  parseSearchId,
  isConcreteRefId,
  parseConcreteRefId,
  itemMatchesType,
  createConcreteRefId,
  itemPassesFilters,
  getRelationItemSemanticID,
  getRelationItemRelation,
  getIndexedRelationsForKeys,
  getRelationContext,
  getRelationSemanticID,
  getRelationText,
  getConcreteRefTargetRelation,
  getRelationsNoReferencedBy,
} from "./connections";
import { suggestionSettings } from "./constants";
import { LOG_ROOT_ROLE } from "./systemRoots";

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

function getFallbackSemanticText(semanticID?: LongID | ID): string {
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

function getRelationsForSemanticID(
  knowledgeDBs: KnowledgeDBs,
  semanticID: LongID | ID,
  author: PublicKey
): Relations[] {
  if (isRefId(semanticID) || isSearchId(semanticID as ID)) {
    return [];
  }

  const directRelation = getRelationsNoReferencedBy(
    knowledgeDBs,
    semanticID,
    author
  );
  if (directRelation) {
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
    candidateDBs.flatMap((db) => getIndexedRelationsForKeys(db, [localID]))
  )
    .sort((left, right) => {
      const leftExact =
        shortID(getRelationSemanticID(left)) === localID ? 0 : 1;
      const rightExact =
        shortID(getRelationSemanticID(right)) === localID ? 0 : 1;
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

export function getRelationForSemanticID(
  knowledgeDBs: KnowledgeDBs,
  semanticID: LongID | ID,
  author: PublicKey
): Relations | undefined {
  return getRelationsForSemanticID(knowledgeDBs, semanticID, author)[0];
}

export function getTextForSemanticID(
  knowledgeDBs: KnowledgeDBs,
  semanticID: LongID | ID,
  author: PublicKey
): string | undefined {
  if (isRefId(semanticID)) {
    return undefined;
  }

  const localID = shortID(semanticID as ID) as ID;
  if (isSearchId(localID)) {
    return parseSearchId(localID) || "";
  }

  const directRelation = getRelationsNoReferencedBy(
    knowledgeDBs,
    semanticID,
    author
  );
  if (directRelation) {
    return getRelationText(directRelation);
  }

  const relation = getRelationForSemanticID(knowledgeDBs, semanticID, author);
  const relationText = getRelationText(relation);
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
  semanticID: LongID | ID,
  author: PublicKey
): ID | undefined {
  const directRelation = getRelationsNoReferencedBy(
    knowledgeDBs,
    semanticID,
    author
  );
  if (directRelation) {
    return directRelation.textHash;
  }

  const relation = getRelationForSemanticID(knowledgeDBs, semanticID, author);
  if (relation) {
    return relation.textHash;
  }

  const localID = shortID(semanticID as ID) as ID;
  const fallbackText = getFallbackSemanticText(semanticID);
  return fallbackText !== "" || localID === EMPTY_SEMANTIC_ID
    ? hashText(fallbackText)
    : undefined;
}

export function getSemanticNodeKey(
  knowledgeDBs: KnowledgeDBs,
  semanticID: LongID | ID,
  author: PublicKey
): string {
  return (
    getTextHashForSemanticID(knowledgeDBs, semanticID, author) ||
    shortID(semanticID)
  );
}

export function nodesSemanticallyMatch(
  knowledgeDBs: KnowledgeDBs,
  leftSemanticID: LongID | ID,
  leftAuthor: PublicKey,
  rightSemanticID: LongID | ID,
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

function nodesMatchForRefs(
  knowledgeDBs: KnowledgeDBs,
  candidateSemanticID: LongID | ID,
  candidateAuthor: PublicKey,
  candidateRoot: ID,
  targetSemanticID: LongID | ID,
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

type RawAppearance = {
  relation: Relations;
  isHead: boolean;
  matchedItemRelation?: Relations;
};

function findNodeAppearances(
  knowledgeDBs: KnowledgeDBs,
  semanticID: LongID | ID,
  targetAuthor?: PublicKey,
  targetRoot?: ID
): List<RawAppearance> {
  return knowledgeDBs.reduce((acc, knowledgeDB) => {
    return knowledgeDB.relations.reduce((rdx, relation) => {
      if (
        isSearchId(getRelationSemanticID(relation)) ||
        getRelationContext(knowledgeDBs, relation).some((id) =>
          isSearchId(id as ID)
        )
      ) {
        return rdx;
      }
      const targetSemanticKey = getSemanticNodeKey(
        knowledgeDBs,
        semanticID,
        targetAuthor || relation.author
      );
      const matchedItem = relation.items.find((item) => {
        const itemSemanticID = getRelationItemSemanticID(
          knowledgeDBs,
          item,
          relation.author
        );
        if (item.relevance === "not_relevant" || isRefId(itemSemanticID)) {
          return false;
        }
        if (
          targetAuthor !== undefined &&
          targetRoot !== undefined &&
          relation.author === targetAuthor &&
          relation.root === targetRoot
        ) {
          return shortID(itemSemanticID as ID) === shortID(semanticID as ID);
        }
        return (
          getTextHashForSemanticID(knowledgeDBs, item.id, relation.author) ===
          targetSemanticKey
        );
      });
      const isInItems = !!matchedItem;
      const isHeadWithChildren =
        relation.items.size > 0 &&
        ((targetAuthor !== undefined &&
          targetRoot !== undefined &&
          relation.author === targetAuthor &&
          relation.root === targetRoot &&
          shortID(getRelationSemanticID(relation) as ID) ===
            shortID(semanticID as ID)) ||
          relation.textHash === targetSemanticKey);
      if (!isHeadWithChildren && !isInItems) {
        return rdx;
      }
      const matchedItemRelation = matchedItem
        ? getRelationItemRelation(knowledgeDBs, matchedItem, relation.author)
        : undefined;
      return rdx.push({
        relation,
        isHead: isHeadWithChildren && !isInItems,
        matchedItemRelation,
      });
    }, acc);
  }, List<RawAppearance>());
}

function resolveAppearance(
  knowledgeDBs: KnowledgeDBs,
  app: RawAppearance
): ReferencedByRef {
  const { relation, isHead, matchedItemRelation } = app;
  if (isHead) {
    return {
      relationID: relation.id,
      context: getRelationContext(knowledgeDBs, relation),
      updated: relation.updated,
    };
  }
  if (matchedItemRelation) {
    return {
      relationID: matchedItemRelation.id,
      context: getRelationContext(knowledgeDBs, matchedItemRelation),
      updated: matchedItemRelation.updated,
    };
  }
  return {
    relationID: relation.id,
    context: getRelationContext(knowledgeDBs, relation),
    updated: relation.updated,
  };
}

export function findRefsToNode(
  knowledgeDBs: KnowledgeDBs,
  semanticID: LongID | ID,
  filterContext?: Context,
  targetAuthor?: PublicKey,
  targetRoot?: ID
): List<ReferencedByRef> {
  const appearances = findNodeAppearances(
    knowledgeDBs,
    semanticID,
    targetAuthor,
    targetRoot
  );
  const resolvedRefs = appearances
    .map((app) => ({
      ref: resolveAppearance(knowledgeDBs, app),
      author: app.relation.author,
      root: app.relation.root,
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
  crefID: LongID | ID,
  effectiveAuthor: PublicKey
): string | undefined {
  const parsed = parseConcreteRefId(crefID);
  if (!parsed) return undefined;
  const relation = getRelationsNoReferencedBy(
    knowledgeDBs,
    parsed.relationID,
    effectiveAuthor
  );
  const targetRelation = getConcreteRefTargetRelation(
    knowledgeDBs,
    crefID,
    effectiveAuthor
  );
  if (!relation || !targetRelation) {
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
  crefIDs: List<LongID | ID>,
  effectiveAuthor: PublicKey
): ImmutableSet<string> {
  return crefIDs.reduce((acc, crefID) => {
    const key = contextKeyForCref(knowledgeDBs, crefID, effectiveAuthor);
    return key !== undefined ? acc.add(key) : acc;
  }, ImmutableSet<string>());
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
  semanticID: LongID | ID,
  currentRelationID: LongID | undefined,
  effectiveAuthor: PublicKey,
  currentContext: Context,
  currentRoot?: ID,
  currentItems?: List<RelationItem>,
  incomingCrefIDs?: List<LongID>
): List<LongID> {
  const allRefs = findRefsToNode(
    knowledgeDBs,
    semanticID,
    undefined,
    effectiveAuthor,
    currentRoot
  );
  const contextRoot = currentContext.first();
  const outgoingCrefIDs = currentItems
    ? currentItems
        .map((item) => item.id)
        .filter(isConcreteRefId)
        .toList()
    : List<LongID | ID>();
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
    .map((ref) => createConcreteRefId(ref.relationID))
    .toList();
}

export function getIncomingCrefsForNode(
  knowledgeDBs: KnowledgeDBs,
  currentSemanticID: LongID | ID,
  parentRelationID: LongID | undefined,
  currentRelationID: LongID | undefined,
  effectiveAuthor: PublicKey,
  currentItems?: List<RelationItem>
): List<LongID> {
  const outgoingCrefIDs = (currentItems || List<RelationItem>())
    .map((item) => item.id)
    .filter(isConcreteRefId)
    .toList();
  const covered = coveredContextKeys(
    knowledgeDBs,
    outgoingCrefIDs,
    effectiveAuthor
  );
  const outgoingTargetRelIDs = (currentItems || List<RelationItem>()).reduce(
    (acc, item) => {
      const targetRelation = getConcreteRefTargetRelation(
        knowledgeDBs,
        item.id,
        effectiveAuthor
      );
      return targetRelation ? acc.add(targetRelation.id) : acc;
    },
    ImmutableSet<LongID>()
  );

  const refs = knowledgeDBs.reduce((acc, knowledgeDB) => {
    return knowledgeDB.relations.reduce((rdx, relation) => {
      if (relation.id === parentRelationID) return rdx;
      if (relation.id === currentRelationID) return rdx;
      if (relation.systemRole === LOG_ROOT_ROLE) return rdx;
      if (outgoingTargetRelIDs.has(relation.id)) return rdx;

      const hasCrefToUs = relation.items.some((item) => {
        if (!isConcreteRefId(item.id)) return false;
        if (item.relevance === "not_relevant") return false;
        const targetRelation = getConcreteRefTargetRelation(
          knowledgeDBs,
          item.id,
          effectiveAuthor
        );
        return !!currentRelationID && targetRelation?.id === currentRelationID;
      });

      if (!hasCrefToUs) return rdx;

      const ref: ReferencedByRef = {
        relationID: relation.id,
        context: getRelationContext(knowledgeDBs, relation),
        updated: relation.updated,
      };
      return rdx.push(ref);
    }, acc);
  }, List<ReferencedByRef>());

  const deduped = deduplicateRefsByContext(refs, knowledgeDBs, effectiveAuthor);
  return deduped
    .filter(
      (ref) =>
        !covered.has(getRefContextKey(knowledgeDBs, ref, effectiveAuthor))
    )
    .sortBy((ref) => `${-ref.updated}:${ref.context.join(":")}`)
    .map((ref) => createConcreteRefId(ref.relationID))
    .toList();
}

function getComparableSuggestionKey(
  knowledgeDBs: KnowledgeDBs,
  itemSemanticID: LongID | ID,
  fallbackAuthor: PublicKey
): string {
  if (!isConcreteRefId(itemSemanticID)) {
    return getSemanticNodeKey(knowledgeDBs, itemSemanticID, fallbackAuthor);
  }

  const parsed = parseConcreteRefId(itemSemanticID);
  if (!parsed) {
    return shortID(itemSemanticID as ID);
  }

  const relation = getRelationsNoReferencedBy(
    knowledgeDBs,
    parsed.relationID,
    fallbackAuthor
  );
  const targetRelation = getConcreteRefTargetRelation(
    knowledgeDBs,
    itemSemanticID,
    fallbackAuthor
  );
  if (!relation || !targetRelation) {
    return shortID(itemSemanticID as ID);
  }

  return getSemanticNodeKey(
    knowledgeDBs,
    getRelationSemanticID(targetRelation),
    targetRelation.author
  );
}

export type SuggestionsResult = {
  suggestions: List<LongID | ID>;
  coveredCandidateIDs: ImmutableSet<string>;
};

const EMPTY_SUGGESTIONS_RESULT: SuggestionsResult = {
  suggestions: List<LongID | ID>(),
  coveredCandidateIDs: ImmutableSet<string>(),
};

export function getSuggestionsForNode(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  semanticID: LongID | ID,
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

  const [, localID] = splitID(semanticID);

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
            getRelationItemSemanticID(
              knowledgeDBs,
              item,
              currentRelation.author
            ),
            currentRelation.author
          )
        )
        .toSet()
    : ImmutableSet<string>();

  const declinedRelationCrefIDs: ImmutableSet<LongID | ID> = currentRelation
    ? currentRelation.items
        .filter(
          (item) =>
            isConcreteRefId(item.id) && item.relevance === "not_relevant"
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
              getRelationSemanticID(r),
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

  const candidateItemIDs = otherRelations.reduce(
    (acc: OrderedMap<string, LongID | ID>, relations: Relations) => {
      return relations.items.reduce((itemAcc, item: RelationItem) => {
        if (
          !itemFilters.some((t) => itemMatchesType(item, t)) ||
          item.relevance === "not_relevant" ||
          currentRelationItems.has(item.id)
        ) {
          return itemAcc;
        }
        const candidateSemanticID = getRelationItemSemanticID(
          knowledgeDBs,
          item,
          relations.author
        );
        const candidateKey = getSemanticNodeKey(
          knowledgeDBs,
          candidateSemanticID,
          relations.author
        );
        if (
          currentRelationItemKeys.has(candidateKey) ||
          itemAcc.has(candidateKey)
        ) {
          return itemAcc;
        }
        return itemAcc.set(candidateKey, item.id);
      }, acc);
    },
    OrderedMap<string, LongID | ID>()
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
      .map(([, candidateID]) => candidateID as LongID | ID)
      .toList(),
    coveredCandidateIDs: cappedCandidates
      .map(([candidateKey]) => candidateKey)
      .toSet() as ImmutableSet<string>,
  };
}

export function getAlternativeRelations(
  knowledgeDBs: KnowledgeDBs,
  semanticID: LongID | ID,
  context: Context,
  excludeRelationId?: LongID,
  currentAuthor?: PublicKey,
  currentRoot?: ID
): List<Relations> {
  const localID = shortID(semanticID);
  const author = currentAuthor;
  if (!author) {
    return List<Relations>();
  }
  const semanticKey = getSemanticNodeKey(knowledgeDBs, semanticID, author);
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
            ? shortID(getRelationSemanticID(r)) === localID
            : nodesSemanticallyMatch(
                knowledgeDBs,
                getRelationSemanticID(r),
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
            getRelationItemSemanticID(knowledgeDBs, item, relation.author),
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
  semanticID: LongID | ID,
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
    semanticID,
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
                getRelationItemSemanticID(knowledgeDBs, item, r.author),
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
