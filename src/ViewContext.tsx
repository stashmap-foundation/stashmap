import React from "react";
import { List, Set as ImmutableSet, OrderedMap, Map } from "immutable";
import { v4 } from "uuid";
import {
  getRelations,
  getRelationsNoReferencedBy,
  joinID,
  shortID,
  splitID,
  isRefId,
  isSearchId,
  parseSearchId,
  hashText,
  itemMatchesType,
  LOG_NODE_ID,
  EMPTY_NODE_ID,
  isConcreteRefId,
  createConcreteRefId,
  parseConcreteRefId,
  findRefsToNode,
  getTextForMatching,
  getTextHashForMatching,
  getTextNodeForID,
  itemPassesFilters,
  getRelationItemNodeID,
  getRelationItemRelation,
  getIndexedRelationsForKeys,
} from "./connections";
import {
  buildOutgoingReference,
  buildReferenceItem,
} from "./buildReferenceNode";
import { newDB } from "./knowledge";
import { useData } from "./DataContext";
import { Plan, planUpsertRelations, getPane } from "./planner";
import { usePaneStack } from "./SplitPanesContext";
import { DEFAULT_TYPE_FILTERS, suggestionSettings } from "./constants";

export function contextsMatch(a: Context, b: Context): boolean {
  return a.equals(b);
}

function getSemanticNodeKey(
  knowledgeDBs: KnowledgeDBs,
  nodeID: LongID | ID,
  author: PublicKey
): string {
  return getTextHashForMatching(knowledgeDBs, nodeID, author) || shortID(nodeID);
}

function nodesSemanticallyMatch(
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

function contextsSemanticallyMatch(
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
    parsed.targetNode || (relation.head as ID),
    relation.author
  );
}

/**
 * Calculate items that other users have in their relation lists
 * that the current user doesn't have.
 *
 * Returns either:
 * - Plain nodeID for leaf suggestions (no children in any user's context)
 * - Abstract/concrete ref ID for expandable suggestions (grouped by context)
 */
type SuggestionsResult = {
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
  filterTypes: TypeFilters,
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
              r.head,
              r.author,
              localID,
              myself
            ) &&
            r.id !== currentRelationId &&
            !declinedRelationCrefIDs.has(createConcreteRefId(r.id)) &&
            contextsSemanticallyMatch(
              knowledgeDBs,
              r.context,
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
          const useExactMatch =
            r.author === author &&
            currentRoot !== undefined &&
            r.root === currentRoot;
          const matchesNode = useExactMatch
            ? r.head === localID
            : nodesSemanticallyMatch(
                knowledgeDBs,
                r.head,
                r.author,
                localID,
                author
              );
          const matchesContext = useExactMatch
            ? contextsMatch(r.context, context)
            : contextsSemanticallyMatch(
                knowledgeDBs,
                r.context,
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
  filterTypes: TypeFilters,
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
  activeFilters: TypeFilters,
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
  filterTypes: TypeFilters,
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
      const keep =
        hasUncoveredAdds || removeCount > suggestionSettings.maxSuggestions;
      return keep;
    })
    .sortBy((r) => -r.updated)
    .map((r) => createConcreteRefId(r.id))
    .toList();
}

type ViewPathSegment = LongID | ID;

export type ViewPath = readonly [number, ...ViewPathSegment[]];

export const ViewContext = React.createContext<ViewPath | undefined>(undefined);

export function useViewPath(): ViewPath {
  const context = React.useContext(ViewContext);
  if (!context) {
    throw new Error("ViewContext not provided");
  }
  return context;
}

export type VirtualItemsMap = Map<string, RelationItem>;

const VirtualItemsContext = React.createContext<VirtualItemsMap>(
  Map<string, RelationItem>()
);

const EMPTY_VIEW_PATH_PREFIX = "empty-row:";

export const VirtualItemsProvider = VirtualItemsContext.Provider;

export function useVirtualItemsMap(): VirtualItemsMap {
  return React.useContext(VirtualItemsContext);
}

// Encode path IDs to handle colons in ref IDs (ref:ctx:target format)
function encodePathID(id: string): string {
  return id.replace(/:/g, "%3A");
}

function decodePathID(encoded: string): string {
  return encoded.replace(/%3A/g, ":");
}

function createEmptyViewPathID(relationsID: LongID): string {
  return `${EMPTY_VIEW_PATH_PREFIX}${relationsID}`;
}

function isEmptyViewPathID(id: LongID | ID): boolean {
  return id.startsWith(EMPTY_VIEW_PATH_PREFIX);
}

export function parseViewPath(path: string): ViewPath {
  const pieces = path.split(":");
  if (pieces.length < 2) {
    throw new Error("Invalid view path");
  }

  const panePart = pieces[0];
  if (!panePart.startsWith("p")) {
    throw new Error("Invalid view path");
  }

  const paneIndex = parseInt(panePart.substring(1), 10);
  if (Number.isNaN(paneIndex)) {
    throw new Error("Invalid view path");
  }

  const pathPieces = pieces
    .slice(1)
    .map((piece) => decodePathID(piece) as ViewPathSegment);
  if (pathPieces.length === 0) {
    throw new Error("Invalid view path");
  }

  return [paneIndex, ...pathPieces];
}

function convertViewPathToString(viewContext: ViewPath): string {
  const paneIndex = viewContext[0] as number;
  const pathPart = (viewContext.slice(1) as readonly ViewPathSegment[])
    .map((segment) => encodePathID(segment))
    .join(":");
  return `p${paneIndex}:${pathPart}`;
}

// TODO: delete this export
export const viewPathToString = convertViewPathToString;

function getContextFromStack(stack: ID[]): Context {
  return List(stack.slice(0, -1));
}

export function isRoot(viewPath: ViewPath): boolean {
  return viewPath.length === 2;
}

export function getPaneIndex(viewContext: ViewPath): number {
  return viewContext[0] as number;
}

export function getParentView(viewContext: ViewPath): ViewPath | undefined {
  if (isRoot(viewContext)) {
    return undefined;
  }
  return viewContext.slice(0, -1) as unknown as ViewPath;
}

export function getContext(
  data: Data,
  viewPath: ViewPath,
  stack: ID[]
): Context {
  if (isRoot(viewPath)) {
    return getContextFromStack(stack);
  }
  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    throw new Error("Cannot determine context: no parent path found");
  }
  const parentContext = getContext(data, parentPath, stack);
  const parentRelation = getRelationForView(data, parentPath, stack);
  if (parentRelation) {
    return parentContext.push(shortID(parentRelation.head as ID) as ID);
  }
  const [parentNodeID] = getNodeIDFromView(data, parentPath);
  return parentContext.push(shortID(parentNodeID as ID) as ID);
}

function getViewExactMatch(views: Views, path: ViewPath): View | undefined {
  const viewKey = viewPathToString(path);
  return views.get(viewKey);
}

// Sort relations by updated timestamp (most recent first)
function sortRelationsByDate(relations: List<Relations>): List<Relations> {
  return relations.sort((a, b) => b.updated - a.updated);
}

export function getLast(viewContext: ViewPath): ViewPathSegment {
  return viewContext[viewContext.length - 1] as ViewPathSegment;
}

function getDefaultView(id: ID, isRootNode: boolean): View {
  return {
    expanded: isRootNode || isSearchId(id),
  };
}

export function getViewFromPath(data: Data, path: ViewPath): View {
  const nodeID = getNodeIDFromPath(data, path);
  return (
    getViewExactMatch(data.views, path) || getDefaultView(nodeID, isRoot(path))
  );
}

function relationMatchesRequestedNode(
  knowledgeDBs: KnowledgeDBs,
  relation: Relations,
  requestedNodeID: LongID | ID
): boolean {
  const localID = shortID(requestedNodeID);
  if (relation.textHash === localID || relation.head === localID) {
    return true;
  }
  return (
    getTextHashForMatching(knowledgeDBs, relation.textHash, relation.author) ===
    localID
  );
}

function getNodeIDForRelation(relation: Relations): ID {
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

function getAuthorCandidateRelations(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  nodeID: LongID | ID
): Relations[] {
  const authorDB = knowledgeDBs.get(author, newDB());
  const localID = shortID(nodeID);
  const semanticKey = getSemanticNodeKey(knowledgeDBs, nodeID, author);
  return getIndexedRelationsForKeys(authorDB, [localID, semanticKey]);
}

function getNewestStandaloneRootByNode(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  nodeID: LongID | ID
): Relations | undefined {
  const candidateRoots = getAuthorCandidateRelations(
    knowledgeDBs,
    author,
    nodeID
  ).filter(
    (relation) => relation.author === author && relation.root === shortID(relation.id)
  );
  const directMatch = sortRelationsByDate(
    List(
      candidateRoots.filter((relation) =>
        relationMatchesRequestedNode(knowledgeDBs, relation, nodeID)
      )
    )
  ).first();
  if (directMatch) {
    return directMatch;
  }
  return undefined;
}

function getStandaloneRootByRootID(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  root: ID
): Relations | undefined {
  return sortRelationsByDate(
    List(
      knowledgeDBs
        .get(author, newDB())
        .relations.valueSeq()
        .filter(
          (r) =>
            r.author === author &&
            r.root === root &&
            r.root === shortID(r.id)
        )
    )
  ).first();
}

function getNewestRelationFromRootBySemanticContext(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  nodeID: LongID | ID,
  context: Context,
  root: ID
): Relations | undefined {
  const contextMatcher = (relation: Relations): boolean =>
    relation.author === author &&
    relation.root === root &&
    contextsSemanticallyMatch(
      knowledgeDBs,
      relation.context,
      relation.author,
      context,
      author
    );
  const directMatch = sortRelationsByDate(
    List(
      getAuthorCandidateRelations(knowledgeDBs, author, nodeID).filter(
        (relation) =>
          contextMatcher(relation) &&
          relationMatchesRequestedNode(knowledgeDBs, relation, nodeID)
      )
    )
  ).first();
  if (directMatch) {
    return directMatch;
  }
  return undefined;
}

function getMatchingChildRelation(
  knowledgeDBs: KnowledgeDBs,
  parentRelation: Relations,
  requestedNodeID: LongID | ID
): Relations | undefined {
  const childRelations = parentRelation.items
    .map((item) =>
      isRefId(item.id) || isConcreteRefId(item.id)
        ? undefined
        : getRelationItemRelation(knowledgeDBs, item, parentRelation.author)
    );
  const directMatch = childRelations.find(
    (relation): relation is Relations =>
      relation !== undefined &&
      relationMatchesRequestedNode(knowledgeDBs, relation, requestedNodeID)
  );
  if (directMatch) {
    return directMatch;
  }
  return undefined;
}

function resolveRequestedStackFromRoot(
  knowledgeDBs: KnowledgeDBs,
  rootRelation: Relations,
  requestedStack: ID[]
): ResolvedStack | undefined {
  if (requestedStack.length === 0) {
    return { actualStack: [] };
  }
  const rootMatches = relationMatchesRequestedNode(
    knowledgeDBs,
    rootRelation,
    requestedStack[0]
  );
  if (!rootMatches) {
    return undefined;
  }

  let currentRelation: Relations | undefined = rootRelation;
  const actualStack: ID[] = [getNodeIDForRelation(rootRelation)];

  for (let index = 1; index < requestedStack.length; index += 1) {
    if (!currentRelation) {
      return undefined;
    }
    const nextRelation = getMatchingChildRelation(
      knowledgeDBs,
      currentRelation,
      requestedStack[index] as ID
    );
    if (!nextRelation) {
      return undefined;
    }
    actualStack.push(getNodeIDForRelation(nextRelation));
    currentRelation = nextRelation;
  }

  return { actualStack, relation: currentRelation };
}

type ResolvedStack = {
  actualStack: ID[];
  relation?: Relations;
};

export function resolveNodeStackToActualIDs(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  requestedStack: ID[]
): ResolvedStack | undefined {
  if (requestedStack.length === 0) {
    return { actualStack: [] };
  }

  const standaloneRoot = getNewestStandaloneRootByNode(
    knowledgeDBs,
    author,
    requestedStack[0]
  );
  if (!standaloneRoot) {
    return undefined;
  }

  return resolveRequestedStackFromRoot(
    knowledgeDBs,
    standaloneRoot,
    requestedStack
  );
}

function getViewRelationByID(
  knowledgeDBs: KnowledgeDBs,
  id: LongID | ID,
  myself: PublicKey
): Relations | undefined {
  return getRelations(knowledgeDBs, id, myself);
}

function getNodeIDFromPath(data: Data, viewPath: ViewPath): LongID | ID {
  const currentID = getLast(viewPath);
  if (isEmptyViewPathID(currentID)) {
    return EMPTY_NODE_ID;
  }
  if (isConcreteRefId(currentID)) {
    return currentID;
  }
  return (
    getRelationsNoReferencedBy(data.knowledgeDBs, currentID, data.user.publicKey)
      ? getNodeIDForRelation(
          getRelationsNoReferencedBy(
            data.knowledgeDBs,
            currentID,
            data.user.publicKey
          ) as Relations
        )
      : currentID
  );
}

export function getNodeIDFromView(
  data: Data,
  viewPath: ViewPath
): [LongID | ID, View] {
  const view = getViewFromPath(data, viewPath);
  return [getNodeIDFromPath(data, viewPath), view];
}

export function getNodeIDsForViewPath(
  data: Data,
  viewPath: ViewPath
): Array<LongID | ID> {
  const paneIndex = getPaneIndex(viewPath);
  return (viewPath.slice(1) as ViewPathSegment[]).map((_, index, segments) =>
    getNodeIDFromPath(data, [paneIndex, ...segments.slice(0, index + 1)])
  );
}

export function getRelationsForCurrentTree(
  knowledgeDBs: KnowledgeDBs,
  paneAuthor: PublicKey,
  nodeID: LongID | ID,
  context: Context,
  rootRelation: LongID | undefined,
  isRootNode: boolean,
  currentRoot?: ID
): Relations | undefined {
  if (isRootNode && rootRelation) {
    const relation = getRelationsNoReferencedBy(
      knowledgeDBs,
      rootRelation,
      paneAuthor
    );
    if (relation) {
      return relation;
    }
  }

  const preferredRoot =
    currentRoot ||
    (rootRelation
      ? getRelationsNoReferencedBy(knowledgeDBs, rootRelation, paneAuthor)?.root
      : undefined);

  if (preferredRoot) {
    const root = getStandaloneRootByRootID(
      knowledgeDBs,
      paneAuthor,
      preferredRoot
    );
    const resolved = root
      ? resolveRequestedStackFromRoot(knowledgeDBs, root, [
          ...context.toArray(),
          shortID(nodeID) as ID,
        ])?.relation
      : undefined;
    return (
      resolved ||
      getNewestRelationFromRootBySemanticContext(
        knowledgeDBs,
        paneAuthor,
        nodeID,
        context,
        preferredRoot
      )
    );
  }

  if (!isRootNode) {
    return undefined;
  }

  return resolveNodeStackToActualIDs(knowledgeDBs, paneAuthor, [
    ...context.toArray(),
    shortID(nodeID) as ID,
  ])?.relation;
}

export function getParentRelation(
  data: Data,
  viewPath: ViewPath
): Relations | undefined {
  if (isRoot(viewPath)) {
    return undefined;
  }
  const parentID = viewPath[viewPath.length - 2] as ViewPathSegment;
  return getViewRelationByID(data.knowledgeDBs, parentID, data.user.publicKey);
}

export function getEffectiveAuthor(data: Data, viewPath: ViewPath): PublicKey {
  const pane = getPane(data, viewPath);
  const parentRelation = getParentRelation(data, viewPath);
  return parentRelation?.author || pane.author;
}

export function getRootForView(
  data: Data,
  viewPath: ViewPath,
  stack: ID[]
): ID | undefined {
  const currentID = getLast(viewPath);
  const directRelation = getViewRelationByID(
    data.knowledgeDBs,
    currentID,
    data.user.publicKey
  );
  if (directRelation) {
    return directRelation.root;
  }

  const parentRelation = getParentRelation(data, viewPath);
  if (parentRelation) {
    return parentRelation.root;
  }

  if (!isRoot(viewPath)) {
    return undefined;
  }

  const [nodeID] = getNodeIDFromView(data, viewPath);
  const context = getContext(data, viewPath, stack);
  const pane = getPane(data, viewPath);
  const author = getEffectiveAuthor(data, viewPath);
  return getRelationsForCurrentTree(
    data.knowledgeDBs,
    author,
    nodeID,
    context,
    pane.rootRelation,
    true
  )?.root;
}

export function getRelationForView(
  data: Data,
  viewPath: ViewPath,
  stack: ID[]
): Relations | undefined {
  const currentID = getLast(viewPath);
  const directRelation = getViewRelationByID(
    data.knowledgeDBs,
    currentID,
    data.user.publicKey
  );
  if (directRelation) {
    return directRelation;
  }

  if (!isRoot(viewPath)) {
    return undefined;
  }

  const [nodeID] = getNodeIDFromView(data, viewPath);
  const context = getContext(data, viewPath, stack);
  const pane = getPane(data, viewPath);
  const parentRoot = getParentRelation(data, viewPath)?.root;
  const author = getEffectiveAuthor(data, viewPath);

  return getRelationsForCurrentTree(
    data.knowledgeDBs,
    author,
    nodeID,
    context,
    pane.rootRelation,
    isRoot(viewPath),
    parentRoot
  );
}

export function useSearchDepth(): number | undefined {
  const data = useData();
  const viewPath = useViewPath();

  const loop = (
    currentPath: ViewPath | undefined,
    depth: number
  ): number | undefined => {
    if (!currentPath) return undefined;
    const [nodeID] = getNodeIDFromView(data, currentPath);
    if (isSearchId(nodeID as ID)) {
      return depth;
    }
    return loop(getParentView(currentPath), depth + 1);
  };

  return loop(getParentView(viewPath), 1);
}

export function useIsInSearchView(): boolean {
  return useSearchDepth() !== undefined;
}

export function contextStartsWith(context: Context, prefix: Context): boolean {
  if (prefix.size > context.size) return false;
  return context.take(prefix.size).equals(prefix);
}

export function getDescendantRelations(
  knowledgeDBs: KnowledgeDBs,
  nodeID: LongID | ID,
  rootContext: Context,
  root?: ID
): List<Relations> {
  const localID = shortID(nodeID);
  const childContext = rootContext.push(localID);

  const allRelations = knowledgeDBs
    .valueSeq()
    .flatMap((db) => db.relations.valueSeq())
    .toList();

  return allRelations.filter(
    (relations) =>
      (!root || relations.root === root) &&
      ((relations.head === localID &&
        contextsMatch(relations.context, rootContext)) ||
        contextStartsWith(relations.context, childContext))
  );
}

export function getNodeFromID(
  knowledgeDBs: KnowledgeDBs,
  id: ID | LongID,
  myself: PublicKey
): KnowNode | undefined {
  if (isRefId(id)) {
    return buildOutgoingReference(id as LongID, knowledgeDBs, myself);
  }

  // Handle search IDs - build virtual node from ID
  if (isSearchId(id as ID)) {
    const query = parseSearchId(id as ID) || "";
    return {
      id: id as ID,
      text: `Search: ${query}`,
      textHash: hashText(query),
      type: "text",
    };
  }
  return getTextNodeForID(knowledgeDBs, id, myself);
}

export type TypeFilters = (
  | Relevance
  | Argument
  | "suggestions"
  | "versions"
  | "incoming"
  | "occurrence"
  | "contains"
)[];

/**
 * Filter relation items by type filters.
 */
export function filterRelationItems(
  items: List<RelationItem>,
  filters: TypeFilters
): List<RelationItem> {
  const itemFilters = filters.filter(
    (f): f is Relevance | Argument | "contains" =>
      f !== "suggestions" && f !== undefined
  );
  return items.filter((item) =>
    itemFilters.some((f) => itemMatchesType(item, f))
  );
}

export function getNodeFromView(
  data: Data,
  viewPath: ViewPath
): [KnowNode, View] | [undefined, undefined] {
  const [nodeID, view] = getNodeIDFromView(data, viewPath);
  const node = getNodeFromID(data.knowledgeDBs, nodeID, data.user.publicKey);
  if (!node) {
    return [undefined, undefined];
  }
  return [node, view];
}

export function addRelationsToLastElement(
  path: ViewPath,
  relationsID: LongID
): ViewPath {
  const last = getLast(path);
  if (last === relationsID || isConcreteRefId(last)) {
    return path;
  }
  return [
    getPaneIndex(path),
    ...(path.slice(1, -1) as ViewPathSegment[]),
    relationsID,
  ] as ViewPath;
}

export function addNodeToPathWithRelations(
  path: ViewPath,
  relations: Relations,
  index: number
): ViewPath {
  const item = relations.items.get(index);
  if (!item) {
    throw new Error("No node found in relation at index");
  }
  const pathWithRelations = addRelationsToLastElement(path, relations.id);
  const nextSegment =
    item.id === EMPTY_NODE_ID ? createEmptyViewPathID(relations.id) : item.id;
  return [...pathWithRelations, nextSegment] as ViewPath;
}

export function addNodeToPath(
  data: Data,
  path: ViewPath,
  index: number,
  stack: ID[]
): ViewPath {
  const relations = getRelationForView(data, path, stack);
  if (!relations) {
    throw new Error("Parent doesn't have relations, cannot add to path");
  }
  return addNodeToPathWithRelations(path, relations, index);
}

export function useEffectiveAuthor(): PublicKey {
  const data = useData();
  const viewPath = useViewPath();
  return getEffectiveAuthor(data, viewPath);
}

export function useRelation(): Relations | undefined {
  const data = useData();
  const viewPath = useViewPath();
  const stack = usePaneStack();
  return getRelationForView(data, viewPath, stack);
}

export function useIsViewingOtherUserContent(): boolean {
  const { user } = useData();
  const effectiveAuthor = useEffectiveAuthor();
  return effectiveAuthor !== user.publicKey;
}

export function popViewPath(
  viewContext: ViewPath,
  times: number
): ViewPath | undefined {
  return Array.from({ length: times }).reduce<ViewPath | undefined>(
    (current) => (current ? getParentView(current) : undefined),
    viewContext
  );
}

export function getRelationIndex(
  data: Data,
  viewPath: ViewPath
): number | undefined {
  const relations = getParentRelation(data, viewPath);
  if (!relations) {
    return undefined;
  }
  const itemID = getLast(viewPath);
  const index = relations.items.findIndex(
    (item) =>
      item.id === itemID ||
      (item.id === EMPTY_NODE_ID && isEmptyViewPathID(itemID))
  );
  return index >= 0 ? index : undefined;
}

export function useRelationIndex(): number | undefined {
  const path = useViewPath();
  const data = useData();
  return getRelationIndex(data, path);
}

export function getRelationItemForView(
  data: Data,
  viewPath: ViewPath
): RelationItem | undefined {
  const relation = getParentRelation(data, viewPath);
  if (!relation) {
    return undefined;
  }
  const index = getRelationIndex(data, viewPath);
  return index !== undefined ? relation.items.get(index) : undefined;
}

export function useRelationItem(): RelationItem | undefined {
  const virtualItems = React.useContext(VirtualItemsContext);
  const data = useData();
  const viewPath = useViewPath();
  const viewKey = viewPathToString(viewPath);
  const virtualItem = virtualItems.get(viewKey);
  if (virtualItem) {
    return virtualItem;
  }
  return getRelationItemForView(data, viewPath);
}

export type SiblingInfo = {
  viewPath: ViewPath;
  nodeID: LongID | ID;
  view: View;
};

export function getPreviousSibling(
  data: Data,
  viewPath: ViewPath,
  stack: ID[]
): SiblingInfo | undefined {
  const relationIndex = getRelationIndex(data, viewPath);
  if (relationIndex === undefined || relationIndex === 0) {
    return undefined;
  }

  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    return undefined;
  }

  const parentRelation = getParentRelation(data, viewPath);
  if (!parentRelation) {
    return undefined;
  }

  const pane = getPane(data, viewPath);
  const activeFilters = pane.typeFilters || DEFAULT_TYPE_FILTERS;

  const prevIndex = parentRelation.items
    .slice(0, relationIndex)
    .reduce<number>(
      (found, item, i) => (itemPassesFilters(item, activeFilters) ? i : found),
      -1
    );

  if (prevIndex === -1) {
    return undefined;
  }

  try {
    const prevSiblingPath = addNodeToPath(data, parentPath, prevIndex, stack);
    const [prevNodeID, prevView] = getNodeIDFromView(data, prevSiblingPath);
    return {
      viewPath: prevSiblingPath,
      nodeID: prevNodeID,
      view: prevView,
    };
  } catch {
    return undefined;
  }
}

/**
 * Get the last direct child of a node, or undefined if no children.
 */
export function getLastChild(
  data: Data,
  viewPath: ViewPath,
  stack: ID[]
): ViewPath | undefined {
  const relations = getRelationForView(data, viewPath, stack);
  if (!relations || relations.items.size === 0) {
    return undefined;
  }
  const lastIndex = relations.items.size - 1;
  return addNodeToPathWithRelations(viewPath, relations, lastIndex);
}

export function usePreviousSibling(): SiblingInfo | undefined {
  const data = useData();
  const viewPath = useViewPath();
  const stack = usePaneStack();
  return getPreviousSibling(data, viewPath, stack);
}

export function RootViewContextProvider({
  children,
  root,
  paneIndex = 0,
  indices, // TODO: only used in tests, get rid of it
}: {
  children: React.ReactNode;
  root: LongID | ID;
  paneIndex?: number;
  indices?: List<number>;
}): JSX.Element {
  const data = useData();
  const stack = usePaneStack();
  const pane = data.panes[paneIndex];
  const rootContext = getContextFromStack(stack);
  const resolvedRootRelation =
    pane?.rootRelation
      ? getRelations(data.knowledgeDBs, pane.rootRelation, data.user.publicKey)
      : getRelationsForCurrentTree(
          data.knowledgeDBs,
          pane?.author || data.user.publicKey,
          root,
          rootContext,
          undefined,
          true
        );
  const startPath: ViewPath = [
    paneIndex,
    resolvedRootRelation?.id || root,
  ];
  const finalPath = (indices || List<number>()).reduce(
    (acc, index) => addNodeToPath(data, acc, index, stack),
    startPath
  );
  return (
    <ViewContext.Provider value={finalPath}>{children}</ViewContext.Provider>
  );
}

export function useNodeID(): [LongID | ID, View] {
  const data = useData();
  const viewPath = useViewPath();
  return getNodeIDFromView(data, viewPath);
}

export function getNodeForView(
  data: Data,
  viewPath: ViewPath,
  stack: ID[],
  virtualType?: VirtualType
): [KnowNode, View] | [undefined, undefined] {
  const [nodeID, view] = getNodeIDFromView(data, viewPath);

  if (isRefId(nodeID)) {
    const node = buildReferenceItem(
      nodeID as LongID,
      data,
      viewPath,
      stack,
      virtualType
    );
    if (!node) {
      return [undefined, undefined];
    }
    return [node, view];
  }

  const node = getNodeFromID(data.knowledgeDBs, nodeID, data.user.publicKey);
  if (!node) {
    return [undefined, undefined];
  }
  return [node, view];
}

export function useNode(): [KnowNode, View] | [undefined, undefined] {
  const data = useData();
  const viewPath = useViewPath();
  const stack = usePaneStack();
  const virtualItem = useRelationItem();
  return getNodeForView(data, viewPath, stack, virtualItem?.virtualType);
}

export function getDisplayTextForView(
  data: Data,
  viewPath: ViewPath,
  stack: ID[],
  virtualType?: VirtualType
): string {
  const [node] = getNodeForView(data, viewPath, stack, virtualType);
  if (node?.type === "reference" || (node && isSearchId(node.id as ID))) {
    return node.text;
  }
  const ownRelation = getRelationForView(data, viewPath, stack);
  return ownRelation?.text ?? node?.text ?? "";
}

export function useDisplayText(): string {
  const data = useData();
  const viewPath = useViewPath();
  const stack = usePaneStack();
  const virtualType = useRelationItem()?.virtualType;
  return getDisplayTextForView(data, viewPath, stack, virtualType);
}

export function getParentNode(
  data: Data,
  viewPath: ViewPath
): [KnowNode, View] | [undefined, undefined] {
  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    return [undefined, undefined];
  }
  return getNodeFromView(data, parentPath);
}

export function getParentNodeID(
  data: Data,
  viewPath: ViewPath
): [LongID | ID, View] | [undefined, undefined] {
  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    return [undefined, undefined];
  }
  return getNodeIDFromView(data, parentPath);
}

export function useParentNode(): [KnowNode, View] | [undefined, undefined] {
  const data = useData();
  const viewPath = useViewPath();
  return getParentNode(data, viewPath);
}

export function isExpanded(data: Data, viewKey: string): boolean {
  const viewPath = parseViewPath(viewKey);
  const view = getViewFromPath(data, viewPath);
  return view.expanded === true;
}

export function useViewKey(): string {
  return viewPathToString(useViewPath());
}

export function useIsExpanded(): boolean {
  const data = useData();
  const viewKey = useViewKey();
  return isExpanded(data, viewKey);
}

export function useIsRoot(): boolean {
  return isRoot(useViewPath());
}

export function getParentKey(viewKey: string): string {
  return viewKey.split(":").slice(0, -1).join(":");
}

export function updateView(views: Views, path: ViewPath, view: View): Views {
  const key = viewPathToString(path);
  const nodeID = getLast(path);
  const defaultView = getDefaultView(nodeID, isRoot(path));
  const isDefault = view.expanded === defaultView.expanded && !view.typeFilters;
  if (isDefault) {
    return views.delete(key);
  }
  return views.set(key, view);
}

export function deleteChildViews(views: Views, path: ViewPath): Views {
  const key = viewPathToString(path);
  return views.filter((_, k) => !k.startsWith(key) || k === key);
}

export function copyViewsWithNewPrefix(
  views: Views,
  sourceKey: string,
  targetKey: string
): Views {
  const viewsToCopy = views.filter(
    (_, k) => k.startsWith(`${sourceKey}:`) || k === sourceKey
  );
  return viewsToCopy.reduce((acc, view, key) => {
    const newKey = targetKey + key.slice(sourceKey.length);
    return acc.set(newKey, view);
  }, views);
}

export function copyViewsWithRelationsMapping(
  views: Views,
  sourceKey: string,
  targetKey: string,
  relationsIdMapping: Map<LongID, LongID>
): Views {
  const viewsToCopy = views.filter(
    (_, k) => k.startsWith(`${sourceKey}:`) || k === sourceKey
  );
  return viewsToCopy.reduce((acc, view, key) => {
    const suffix = key.slice(sourceKey.length);
    const mappedSuffix = relationsIdMapping.reduce(
      (s, newId, oldId) => s.split(oldId).join(newId),
      suffix
    );
    const newKey = targetKey + mappedSuffix;
    return acc.set(newKey, view);
  }, views);
}

export function newRelations(
  head: LongID | ID,
  context: Context,
  myself: PublicKey,
  root?: ID,
  parent?: LongID,
  text?: string
): Relations {
  const id = joinID(myself, v4());
  const localHead = shortID(head) as ID;
  let relationText = text ?? "";
  if (text === undefined) {
    if (localHead === LOG_NODE_ID) {
      relationText = "~Log";
    } else if (localHead === EMPTY_NODE_ID) {
      relationText = "";
    } else if (isSearchId(localHead)) {
      relationText = parseSearchId(localHead) || "";
    }
  }
  return {
    head: localHead,
    items: List<RelationItem>(),
    context,
    id,
    text: relationText,
    textHash: hashText(relationText),
    parent,
    updated: Date.now(),
    author: myself,
    root: root ?? shortID(id),
  };
}

export function newRelationsForNode(
  nodeID: LongID | ID,
  context: Context,
  myself: PublicKey,
  root?: ID,
  parent?: LongID,
  text?: string
): Relations {
  return newRelations(nodeID, context, myself, root, parent, text);
}

export function upsertRelations(
  plan: Plan,
  viewPath: ViewPath,
  stack: ID[],
  modify: (relations: Relations) => Relations
): Plan {
  const [nodeID] = getNodeIDFromView(plan, viewPath);
  const context = getContext(plan, viewPath, stack);
  const parentRelation = getParentRelation(plan, viewPath);
  const parentRoot = parentRelation?.root;
  const currentRelation = getRelationForView(plan, viewPath, stack);

  if (currentRelation && currentRelation.author !== plan.user.publicKey) {
    throw new Error("Cannot edit another user's relations");
  }

  const base =
    currentRelation ||
    newRelationsForNode(
      nodeID,
      context,
      plan.user.publicKey,
      parentRoot,
      parentRelation?.id
    );

  // Apply modification
  const updatedRelations = modify(base);

  // Skip event if items unchanged
  if (currentRelation && currentRelation.items.equals(updatedRelations.items)) {
    return plan;
  }

  return planUpsertRelations(plan, updatedRelations);
}

function pathContainsSubpath(path: ViewPath, subpath: ViewPathSegment[]): boolean {
  if (subpath.length === 0 || path.length - 1 < subpath.length) {
    return false;
  }
  const segments = path.slice(1) as ViewPathSegment[];
  return segments.some((_, index) =>
    subpath.every((segment, offset) => segments[index + offset] === segment)
  );
}

export function updateViewPathsAfterMoveRelations(
  data: Data,
  _relationsID: LongID,
  _oldItems: List<RelationItem>,
  _indices: Array<number>,
  _startPosition?: number
): Views {
  return data.views;
}

export function updateViewPathsAfterAddRelation(
  data: Data,
  _relationsID: LongID,
  _addedNodeID: LongID | ID,
  _addedNodeIndex: number
): Views {
  return data.views;
}

export function updateViewPathsAfterDeleteNode(
  views: Views,
  nodeID: LongID | ID
): Views {
  return views.filterNot((_, k) => k.includes(nodeID));
}

export function updateViewPathsAfterDisconnect(
  views: Views,
  disconnectNode: LongID | ID,
  fromRelation: LongID,
  _nodeIndex: number
): Views {
  return views.filterNot((_, key) => {
    try {
      return pathContainsSubpath(parseViewPath(key), [fromRelation, disconnectNode]);
    } catch {
      return false;
    }
  });
}

export function updateViewPathsAfterPaneDelete(
  views: Views,
  removedPaneIndex: number
): Views {
  return views
    .filterNot((_, key) => key.startsWith(`p${removedPaneIndex}:`))
    .mapKeys((key) => {
      const match = key.match(/^p(\d+):/);
      if (!match) return key;
      const paneIndex = parseInt(match[1], 10);
      if (paneIndex > removedPaneIndex) {
        return key.replace(/^p\d+:/, `p${paneIndex - 1}:`);
      }
      return key;
    });
}

export function updateViewPathsAfterPaneInsert(
  views: Views,
  insertedPaneIndex: number
): Views {
  // When inserting a pane at index N, shift all pane indices >= N up by 1
  return views.mapKeys((key) => {
    const match = key.match(/^p(\d+):/);
    if (!match) return key;
    const paneIndex = parseInt(match[1], 10);
    if (paneIndex >= insertedPaneIndex) {
      return key.replace(/^p\d+:/, `p${paneIndex + 1}:`);
    }
    return key;
  });
}

export function bulkUpdateViewPathsAfterAddRelation(
  data: Data,
  _repoPath: ViewPath,
  _stack: ID[],
  _nAdds: number,
  _startPos?: number
): Views {
  return data.views;
}
