import { List, Set, Map } from "immutable";
import crypto from "crypto";
import { newRelations } from "./ViewContext";
import { SEARCH_PREFIX } from "./constants";

// Content-addressed node ID generation
// Node ID = sha256(text).slice(0, 32) - no author prefix
export function hashText(text: string): ID {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 32);
}

// Pre-computed hash for the ~Log node (home page, linked to root-level notes)
export const LOG_NODE_ID = hashText("~Log");

// Pre-computed hash for empty node (used as placeholder when creating new nodes)
export const EMPTY_NODE_ID = hashText("") as ID;

export type TextSeed = {
  id: ID;
  text: string;
  textHash: ID;
};

const CONCRETE_REF_PREFIX = "cref:";
const SHORT_NODE_ID_RE = /^[a-f0-9]{32}$/;

function createRandomNodeID(): ID {
  return crypto.randomBytes(16).toString("hex") as ID;
}

function getReservedNodeID(text: string): ID | undefined {
  if (text === "~Log") {
    return LOG_NODE_ID;
  }
  if (text === "") {
    return EMPTY_NODE_ID;
  }
  return undefined;
}

export function createNodeID(text: string, id?: ID): ID {
  return getReservedNodeID(text) ?? id ?? createRandomNodeID();
}

export function nodeIDFromSeed(seed: string): ID {
  const normalized = seed.replace(/-/g, "");
  return SHORT_NODE_ID_RE.test(normalized)
    ? (normalized as ID)
    : hashText(seed);
}

export function isRefId(id: ID | LongID): boolean {
  return id.startsWith(CONCRETE_REF_PREFIX);
}

export function isConcreteRefId(id: ID | LongID): boolean {
  return id.startsWith(CONCRETE_REF_PREFIX);
}

export function isSearchId(id: ID): boolean {
  return id.startsWith(SEARCH_PREFIX);
}

export function createSearchId(query: string): ID {
  return `${SEARCH_PREFIX}${query}` as ID;
}

export function parseSearchId(id: ID): string | undefined {
  if (!isSearchId(id)) {
    return undefined;
  }
  return id.slice(SEARCH_PREFIX.length);
}

export function createConcreteRefId(
  relationID: LongID,
  targetNode?: ID
): LongID {
  if (targetNode) {
    return `${CONCRETE_REF_PREFIX}${relationID}:${targetNode}` as LongID;
  }
  return `${CONCRETE_REF_PREFIX}${relationID}` as LongID;
}

export function parseConcreteRefId(
  refId: ID | LongID
): { relationID: LongID; targetNode?: ID } | undefined {
  if (!isConcreteRefId(refId)) {
    return undefined;
  }
  const content = refId.slice(CONCRETE_REF_PREFIX.length);
  const colonIndex = content.lastIndexOf(":");
  if (colonIndex === -1) {
    return { relationID: content as LongID };
  }
  const possibleTargetNode = content.slice(colonIndex + 1) as ID;
  if (!SHORT_NODE_ID_RE.test(possibleTargetNode)) {
    return { relationID: content as LongID };
  }
  const relationID = content.slice(0, colonIndex) as LongID;
  return { relationID, targetNode: possibleTargetNode };
}

export function splitID(id: ID): [PublicKey | undefined, string] {
  const split = id.split("_");
  if (split.length === 1) {
    return [undefined, split[0]];
  }
  return [split[0] as PublicKey, split.slice(1).join(":")];
}

export function joinID(remote: PublicKey | string, id: string): LongID {
  return `${remote}_${id}` as LongID;
}

export function shortID(id: ID): string {
  if (isSearchId(id) || isConcreteRefId(id)) {
    return id;
  }
  return splitID(id)[1];
}

function getFallbackRelationText(head: LongID | ID): string {
  const localHead = shortID(head as ID) as ID;
  if (localHead === LOG_NODE_ID) {
    return "~Log";
  }
  if (localHead === EMPTY_NODE_ID) {
    return "";
  }
  if (isSearchId(localHead)) {
    return parseSearchId(localHead) || "";
  }
  return "";
}

export function getRelationText(
  relation: Relations | undefined
): string | undefined {
  if (!relation) {
    return undefined;
  }
  const fallback = getFallbackRelationText(relation.head);
  if (relation.text !== "") {
    return relation.text;
  }
  return fallback || undefined;
}

type RelationLookupIndex = globalThis.Map<string, Relations[]>;

const relationLookupIndexCache = new WeakMap<KnowledgeData, RelationLookupIndex>();
const relationContextCache = new WeakMap<KnowledgeData, globalThis.Map<string, Context>>();

function getRelationLookupIndex(db: KnowledgeData): RelationLookupIndex {
  const cached = relationLookupIndexCache.get(db);
  if (cached) {
    return cached;
  }

  const index = new globalThis.Map<string, Relations[]>();
  const addToIndex = (key: string, relation: Relations): void => {
    const existing = index.get(key);
    if (existing) {
      existing.push(relation);
      return;
    }
    index.set(key, [relation]);
  };

  db.relations.valueSeq().forEach((relation) => {
    addToIndex(relation.head, relation);
    if (relation.textHash !== relation.head) {
      addToIndex(relation.textHash, relation);
    }
  });

  index.forEach((relations) => {
    relations.sort((left, right) => right.updated - left.updated);
  });

  relationLookupIndexCache.set(db, index);
  return index;
}

function getRelationContextIndex(db: KnowledgeData): globalThis.Map<string, Context> {
  const cached = relationContextCache.get(db);
  if (cached) {
    return cached;
  }
  const index = new globalThis.Map<string, Context>();
  relationContextCache.set(db, index);
  return index;
}

export function getIndexedRelationsForKeys(
  db: KnowledgeData,
  keys: string[]
): Relations[] {
  const uniqueKeys = Array.from(new globalThis.Set(keys));
  const seen = new globalThis.Set<string>();
  return uniqueKeys.flatMap((key) =>
    (getRelationLookupIndex(db).get(key) || []).filter((relation) => {
      const relationKey = shortID(relation.id);
      if (seen.has(relationKey)) {
        return false;
      }
      seen.add(relationKey);
      return true;
    })
  );
}

function getRelationTextHash(
  _knowledgeDBs: KnowledgeDBs,
  relation: Relations
): ID {
  return relation.textHash;
}

export function getRelationNodeID(relation: Relations): ID {
  const localHead = shortID(relation.head as ID) as ID;
  if (
    localHead === LOG_NODE_ID ||
    localHead === EMPTY_NODE_ID ||
    isSearchId(localHead)
  ) {
    return localHead;
  }
  return relation.text !== "" ? relation.textHash : localHead;
}

export function getRelationContext(
  knowledgeDBs: KnowledgeDBs,
  relation: Relations
): Context {
  const db = knowledgeDBs.get(relation.author);
  const relationKey = shortID(relation.id);
  if (db) {
    const cached = getRelationContextIndex(db).get(relationKey);
    if (cached) {
      return cached;
    }
  }

  const fallbackContext = relation.context;
  if (!relation.parent) {
    if (db) {
      getRelationContextIndex(db).set(relationKey, fallbackContext);
    }
    return fallbackContext;
  }

  const visited = new globalThis.Set<string>([relationKey]);
  const segments: ID[] = [];
  let currentParentID: LongID | undefined = relation.parent;

  while (currentParentID) {
    const parentKey = shortID(currentParentID);
    if (visited.has(parentKey)) {
      if (db) {
        getRelationContextIndex(db).set(relationKey, fallbackContext);
      }
      return fallbackContext;
    }
    visited.add(parentKey);

    const parentRelation = getRelationsNoReferencedBy(
      knowledgeDBs,
      currentParentID,
      relation.author
    );
    if (!parentRelation) {
      if (db) {
        getRelationContextIndex(db).set(relationKey, fallbackContext);
      }
      return fallbackContext;
    }
    segments.unshift(getRelationNodeID(parentRelation));
    currentParentID = parentRelation.parent;
  }

  const derivedContext = List<ID>(segments);
  if (db) {
    getRelationContextIndex(db).set(relationKey, derivedContext);
  }
  return derivedContext;
}

export function getRelationStack(
  knowledgeDBs: KnowledgeDBs,
  relation: Relations
): ID[] {
  return [...getRelationContext(knowledgeDBs, relation).toArray(), getRelationNodeID(relation)];
}

export function getRelationDepth(
  knowledgeDBs: KnowledgeDBs,
  relation: Relations
): number {
  return getRelationContext(knowledgeDBs, relation).size;
}

function getMatchingRelations(
  knowledgeDBs: KnowledgeDBs,
  nodeID: LongID | ID,
  author: PublicKey
): Relations[] {
  if (isRefId(nodeID) || isSearchId(nodeID as ID)) {
    return [];
  }

  const directRelation = getRelationsNoReferencedBy(knowledgeDBs, nodeID, author);
  if (directRelation) {
    return [directRelation];
  }

  const [remote, localID] = splitID(nodeID as ID);
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

  return candidateDBs
    .flatMap((db) => getIndexedRelationsForKeys(db, [localID]))
    .sort((left, right) => {
      const leftExact = shortID(getRelationNodeID(left)) === localID ? 0 : 1;
      const rightExact = shortID(getRelationNodeID(right)) === localID ? 0 : 1;
      if (leftExact !== rightExact) {
        return leftExact - rightExact;
      }
      const leftPreferred = left.author === preferredAuthor ? 0 : 1;
      const rightPreferred = right.author === preferredAuthor ? 0 : 1;
      if (leftPreferred !== rightPreferred) {
        return leftPreferred - rightPreferred;
      }
      return right.updated - left.updated;
    });
}

export function getRelationForMatching(
  knowledgeDBs: KnowledgeDBs,
  nodeID: LongID | ID,
  author: PublicKey
): Relations | undefined {
  return getMatchingRelations(knowledgeDBs, nodeID, author)[0];
}

export function getTextForMatching(
  knowledgeDBs: KnowledgeDBs,
  nodeID: LongID | ID,
  author: PublicKey
): string | undefined {
  if (isRefId(nodeID)) {
    return undefined;
  }

  const localID = shortID(nodeID as ID) as ID;
  if (isSearchId(localID)) {
    return parseSearchId(localID) || "";
  }

  const directRelation = getRelationsNoReferencedBy(knowledgeDBs, nodeID, author);
  if (directRelation) {
    return getRelationText(directRelation);
  }

  const relation = getRelationForMatching(knowledgeDBs, nodeID, author);
  const relationText = getRelationText(relation);
  if (relationText !== undefined) {
    return relationText;
  }
  const fallbackText = getFallbackRelationText(nodeID);
  return fallbackText !== "" || localID === EMPTY_NODE_ID
    ? fallbackText
    : undefined;
}

export function getTextHashForMatching(
  knowledgeDBs: KnowledgeDBs,
  nodeID: LongID | ID,
  author: PublicKey
): ID | undefined {
  const directRelation = getRelationsNoReferencedBy(knowledgeDBs, nodeID, author);
  if (directRelation) {
    return directRelation.textHash;
  }
  const relation = getRelationForMatching(knowledgeDBs, nodeID, author);
  if (relation) {
    return relation.textHash;
  }
  const localID = shortID(nodeID as ID) as ID;
  const fallbackText = getFallbackRelationText(nodeID);
  return fallbackText !== "" || localID === EMPTY_NODE_ID
    ? hashText(fallbackText)
    : undefined;
}

export function createTextNodeFromRelation(relation: Relations): TextSeed {
  return {
    id: getRelationNodeID(relation),
    text: getRelationText(relation) || "",
    textHash: relation.textHash,
  };
}

export function buildTextNodesFromRelations(
  relations: Iterable<Relations>
): Map<string, TextSeed> {
  const relationList = Array.from(relations);
  const knowledgeDBs = relationList.reduce((acc, relation) => {
    const authorDB = acc.get(relation.author, { relations: Map<string, Relations>() });
    return acc.set(relation.author, {
      relations: authorDB.relations.set(shortID(relation.id), relation),
    });
  }, Map<PublicKey, KnowledgeData>());

  const latestByHead = relationList.reduce((acc, relation) => {
    const nodeID = getRelationNodeID(relation);
    const existing = acc.get(nodeID);
    const isNewer = !existing || relation.updated > existing.updated;
    const isSameVersionNewerDisplay =
      !!existing &&
      relation.updated === existing.updated &&
      getRelationDepth(knowledgeDBs, relation) <
        getRelationDepth(knowledgeDBs, existing);
    if (isNewer || isSameVersionNewerDisplay) {
      return acc.set(nodeID, relation);
    }
    return acc;
  }, Map<ID, Relations>());

  return latestByHead.map((relation) =>
    createTextNodeFromRelation(relation)
  ) as Map<string, TextSeed>;
}

export function getTextNodeForID(
  knowledgeDBs: KnowledgeDBs,
  nodeID: LongID | ID,
  author: PublicKey
): TextSeed | undefined {
  if (isRefId(nodeID) || isSearchId(nodeID as ID)) {
    return undefined;
  }

  const localID = shortID(nodeID as ID) as ID;
  const directRelation = getRelationsNoReferencedBy(knowledgeDBs, nodeID, author);
  if (directRelation) {
    const relationText = getRelationText(directRelation);
    if (relationText !== undefined) {
      return {
        id: getRelationNodeID(directRelation),
        text: relationText,
        textHash: directRelation.textHash,
      };
    }
  }
  const relation = getRelationForMatching(knowledgeDBs, nodeID, author);
  const relationText = getRelationText(relation);
  if (relation && relationText !== undefined) {
    return {
      id: localID,
      text: relationText,
      textHash: relation.textHash,
    };
  }

  const fallbackText = getFallbackRelationText(nodeID);
  if (fallbackText !== "" || localID === EMPTY_NODE_ID) {
    return {
      id: localID,
      text: fallbackText,
      textHash: hashText(fallbackText),
    };
  }
  return undefined;
}

export function getRelationsNoReferencedBy(
  knowledgeDBs: KnowledgeDBs,
  relationID: ID | undefined,
  myself: PublicKey
): Relations | undefined {
  if (!relationID) {
    return undefined;
  }
  const [remote, id] = splitID(relationID);
  if (remote) {
    return knowledgeDBs.get(remote)?.relations.get(id);
  }

  const ownRelation = knowledgeDBs.get(myself)?.relations.get(relationID);
  if (ownRelation) {
    return ownRelation;
  }

  return knowledgeDBs
    .valueSeq()
    .map((db) => db.relations.get(relationID))
    .find((relation) => relation !== undefined);
}

export function getRelationItemRelation(
  knowledgeDBs: KnowledgeDBs,
  item: RelationItem,
  myself: PublicKey
): Relations | undefined {
  if (isConcreteRefId(item.id)) {
    return undefined;
  }
  return getRelationsNoReferencedBy(knowledgeDBs, item.id, myself);
}

export function getRelationItemNodeID(
  knowledgeDBs: KnowledgeDBs,
  item: RelationItem,
  myself: PublicKey
): LongID | ID {
  const relation = getRelationItemRelation(knowledgeDBs, item, myself);
  return relation?.head ?? item.id;
}

export function getRelationItemTextHash(
  knowledgeDBs: KnowledgeDBs,
  item: RelationItem,
  myself: PublicKey
): ID {
  const relation = getRelationItemRelation(knowledgeDBs, item, myself);
  if (relation) {
    return getRelationTextHash(knowledgeDBs, relation);
  }
  return (
    getTextHashForMatching(knowledgeDBs, item.id, myself) ||
    (shortID(item.id as ID) as ID)
  );
}

type RefTargetInfo = {
  stack: (ID | LongID)[];
  author: PublicKey;
  rootRelation?: LongID;
  scrollTo?: ID;
};

export function getRefTargetInfo(
  refId: ID | LongID,
  knowledgeDBs: KnowledgeDBs,
  effectiveAuthor: PublicKey
): RefTargetInfo | undefined {
  if (isConcreteRefId(refId)) {
    const parsed = parseConcreteRefId(refId);
    if (!parsed) {
      return undefined;
    }
    const { relationID, targetNode } = parsed;
    const relation = getRelationsNoReferencedBy(
      knowledgeDBs,
      relationID,
      effectiveAuthor
    );
    if (!relation) {
      return undefined;
    }
    const stack = getRelationStack(knowledgeDBs, relation);
    return {
      stack,
      author: relation.author,
      rootRelation: relationID,
      scrollTo: targetNode,
    };
  }

  return undefined;
}

export type ReferencedByRef = {
  relationID: LongID;
  context: Context;
  updated: number;
  targetNode?: ID;
};

export function deduplicateRefsByContext(
  refs: List<ReferencedByRef>,
  knowledgeDBs: KnowledgeDBs,
  preferAuthor?: PublicKey
): List<ReferencedByRef> {
  const grouped = refs.groupBy((ref) =>
    getRefContextKey(knowledgeDBs, ref, preferAuthor)
  );
  return grouped
    .map(
      (grp) =>
        grp
          .sortBy((r) => {
            const [author] = splitID(r.relationID);
            const isOther =
              preferAuthor && author !== undefined && author !== preferAuthor
                ? 1
                : 0;
            // Prefer item-level refs (relation + target node) over head-level refs
            // for the same context so navigation lands in parent context first.
            const targetPreference = r.targetNode ? 0 : 1;
            return [isOther, targetPreference, -r.updated];
          })
          .first()!
    )
    .valueSeq()
    .toList();
}

type RawAppearance = {
  relation: Relations;
  knowledgeDB: KnowledgeData;
  isHead: boolean;
  matchedItemNodeID?: ID;
};

function getNodeForMatching(
  knowledgeDBs: KnowledgeDBs,
  nodeID: LongID | ID,
  author: PublicKey
): TextSeed | undefined {
  return getTextNodeForID(knowledgeDBs, nodeID, author);
}

export function ensureRelationNativeFields(
  knowledgeDBs: KnowledgeDBs,
  relation: Relations
): Relations {
  const existingRelation = knowledgeDBs
    .get(relation.author)
    ?.relations.get(shortID(relation.id));
  const localHead = shortID(relation.head as ID) as ID;
  const hasReservedHead =
    localHead === LOG_NODE_ID ||
    localHead === EMPTY_NODE_ID ||
    isSearchId(localHead);
  const shouldTrustRelationText = relation.text !== "" || hasReservedHead;
  const text = shouldTrustRelationText
    ? relation.text
    : existingRelation?.text ||
      getFallbackRelationText(relation.head);
  const textHash = hashText(text);
  const parent = relation.parent || existingRelation?.parent;

  if (
    relation.text === text &&
    relation.textHash === textHash &&
    relation.parent === parent
  ) {
    return relation;
  }

  return {
    ...relation,
    text,
    textHash,
    parent,
  };
}

function getSemanticMatchKey(
  knowledgeDBs: KnowledgeDBs,
  nodeID: LongID | ID,
  author: PublicKey
): ID {
  return (
    getTextHashForMatching(knowledgeDBs, nodeID, author) ||
    (shortID(nodeID as ID) as ID)
  );
}

function nodesMatchForRefs(
  knowledgeDBs: KnowledgeDBs,
  candidateNodeID: LongID | ID,
  candidateAuthor: PublicKey,
  candidateRoot: ID,
  targetNodeID: LongID | ID,
  targetAuthor?: PublicKey,
  targetRoot?: ID
): boolean {
  if (
    targetAuthor !== undefined &&
    targetRoot !== undefined &&
    candidateAuthor === targetAuthor &&
    candidateRoot === targetRoot
  ) {
    return shortID(candidateNodeID as ID) === shortID(targetNodeID as ID);
  }

  return (
    getSemanticMatchKey(knowledgeDBs, candidateNodeID, candidateAuthor) ===
    getSemanticMatchKey(
      knowledgeDBs,
      targetNodeID,
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
    candidateContext.every((nodeID, index) =>
      nodesMatchForRefs(
        knowledgeDBs,
        nodeID,
        candidateAuthor,
        candidateRoot,
        targetContext.get(index) as ID,
        targetAuthor,
        targetRoot
      )
    )
  );
}

function findNodeAppearances(
  knowledgeDBs: KnowledgeDBs,
  nodeID: LongID | ID,
  targetAuthor?: PublicKey,
  targetRoot?: ID
): List<RawAppearance> {
  return knowledgeDBs.reduce((acc, knowledgeDB) => {
    return knowledgeDB.relations.reduce((rdx, relation) => {
      if (
        isSearchId(getRelationNodeID(relation)) ||
        relation.context.some((id) => isSearchId(id as ID))
      ) {
        return rdx;
      }
      const targetSemanticKey = getSemanticMatchKey(
        knowledgeDBs,
        nodeID,
        targetAuthor || relation.author
      );
      const matchesItem = (item: RelationItem): boolean => {
        const itemNodeID = getRelationItemNodeID(
          knowledgeDBs,
          item,
          relation.author
        );
        if (item.relevance === "not_relevant" || isRefId(itemNodeID)) {
          return false;
        }
        if (
          targetAuthor !== undefined &&
          targetRoot !== undefined &&
          relation.author === targetAuthor &&
          relation.root === targetRoot
        ) {
          return shortID(itemNodeID as ID) === shortID(nodeID as ID);
        }
        return (
          getRelationItemTextHash(knowledgeDBs, item, relation.author) ===
          targetSemanticKey
        );
      };
      const matchedItem = relation.items.find(
        (item) => matchesItem(item)
      );
      const isInItems = !!matchedItem;
      const isHeadWithChildren =
        relation.items.size > 0 &&
        ((targetAuthor !== undefined &&
          targetRoot !== undefined &&
          relation.author === targetAuthor &&
          relation.root === targetRoot &&
          shortID(getRelationNodeID(relation) as ID) === shortID(nodeID as ID)) ||
          getRelationTextHash(knowledgeDBs, relation) === targetSemanticKey);
      if (isHeadWithChildren || isInItems) {
        return rdx.push({
          relation,
          knowledgeDB,
          isHead: isHeadWithChildren && !isInItems,
          matchedItemNodeID: matchedItem
            ? (shortID(
                getRelationItemNodeID(
                  knowledgeDBs,
                  matchedItem,
                  relation.author
                )
              ) as ID)
            : undefined,
        });
      }
      return rdx;
    }, acc);
  }, List<RawAppearance>());
}

function resolveAppearance(
  _knowledgeDBs: KnowledgeDBs,
  app: RawAppearance,
  targetShortID: ID
): ReferencedByRef | undefined {
  const { relation, isHead, matchedItemNodeID } = app;
  const relationContext = relation.context;
  const relationNodeID = shortID(relation.head as ID) as ID;
  if (isHead) {
    return {
      relationID: relation.id,
      context: relationContext,
      updated: relation.updated,
    };
  }
  return {
    relationID: relation.id,
    context: relationContext.push(relationNodeID),
    updated: relation.updated,
    targetNode: matchedItemNodeID || targetShortID,
  };
}

export function findRefsToNode(
  knowledgeDBs: KnowledgeDBs,
  nodeID: LongID | ID,
  filterContext?: Context,
  targetAuthor?: PublicKey,
  targetRoot?: ID
): List<ReferencedByRef> {
  const targetShortID = shortID(nodeID);
  const appearances = findNodeAppearances(
    knowledgeDBs,
    nodeID,
    targetAuthor,
    targetRoot
  );
  const resolvedRefs = appearances
    .map((app) => {
      const ref = resolveAppearance(knowledgeDBs, app, targetShortID);
      if (!ref) {
        return undefined;
      }
      return {
        ref,
        author: app.relation.author,
        root: app.relation.root,
      };
    })
    .filter(
      (
        resolved
      ): resolved is {
        ref: ReferencedByRef;
        author: PublicKey;
        root: ID;
      } => resolved !== undefined
    )
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

function contextKeyForCref(
  knowledgeDBs: KnowledgeDBs,
  crefID: LongID | ID,
  effectiveAuthor: PublicKey
): string | undefined {
  const parsed = parseConcreteRefId(crefID);
  if (!parsed) return undefined;
  const rel = getRelationsNoReferencedBy(
    knowledgeDBs,
    parsed.relationID,
    effectiveAuthor
  );
  if (!rel) return undefined;
  return getSemanticContextKey(
    knowledgeDBs,
    parsed.targetNode
      ? rel.context.push(shortID(rel.head as ID) as ID)
      : rel.context,
    rel.author
  );
}

function coveredContextKeys(
  knowledgeDBs: KnowledgeDBs,
  crefIDs: List<LongID | ID>,
  effectiveAuthor: PublicKey
): Set<string> {
  return crefIDs.reduce((acc, crefID) => {
    const key = contextKeyForCref(knowledgeDBs, crefID, effectiveAuthor);
    return key !== undefined ? acc.add(key) : acc;
  }, Set<string>());
}

function getSemanticContextKey(
  knowledgeDBs: KnowledgeDBs,
  context: Context,
  author: PublicKey
): string {
  return context
    .map((nodeID) => getSemanticMatchKey(knowledgeDBs, nodeID, author))
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

export function getOccurrencesForNode(
  knowledgeDBs: KnowledgeDBs,
  nodeID: LongID | ID,
  currentRelationID: LongID | undefined,
  effectiveAuthor: PublicKey,
  currentContext: Context,
  currentRoot?: ID,
  currentItems?: List<RelationItem>,
  incomingCrefIDs?: List<LongID>
): List<LongID> {
  const allRefs = findRefsToNode(
    knowledgeDBs,
    nodeID,
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
      getSemanticMatchKey(
        knowledgeDBs,
        refRoot as ID,
        refAuthor || effectiveAuthor
      ) ===
      getSemanticMatchKey(knowledgeDBs, contextRoot as ID, effectiveAuthor)
    );
  };
  const filtered = allRefs
    .filter((ref) => ref.relationID !== currentRelationID)
    .filter((ref) =>
      ref.targetNode
        ? !contextRoot || !sharesSemanticRoot(ref)
        : currentContext.size > 0 && ref.context.size === 0
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
            const targetPreference = ref.targetNode ? 0 : 1;
            return [isOther, targetPreference, -ref.updated];
          })
          .first()!
    )
    .valueSeq()
    .toList();
  return deduped
    .sortBy((ref) => `${-ref.updated}:${ref.context.join(":")}`)
    .map((ref) => createConcreteRefId(ref.relationID, ref.targetNode))
    .toList();
}

export function getIncomingCrefsForNode(
  knowledgeDBs: KnowledgeDBs,
  currentNodeID: LongID | ID,
  parentRelationID: LongID | undefined,
  currentRelationID: LongID | undefined,
  effectiveAuthor: PublicKey,
  currentItems?: List<RelationItem>,
  currentContext: Context = List<ID>(),
  currentRoot?: ID
): List<LongID> {
  const currentShortNodeID = shortID(currentNodeID);
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
      const parsed = parseConcreteRefId(item.id);
      if (!parsed) return acc;
      const withTarget = acc.add(parsed.relationID);
      if (!parsed.targetNode) return withTarget;
      const targetRelation = getRelationsNoReferencedBy(
        knowledgeDBs,
        parsed.relationID,
        effectiveAuthor
      );
      if (!targetRelation) return withTarget;
      const targetNode = parsed.targetNode;
      if (!targetNode) return withTarget;
      const childContext = targetRelation.context.push(
        shortID(targetRelation.head as ID) as ID
      );
      const childRelation = targetRelation.items
        .map((childItem) =>
          getRelationItemRelation(knowledgeDBs, childItem, effectiveAuthor)
        )
        .find(
          (child): child is Relations =>
            !!child &&
            child.context.equals(childContext) &&
            shortID(getRelationNodeID(child)) === shortID(targetNode)
        );
      return childRelation ? withTarget.add(childRelation.id) : withTarget;
    },
    Set<LongID>()
  );

  const refs = knowledgeDBs.reduce((acc, knowledgeDB) => {
    return knowledgeDB.relations.reduce((rdx, relation) => {
      if (relation.id === parentRelationID) return rdx;
      if (relation.id === currentRelationID) return rdx;
      if (getRelationNodeID(relation) === LOG_NODE_ID) return rdx;
      if (outgoingTargetRelIDs.has(relation.id)) return rdx;

      const hasCrefToUs = relation.items.some((item) => {
        if (!isConcreteRefId(item.id)) return false;
        if (item.relevance === "not_relevant") return false;
        const parsed = parseConcreteRefId(item.id);
        if (!parsed) return false;
        const matchesItem =
          !!parentRelationID &&
          parsed.targetNode === currentShortNodeID &&
          parsed.relationID === parentRelationID;
        const matchesHead =
          !!currentRelationID &&
          !parsed.targetNode &&
          parsed.relationID === currentRelationID;
        return matchesItem || matchesHead;
      });

      if (!hasCrefToUs) return rdx;

      const ref: ReferencedByRef = {
        relationID: relation.id,
        context: relation.context,
        updated: relation.updated,
      };
      return rdx.push(ref);
    }, acc);
  }, List<ReferencedByRef>());

  const deduped = deduplicateRefsByContext(refs, knowledgeDBs, effectiveAuthor);
  return deduped
    .filter(
      (ref) => !covered.has(getRefContextKey(knowledgeDBs, ref, effectiveAuthor))
    )
    .sortBy((ref) => `${-ref.updated}:${ref.context.join(":")}`)
    .map((ref) => createConcreteRefId(ref.relationID))
    .toList();
}

export function getSearchRelations(
  searchId: ID,
  foundNodeIDs: List<ID>,
  myself: PublicKey
): Relations {
  const rel = newRelations(searchId, List<ID>(), myself);
  const uniqueNodeIDs = foundNodeIDs.toSet().toList();
  const items = uniqueNodeIDs.map(
    (nodeID): RelationItem => ({
      id: nodeID,
      relevance: undefined as Relevance,
    })
  );
  return { ...rel, id: searchId as LongID, items };
}

export function getRelations(
  knowledgeDBs: KnowledgeDBs,
  relationID: ID | undefined,
  myself: PublicKey
): Relations | undefined {
  if (relationID && isConcreteRefId(relationID)) {
    const parsed = parseConcreteRefId(relationID);
    if (parsed) {
      return getRelationsNoReferencedBy(
        knowledgeDBs,
        parsed.relationID,
        myself
      );
    }
  }
  return getRelationsNoReferencedBy(knowledgeDBs, relationID, myself);
}

export function deleteRelations(
  relations: Relations,
  indices: Set<number>
): Relations {
  const items = indices
    .sortBy((index) => -index)
    .reduce((r, deleteIndex) => r.delete(deleteIndex), relations.items);
  return {
    ...relations,
    items,
  };
}

export function markItemsAsNotRelevant(
  relations: Relations,
  indices: Set<number>
): Relations {
  const items = relations.items.map((item, index) => {
    if (!indices.has(index)) {
      return item;
    }
    return {
      ...item,
      relevance: "not_relevant" as Relevance,
    };
  });
  return {
    ...relations,
    items,
  };
}

export function updateItemRelevance(
  relations: Relations,
  index: number,
  relevance: Relevance
): Relations {
  const item = relations.items.get(index);
  if (!item) {
    return relations;
  }
  const items = relations.items.set(index, {
    ...item,
    relevance,
  });
  return {
    ...relations,
    items,
  };
}

export function updateItemArgument(
  relations: Relations,
  index: number,
  argument: Argument
): Relations {
  const item = relations.items.get(index);
  if (!item) {
    return relations;
  }
  const items = relations.items.set(index, {
    ...item,
    argument,
  });
  return {
    ...relations,
    items,
  };
}

export function isRemote(
  remote: PublicKey | undefined,
  myself: PublicKey
): boolean {
  return remote !== undefined && remote !== myself;
}

export function moveRelations(
  relations: Relations,
  indices: Array<number>,
  startPosition: number
): Relations {
  const itemsToMove = relations.items.filter((_, i) => indices.includes(i));
  const itemsBeforeStartPos = indices.filter((i) => i < startPosition).length;
  const updatedItems = relations.items
    .filterNot((_, i) => indices.includes(i))
    .splice(startPosition - itemsBeforeStartPos, 0, ...itemsToMove.toArray());
  return {
    ...relations,
    items: updatedItems,
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getSharesFromPublicKey(publicKey: PublicKey): number {
  return 10000; // TODO: implement
}

function filterVoteRelationLists(
  relations: List<Relations>,
  head: ID
): List<Relations> {
  return relations.filter((relation) => {
    return shortID(getRelationNodeID(relation)) === shortID(head);
  });
}

function getLatestvoteRelationListPerAuthor(
  relations: List<Relations>
): Map<PublicKey, Relations> {
  return relations.reduce((acc, relation) => {
    const isFound = acc.get(relation.author);
    if (!!isFound && isFound.updated > relation.updated) {
      return acc;
    }
    return acc.set(relation.author, relation);
  }, Map<PublicKey, Relations>());
}

function fib(n: number): number {
  // fibonacci sequence starting with 1,2,3,5,8,13,21,34,55,89,144,233,377,610,987,1597,...
  if (n <= 1) {
    return n;
  }
  if (n === 2) {
    return 2;
  }
  return fib(n - 1) + fib(n - 2);
}

function fibsum(n: number): number {
  // sum of fibonacci sequence
  // sequence starting with 1,3,6,11,19,32,53,87, 142, 231, 375, 608, 985, 1595,...
  // fibsum(n) = fibsum(n - 1) + fib(n), with induction and the definition of fib() it follows that
  // fibsum(n) = fib(n + 2) - 2
  return fib(n + 2) - 2;
}

// Check if an item matches a filter type (relevance, argument, or contains)
export function itemMatchesType(
  item: RelationItem,
  filterType: Relevance | Argument | "contains"
): boolean {
  if (filterType === "confirms" || filterType === "contra") {
    return item.argument === filterType;
  }
  if (filterType === "contains") {
    return item.relevance === undefined && item.argument === undefined;
  }
  return item.relevance === filterType;
}

export function isEmptyNodeID(id: LongID | ID): boolean {
  return id === EMPTY_NODE_ID;
}

export function itemPassesFilters(
  item: RelationItem,
  activeFilters: (
    | Relevance
    | Argument
    | "suggestions"
    | "versions"
    | "incoming"
    | "occurrence"
    | "contains"
  )[]
): boolean {
  if (isEmptyNodeID(item.id)) {
    return true;
  }

  const relevanceFilter =
    item.relevance === undefined ? "contains" : item.relevance;
  if (!activeFilters.includes(relevanceFilter)) {
    return false;
  }

  const hasArgumentFilter =
    activeFilters.includes("confirms") || activeFilters.includes("contra");
  if (hasArgumentFilter) {
    if (!item.argument || !activeFilters.includes(item.argument)) {
      return false;
    }
  }

  return true;
}

export function aggregateWeightedVotes(
  listsOfVotes: List<{ items: List<RelationItem>; weight: number }>,
  filterType: Relevance | Argument | "contains"
): Map<LongID | ID, number> {
  const votesPerItem = listsOfVotes.reduce((rdx, v) => {
    const { weight } = v;
    // Filter items by type
    const filteredItems = v.items.filter((item) =>
      itemMatchesType(item, filterType)
    );
    const length = filteredItems.size;
    const denominator = fibsum(length);
    if (length === 0) {
      return rdx;
    }
    const updatedVotes = filteredItems.map((item, index) => {
      const numerator = fib(length - index);
      const newVotes = (numerator / denominator) * weight;
      const initialVotes = rdx.get(item.id) || 0;
      return { id: item.id, votes: initialVotes + newVotes };
    });
    return updatedVotes.reduce((red, { id, votes }) => {
      return red.set(id, votes);
    }, rdx);
  }, Map<LongID | ID, number>());
  return votesPerItem;
}

export function aggregateNegativeWeightedVotes(
  listsOfVotes: List<{ items: List<RelationItem>; weight: number }>,
  filterType: Relevance | Argument | "contains"
): Map<LongID | ID, number> {
  const votesPerItem = listsOfVotes.reduce((rdx, v) => {
    const { weight } = v;
    // Filter items by type
    const filteredItems = v.items.filter((item) =>
      itemMatchesType(item, filterType)
    );
    const length = filteredItems.size;
    if (length === 0) {
      return rdx;
    }
    const updatedVotes = filteredItems.map((item) => {
      // vote negative with half of the weight on each item
      const newVotes = -weight / 2;
      const initialVotes = rdx.get(item.id) || 0;
      return { id: item.id, votes: initialVotes + newVotes };
    });
    return updatedVotes.reduce((red, { id, votes }) => {
      return red.set(id, votes);
    }, rdx);
  }, Map<LongID | ID, number>());
  return votesPerItem;
}

export function countRelationVotes(
  relations: List<Relations>,
  head: ID,
  type: Relevance | Argument | "contains"
): Map<LongID | ID, number> {
  const filteredVoteRelations = filterVoteRelationLists(relations, head);
  const latestVotesPerAuthor = getLatestvoteRelationListPerAuthor(
    filteredVoteRelations
  );
  const listsOfVotes = latestVotesPerAuthor
    .map((relation) => {
      return {
        items: relation.items,
        weight: getSharesFromPublicKey(relation.author),
      };
    })
    .toList();
  return type === "not_relevant"
    ? aggregateNegativeWeightedVotes(listsOfVotes, type)
    : aggregateWeightedVotes(listsOfVotes, type);
}

export function countRelevanceVoting(
  relations: List<Relations>,
  head: ID
): Map<LongID | ID, number> {
  const positiveVotes = countRelationVotes(relations, head, "contains");
  const negativeVotes = countRelationVotes(relations, head, "not_relevant");
  return negativeVotes.reduce((rdx, negativeVote, key) => {
    const positiveVote = positiveVotes.get(key, 0);
    return rdx.set(key, positiveVote + negativeVote);
  }, positiveVotes);
}

export function addRelationToRelations(
  relations: Relations,
  objectID: LongID | ID,
  relevance?: Relevance,
  argument?: Argument,
  ord?: number
): Relations {
  const newItem: RelationItem = {
    id: objectID,
    relevance,
    argument,
  };
  const defaultOrder = relations.items.size;
  const items = relations.items.push(newItem);
  const relationsWithItems = {
    ...relations,
    items,
  };
  return ord !== undefined
    ? moveRelations(relationsWithItems, [defaultOrder], ord)
    : relationsWithItems;
}

export function bulkAddRelations(
  relations: Relations,
  objectIDs: Array<LongID | ID>,
  relevance?: Relevance,
  argument?: Argument,
  startPos?: number
): Relations {
  return objectIDs.reduce((rdx, id, currentIndex) => {
    const ord = startPos !== undefined ? startPos + currentIndex : undefined;
    return addRelationToRelations(rdx, id, relevance, argument, ord);
  }, relations);
}

export type EmptyNodeData = {
  index: number;
  relationItem: RelationItem;
  paneIndex: number;
};

// Compute current empty node data from temporary events
// Events are processed in order: ADD sets data, REMOVE clears it
export function computeEmptyNodeMetadata(
  temporaryEvents: List<TemporaryEvent>
): Map<LongID, EmptyNodeData> {
  return temporaryEvents.reduce((metadata, event) => {
    if (event.type === "ADD_EMPTY_NODE") {
      return metadata.set(event.relationsID, {
        index: event.index,
        relationItem: event.relationItem,
        paneIndex: event.paneIndex,
      });
    }
    if (event.type === "REMOVE_EMPTY_NODE") {
      return metadata.delete(event.relationsID);
    }
    return metadata;
  }, Map<LongID, EmptyNodeData>());
}

// Convenience function for when only positions are needed
export function computeEmptyNodePositions(
  temporaryEvents: List<TemporaryEvent>
): Map<LongID, number> {
  return computeEmptyNodeMetadata(temporaryEvents).map((data) => data.index);
}

// Inject empty nodes back into relations based on temporaryEvents
// This is called after processEvents to add empty placeholder nodes
export function injectEmptyNodesIntoKnowledgeDBs(
  knowledgeDBs: KnowledgeDBs,
  temporaryEvents: List<TemporaryEvent>,
  myself: PublicKey
): KnowledgeDBs {
  // Compute current metadata from event stream
  const emptyNodeMetadata = computeEmptyNodeMetadata(temporaryEvents);

  if (emptyNodeMetadata.size === 0) {
    return knowledgeDBs;
  }

  const myDB = knowledgeDBs.get(myself);
  if (!myDB) {
    return knowledgeDBs;
  }

  // For each empty node, insert into the corresponding relations with its metadata
  const updatedRelations = emptyNodeMetadata.reduce(
    (relations, data, relationsID) => {
      const shortRelationsID = splitID(relationsID)[1];
      const existingRelations = relations.get(shortRelationsID);
      if (!existingRelations) {
        return relations;
      }

      // Check if empty node is already injected (from parent MergeKnowledgeDB)
      const alreadyHasEmpty = existingRelations.items.some(
        (item) => item.id === EMPTY_NODE_ID
      );
      if (alreadyHasEmpty) {
        return relations;
      }

      // Insert empty node at the specified index with its metadata (relevance, argument)
      const updatedItems = existingRelations.items.insert(
        data.index,
        data.relationItem
      );
      return relations.set(shortRelationsID, {
        ...existingRelations,
        items: updatedItems,
      });
    },
    myDB.relations
  );

  return knowledgeDBs.set(myself, {
    ...myDB,
    relations: updatedRelations,
  });
}
