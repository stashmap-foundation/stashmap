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
  VERSIONS_NODE_ID,
  LOG_NODE_ID,
  EMPTY_NODE_ID,
  addRelationToRelations,
  isConcreteRefId,
  createConcreteRefId,
  parseConcreteRefId,
  findRefsToNode,
  getNodeTextHash,
  itemPassesFilters,
  getRelationItemNodeID,
  getRelationItemRelation,
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

// only exported for tests
export type NodeIndex = number & { readonly "": unique symbol };

export function contextsMatch(a: Context, b: Context): boolean {
  return a.equals(b);
}

function getSemanticNodeKey(
  knowledgeDBs: KnowledgeDBs,
  nodeID: LongID | ID,
  author: PublicKey
): string {
  return (
    getNodeTextHash(
      getNodeFromID(knowledgeDBs, shortID(nodeID) as ID, author)
    ) || shortID(nodeID)
  );
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

function debugVersions(
  message: string,
  payload: Record<string, unknown>
): void {
  if (process.env.DEBUG_VERSIONS !== "1") {
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[versions] ${message} ${JSON.stringify(payload)}`);
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
  return knowledgeDBs.toList().flatMap((db) =>
    db.relations
      .filter((r) => {
        if (!author) {
          return false;
        }
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
      })
      .toList()
  );
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
  debugVersions("start", {
    nodeID: shortID(nodeID),
    context: contextToMatch.toArray(),
    currentRelationID: currentRelation?.id,
    currentItemCount: currentRelation?.items.size,
    alternatives: alternatives
      .map((r) => ({
        id: r.id,
        context: r.context.toArray(),
        itemCount: r.items.size,
        author: r.author,
        root: r.root,
      }))
      .toArray(),
  });

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
        debugVersions("filtered-existing-cref", {
          nodeID: shortID(nodeID),
          candidateRelationID: r.id,
          currentRelationID: currentRelation?.id,
        });
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
        debugVersions("filtered-no-diff", {
          nodeID: shortID(nodeID),
          candidateRelationID: r.id,
        });
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
      debugVersions("candidate", {
        nodeID: shortID(nodeID),
        context: contextToMatch.toArray(),
        currentRelationID: currentRelation?.id,
        candidateRelationID: r.id,
        useExactMatch,
        addCount,
        removeCount,
        addIDs: addIDs.toArray(),
        coveredIDs: coveredIDs.toArray(),
        hasUncoveredAdds,
        threshold: suggestionSettings.maxSuggestions,
        keep,
      });
      return keep;
    })
    .sortBy((r) => -r.updated)
    .map((r) => createConcreteRefId(r.id))
    .toList();
}

type SubPath = {
  nodeID: LongID | ID;
  nodeIndex: NodeIndex;
};

type SubPathWithRelations = SubPath & {
  relationsID: ID;
};

export type ViewPath =
  | readonly [number, SubPath]
  | readonly [number, ...SubPathWithRelations[], SubPath];

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

export const VirtualItemsProvider = VirtualItemsContext.Provider;

export function useVirtualItemsMap(): VirtualItemsMap {
  return React.useContext(VirtualItemsContext);
}

// Encode nodeID to handle colons in ref IDs (ref:ctx:target format)
function encodeNodeID(nodeID: string): string {
  return nodeID.replace(/:/g, "%3A");
}

function decodeNodeID(encoded: string): string {
  return encoded.replace(/%3A/g, ":");
}

export function parseViewPath(path: string): ViewPath {
  const pieces = path.split(":");
  if (pieces.length < 3) {
    throw new Error("Invalid view path");
  }

  // First piece is pane index (e.g., "p0")
  const paneIndex = parseInt(pieces[0].substring(1), 10);
  const pathPieces = pieces.slice(1);

  const nodeIndexEnd = parseInt(
    pathPieces[pathPieces.length - 1],
    10
  ) as NodeIndex;
  const nodeIdEnd = decodeNodeID(pathPieces[pathPieces.length - 2]) as LongID;

  const beginning = pathPieces
    .slice(0, -2)
    .reduce(
      (
        acc: SubPathWithRelations[],
        piece,
        index,
        subPaths
      ): SubPathWithRelations[] => {
        if (index % 3 === 0) {
          const nodeID = decodeNodeID(piece) as LongID;
          const indexValue = parseInt(subPaths[index + 1], 10) as NodeIndex;
          const relationID = decodeNodeID(subPaths[index + 2]);
          return [
            ...acc,
            { nodeID, nodeIndex: indexValue, relationsID: relationID },
          ];
        }
        return acc;
      },
      []
    );
  return [
    paneIndex,
    ...beginning,
    { nodeID: nodeIdEnd, nodeIndex: nodeIndexEnd },
  ];
}

function convertViewPathToString(viewContext: ViewPath): string {
  const paneIndex = viewContext[0] as number;
  const pathWithoutPane = viewContext.slice(1) as readonly SubPath[];
  const withoutLastElement = pathWithoutPane.slice(
    0,
    -1
  ) as SubPathWithRelations[];
  const beginning = withoutLastElement.reduce(
    (acc: string, subPath: SubPathWithRelations): string => {
      const postfix = `${encodeNodeID(subPath.nodeID)}:${
        subPath.nodeIndex
      }:${encodeNodeID(subPath.relationsID)}`;
      return acc !== "" ? `${acc}:${postfix}` : postfix;
    },
    ""
  );
  const lastPath = pathWithoutPane[pathWithoutPane.length - 1];
  const end = `${encodeNodeID(lastPath.nodeID)}:${lastPath.nodeIndex}`;
  const pathPart = beginning !== "" ? `${beginning}:${end}` : end;
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
  const paneIndex = getPaneIndex(viewContext);
  const pathWithoutLast = viewContext.slice(1, -1) as SubPathWithRelations[];
  const parent = pathWithoutLast[pathWithoutLast.length - 1];
  if (!parent) {
    return undefined;
  }
  return [
    paneIndex,
    ...pathWithoutLast.slice(0, -1),
    { nodeID: parent.nodeID, nodeIndex: parent.nodeIndex },
  ];
}

export function getContext(
  data: Data,
  viewPath: ViewPath,
  stack: ID[]
): Context {
  if (isRoot(viewPath)) {
    return getContextFromStack(stack);
  }

  // viewPath structure: [paneIndex, ...SubPathWithRelations[], SubPath]
  // The second-to-last element has relationsID pointing to the relation
  // that contains the current node. We look it up and derive context from it.
  const parentElement = viewPath[viewPath.length - 2] as SubPathWithRelations;

  if (parentElement.relationsID) {
    const parentRelation = getRelations(
      data.knowledgeDBs,
      parentElement.relationsID,
      data.user.publicKey
    );
    if (parentRelation) {
      return parentRelation.context.push(parentRelation.head);
    }
  }

  // Parent relation not found (e.g., diff items where parent has no relation yet).
  // Traverse back to grandparent and derive context from there.
  const parentPath = getParentView(viewPath);
  if (!parentPath) {
    throw new Error("Cannot determine context: no parent path found");
  }
  const parentContext = getContext(data, parentPath, stack);
  return parentContext.push(parentElement.nodeID);
}

function getViewExactMatch(views: Views, path: ViewPath): View | undefined {
  const viewKey = viewPathToString(path);
  return views.get(viewKey);
}

// Sort relations by updated timestamp (most recent first)
function sortRelationsByDate(relations: List<Relations>): List<Relations> {
  return relations.sort((a, b) => b.updated - a.updated);
}

export function getLast(viewContext: ViewPath): SubPath {
  return viewContext[viewContext.length - 1] as SubPath;
}

function getDefaultView(id: ID, isRootNode: boolean): View {
  return {
    expanded: isRootNode || isSearchId(id),
  };
}

function getRelationItemViewNodeID(
  knowledgeDBs: KnowledgeDBs | undefined,
  relations: Relations,
  item: RelationItem
): LongID | ID {
  return knowledgeDBs
    ? getRelationItemNodeID(knowledgeDBs, item, relations.author)
    : item.id;
}

export function getViewFromPath(data: Data, path: ViewPath): View {
  const { nodeID } = getLast(path);
  return (
    getViewExactMatch(data.views, path) || getDefaultView(nodeID, isRoot(path))
  );
}

function relationHeadMatchesNode(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  head: ID,
  requestedNodeID: LongID | ID
): boolean {
  const localID = shortID(requestedNodeID);
  if (head === localID) {
    return true;
  }
  return getNodeTextHash(getNodeFromID(knowledgeDBs, head, author)) === localID;
}

function getNewestStandaloneRelationFromAuthor(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  nodeID: LongID | ID,
  context: Context
): Relations | undefined {
  const localID = shortID(nodeID);
  const authorDB = knowledgeDBs.get(author, newDB());
  return sortRelationsByDate(
    authorDB.relations
      .filter(
        (r) =>
          relationHeadMatchesNode(knowledgeDBs, author, r.head, localID) &&
          r.root === shortID(r.id) &&
          contextsMatch(r.context, context)
      )
      .toList()
  ).first();
}

function getNewestRelationFromRoot(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  nodeID: LongID | ID,
  context: Context,
  root: ID
): Relations | undefined {
  const localID = shortID(nodeID);
  const authorDB = knowledgeDBs.get(author, newDB());
  return sortRelationsByDate(
    authorDB.relations
      .filter(
        (r) =>
          relationHeadMatchesNode(knowledgeDBs, author, r.head, localID) &&
          r.root === root &&
          contextsMatch(r.context, context)
      )
      .toList()
  ).first();
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

  let currentRelation = getNewestStandaloneRelationFromAuthor(
    knowledgeDBs,
    author,
    requestedStack[0],
    List<ID>()
  );
  if (!currentRelation) {
    return undefined;
  }
  const actualStack: ID[] = [currentRelation.head as ID];

  for (let index = 1; index < requestedStack.length; index += 1) {
    if (!currentRelation) {
      return undefined;
    }
    const relation: Relations = currentRelation;
    const nextRequested = requestedStack[index];
    const nextItem: RelationItem | undefined = relation.items.find(
      (item: RelationItem) => {
      const itemNodeID = getRelationItemNodeID(
        knowledgeDBs,
        item,
        relation.author
      );
      return (
        !isRefId(itemNodeID) &&
        relationHeadMatchesNode(knowledgeDBs, author, itemNodeID, nextRequested)
      );
      }
    );
    const nextNodeID = nextItem
      ? (shortID(
          getRelationItemNodeID(knowledgeDBs, nextItem, relation.author)
        ) as ID)
      : undefined;
    if (!nextNodeID) {
      return undefined;
    }
    actualStack.push(nextNodeID);
    currentRelation = nextItem
      ? getRelationItemRelation(knowledgeDBs, nextItem, relation.author)
      : undefined;
    if (!currentRelation && index < requestedStack.length - 1) {
      return undefined;
    }
  }

  return { actualStack, relation: currentRelation };
}

function getRelationFromContextPath(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  nodeID: LongID | ID,
  context: Context
): Relations | undefined {
  const resolved = resolveNodeStackToActualIDs(knowledgeDBs, author, [
    ...context.toArray(),
    shortID(nodeID) as ID,
  ]);
  return resolved?.relation;
}

export function getNodeIDFromView(
  data: Data,
  viewPath: ViewPath
): [LongID | ID, View] {
  const view = getViewFromPath(data, viewPath);
  const { nodeID } = getLast(viewPath);
  return [nodeID, view];
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
    return getNewestRelationFromRoot(
      knowledgeDBs,
      paneAuthor,
      nodeID,
      context,
      preferredRoot
    );
  }

  if (!isRootNode) {
    return undefined;
  }

  return getRelationFromContextPath(knowledgeDBs, paneAuthor, nodeID, context);
}

export function getParentRelation(
  data: Data,
  viewPath: ViewPath
): Relations | undefined {
  if (isRoot(viewPath)) {
    return undefined;
  }

  const parentElement = viewPath[viewPath.length - 2] as SubPathWithRelations;
  if (!parentElement.relationsID) {
    return undefined;
  }

  return getRelations(
    data.knowledgeDBs,
    parentElement.relationsID,
    data.user.publicKey
  );
}

export function getEffectiveAuthor(data: Data, viewPath: ViewPath): PublicKey {
  const pane = getPane(data, viewPath);
  const parentRelation = getParentRelation(data, viewPath);
  return parentRelation?.author || pane.author;
}

export function getRelationForView(
  data: Data,
  viewPath: ViewPath,
  stack: ID[]
): Relations | undefined {
  const [nodeID] = getNodeIDFromView(data, viewPath);
  const context = getContext(data, viewPath, stack);
  const pane = getPane(data, viewPath);
  const parentRoot = getParentRelation(data, viewPath)?.root;
  const author = getEffectiveAuthor(data, viewPath);

  if (isConcreteRefId(nodeID)) {
    return getRelations(data.knowledgeDBs, nodeID, author);
  }

  const currentItem = getRelationItemForView(data, viewPath);
  const currentItemRelation = currentItem
    ? getRelationItemRelation(data.knowledgeDBs, currentItem, author)
    : undefined;
  if (currentItemRelation) {
    return currentItemRelation;
  }

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

function getNodeFromAnyDB(
  knowledgeDBs: KnowledgeDBs,
  id: string
): KnowNode | undefined {
  const directMatch = knowledgeDBs
    .map((db) => db.nodes.get(id))
    .filter((node) => node !== undefined)
    .first(undefined);
  if (directMatch) {
    return directMatch;
  }
  return knowledgeDBs
    .valueSeq()
    .flatMap((db) => db.nodes.valueSeq())
    .find((node) => getNodeTextHash(node) === id);
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
    const query = parseSearchId(id as ID);
    return {
      id: id as ID,
      text: `Search: ${query}`,
      type: "text",
    };
  }

  const [remote, knowID] = splitID(id);
  const db = knowledgeDBs.get(remote || myself, newDB());
  const node = db.nodes.get(knowID);
  if (!node && remote === undefined) {
    // Check for special local nodes like ROOT that aren't stored in events
    const defaultNode = newDB().nodes.get(knowID);
    if (defaultNode) {
      return defaultNode;
    }
    return getNodeFromAnyDB(knowledgeDBs, knowID);
  }
  return node;
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

export const VERSION_FILTERS: TypeFilters = [
  "relevant",
  "little_relevant",
  "contains",
  "confirms",
  "contra",
];

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

/**
 * Get the context for looking up versions of a node.
 * This is the path TO the node plus the node's ID.
 */
export function getVersionsContext(nodeID: ID, context: Context): Context {
  return context.push(nodeID);
}

/**
 * Get the versions relations for a node.
 */
export function getVersionsRelations(
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey,
  nodeID: ID,
  context: Context,
  currentRoot?: ID
): Relations | undefined {
  const versionsContext = getVersionsContext(nodeID, context);
  const result = getRelationsForCurrentTree(
    knowledgeDBs,
    author,
    VERSIONS_NODE_ID,
    versionsContext,
    undefined,
    false,
    currentRoot
  );
  return result;
}

/**
 * Get versioned display text for a node.
 */
export function getVersionedDisplayText(
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  nodeID: ID,
  context: Context,
  currentRoot?: ID
): string | undefined {
  if (nodeID === EMPTY_NODE_ID) return undefined;

  const versionsRelations = getVersionsRelations(
    knowledgeDBs,
    myself,
    nodeID,
    context,
    currentRoot
  );
  if (!versionsRelations) return undefined;

  const versions = filterRelationItems(
    versionsRelations.items,
    VERSION_FILTERS
  );
  const firstVersion = versions.first();
  if (!firstVersion) return undefined;
  return (
    getRelationItemRelation(knowledgeDBs, firstVersion, myself)?.text ||
    getNodeFromID(
      knowledgeDBs,
      getRelationItemNodeID(knowledgeDBs, firstVersion, myself),
      myself
    )?.text
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

export function calculateNodeIndex(
  relations: Relations,
  index: number,
  knowledgeDBs?: KnowledgeDBs
): NodeIndex {
  const item = relations.items.get(index);
  if (!item) {
    throw new Error(`No item found at index ${index}`);
  }
  const itemNodeID = getRelationItemViewNodeID(knowledgeDBs, relations, item);
  return relations.items
    .slice(0, index)
    .filter(
      (candidate) =>
        getRelationItemViewNodeID(knowledgeDBs, relations, candidate) ===
        itemNodeID
    ).size as NodeIndex;
}

export function calculateIndexFromNodeIndex(
  relations: Relations,
  node: LongID | ID,
  nodeIndex: NodeIndex,
  knowledgeDBs?: KnowledgeDBs
): number | undefined {
  const { items } = relations;
  const res = items.reduce(
    ([acc, found]: [number, boolean], item, idx): [number, boolean] => {
      if (found) {
        return [acc, true];
      }
      if (getRelationItemViewNodeID(knowledgeDBs, relations, item) === node) {
        if (acc === nodeIndex) {
          return [idx, true];
        }
        return [acc + 1, false];
      }
      return [acc, false];
    },
    [0, false]
  );
  if (res[1] === false) {
    return undefined;
  }
  return res[0];
}

export function addRelationsToLastElement(
  path: ViewPath,
  relationsID: LongID
): [number, ...SubPathWithRelations[]] {
  const paneIndex = getPaneIndex(path);
  // Skip pane index (position 0) and last element
  const middleElements = path.slice(1, -1) as SubPathWithRelations[];
  return [paneIndex, ...middleElements, { ...getLast(path), relationsID }];
}

export function addNodeToPathWithRelations(
  data: Pick<Data, "knowledgeDBs">,
  path: ViewPath,
  relations: Relations,
  index: number
): ViewPath {
  const item = relations.items.get(index);
  if (!item) {
    throw new Error("No node found in relation at index");
  }
  const nodeID = getRelationItemViewNodeID(data.knowledgeDBs, relations, item);
  const nodeIndex = calculateNodeIndex(relations, index, data.knowledgeDBs);
  const pathWithRelations = addRelationsToLastElement(path, relations.id);
  return [...pathWithRelations, { nodeID, nodeIndex }];
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
  return addNodeToPathWithRelations(data, path, relations, index);
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
  const { nodeIndex, nodeID } = getLast(viewPath);
  const relations = getParentRelation(data, viewPath);
  if (!relations) {
    return undefined;
  }
  return calculateIndexFromNodeIndex(
    relations,
    nodeID,
    nodeIndex,
    data.knowledgeDBs
  );
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
  return addNodeToPathWithRelations(data, viewPath, relations, lastIndex);
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
  const startPath: ViewPath = [
    paneIndex,
    { nodeID: root, nodeIndex: 0 as NodeIndex },
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
  const [nodeID] = getNodeIDFromView(data, viewPath);
  const context = getContext(data, viewPath, stack);
  const effectiveAuthor = getEffectiveAuthor(data, viewPath);
  const currentRoot = getRelationForView(data, viewPath, stack)?.root;
  const versionedText = getVersionedDisplayText(
    data.knowledgeDBs,
    effectiveAuthor,
    nodeID,
    context,
    currentRoot
  );
  return versionedText ?? node?.text ?? "";
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
  return viewKey.split(":").slice(0, -3).join(":");
}

export function updateView(views: Views, path: ViewPath, view: View): Views {
  const key = viewPathToString(path);
  const { nodeID } = getLast(path);
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
  root?: ID
): Relations {
  const id = joinID(myself, v4());
  const localHead = shortID(head) as ID;
  let text = "";
  if (localHead === VERSIONS_NODE_ID) {
    text = "~versions";
  } else if (localHead === LOG_NODE_ID) {
    text = "~Log";
  } else if (localHead === EMPTY_NODE_ID) {
    text = "";
  } else if (isSearchId(localHead)) {
    text = parseSearchId(localHead) || "";
  }
  return {
    head: localHead,
    items: List<RelationItem>(),
    context,
    id,
    text,
    textHash: hashText(text),
    parent: undefined,
    updated: Date.now(),
    author: myself,
    root: root ?? shortID(id),
  };
}

// Creates new relations, prepopulating ~versions with the original node
// The versionsContext is [...path, originalNodeID], so originalNodeID is context.last()
export function newRelationsForNode(
  nodeID: LongID | ID,
  context: Context,
  myself: PublicKey,
  root?: ID
): Relations {
  const relations = newRelations(nodeID, context, myself, root);
  if (shortID(nodeID) === VERSIONS_NODE_ID && context.size > 0) {
    const originalNodeID = context.last() as ID;
    return addRelationToRelations(relations, originalNodeID);
  }
  return relations;
}

export function upsertRelations(
  plan: Plan,
  viewPath: ViewPath,
  stack: ID[],
  modify: (relations: Relations) => Relations
): Plan {
  const pane = getPane(plan, viewPath);
  const [nodeID] = getNodeIDFromView(plan, viewPath);
  const context = getContext(plan, viewPath, stack);
  const parentRoot = getParentRelation(plan, viewPath)?.root;
  const author = getEffectiveAuthor(plan, viewPath);

  const currentRelation = getRelationsForCurrentTree(
    plan.knowledgeDBs,
    author,
    nodeID,
    context,
    pane.rootRelation,
    isRoot(viewPath),
    parentRoot
  );

  if (currentRelation && currentRelation.author !== plan.user.publicKey) {
    throw new Error("Cannot edit another user's relations");
  }

  const base =
    currentRelation ||
    newRelationsForNode(nodeID, context, plan.user.publicKey, parentRoot);
  const relations =
    shortID(nodeID) === VERSIONS_NODE_ID &&
    base.items.size === 0 &&
    context.size > 0
      ? addRelationToRelations(base, context.last() as ID)
      : base;

  // Apply modification
  const updatedRelations = modify(relations);

  // Skip event if items unchanged
  if (currentRelation && currentRelation.items.equals(updatedRelations.items)) {
    return plan;
  }

  return planUpsertRelations(plan, updatedRelations);
}

function alterPath(
  viewPathStr: string,
  calcIndex: (
    relationsID: LongID,
    nodeID: ID,
    nodeIndex: NodeIndex
  ) => NodeIndex
): string {
  const path = parseViewPath(viewPathStr);
  if (path.length <= 2) {
    return viewPathStr;
  }
  const paneIndex = getPaneIndex(path);
  const parents = path.slice(1, -1) as SubPathWithRelations[];
  const last = getLast(path);

  const { segments, prevRelationsID } = parents.reduce(
    (
      acc: {
        segments: SubPathWithRelations[];
        prevRelationsID: LongID | undefined;
      },
      parent
    ) => ({
      segments: [
        ...acc.segments,
        acc.prevRelationsID === undefined
          ? parent
          : {
              ...parent,
              nodeIndex: calcIndex(
                acc.prevRelationsID,
                parent.nodeID as ID,
                parent.nodeIndex
              ),
            },
      ],
      prevRelationsID: parent.relationsID as LongID,
    }),
    { segments: [], prevRelationsID: undefined }
  );

  const alteredLast = {
    ...last,
    nodeIndex: calcIndex(
      prevRelationsID as LongID,
      last.nodeID as ID,
      last.nodeIndex
    ),
  };

  return convertViewPathToString([
    paneIndex,
    ...segments,
    alteredLast,
  ] as ViewPath);
}

function alterNodeIndicesInViews(
  views: Views,
  relationsID: LongID,
  calcIndex: (
    relationsID: LongID,
    nodeID: ID,
    nodeIndex: NodeIndex
  ) => NodeIndex
): Views {
  const pattern = `:${relationsID}:`;
  return views.mapKeys((key) => {
    if (!key.includes(pattern)) {
      return key;
    }
    return alterPath(key, calcIndex);
  });
}

export function updateViewPathsAfterMoveRelations(
  data: Data,
  relationsID: LongID,
  oldItems: List<RelationItem>,
  indices: Array<number>,
  startPosition?: number
): Views {
  if (startPosition === undefined) {
    return data.views;
  }
  const itemsBeforeStartPos = indices.filter((i) => i < startPosition).length;
  const insertPos = startPosition - itemsBeforeStartPos;
  const remaining = Array.from({ length: oldItems.size }, (_, i) => i).filter(
    (i) => !indices.includes(i)
  );
  const newOrder = [
    ...remaining.slice(0, insertPos),
    ...indices,
    ...remaining.slice(insertPos),
  ];
  const knowledgeDBs = data.knowledgeDBs || Map<PublicKey, KnowledgeData>();
  const currentUser = data.user?.publicKey || ("" as PublicKey);

  const renames = newOrder.reduce<
    Array<{ nodeID: LongID | ID; oldIdx: NodeIndex; newIdx: NodeIndex }>
  >((acc, oldPos, newPos) => {
    const item = oldItems.get(oldPos);
    const relation = getRelations(
      knowledgeDBs,
      relationsID,
      currentUser
    );
    if (!item) {
      return acc;
    }
    if (!relation) {
      return acc;
    }
    const itemNodeID = getRelationItemViewNodeID(knowledgeDBs, relation, item);
    const oldNodeIndex = oldItems
      .slice(0, oldPos)
      .filter(
        (candidate) =>
          getRelationItemViewNodeID(knowledgeDBs, relation, candidate) ===
          itemNodeID
      ).size as NodeIndex;
    const newNodeIndex = newOrder
      .slice(0, newPos)
      .filter(
        (position) =>
          getRelationItemViewNodeID(
            knowledgeDBs,
            relation,
            oldItems.get(position) as RelationItem
          ) === itemNodeID
      )
      .length as unknown as NodeIndex;
    if (oldNodeIndex !== newNodeIndex) {
      return [
        ...acc,
        { nodeID: itemNodeID, oldIdx: oldNodeIndex, newIdx: newNodeIndex },
      ];
    }
    return acc;
  }, []);

  if (renames.length === 0) {
    return data.views;
  }

  return alterNodeIndicesInViews(
    data.views,
    relationsID,
    (relation, node, index) => {
      if (relation !== relationsID) {
        return index;
      }
      const rename = renames.find(
        (r) => r.nodeID === node && r.oldIdx === index
      );
      return rename ? rename.newIdx : index;
    }
  );
}

export function updateViewPathsAfterAddRelation(
  data: Data,
  relationsID: LongID,
  addedNodeID: LongID | ID,
  addedNodeIndex: NodeIndex
): Views {
  return alterNodeIndicesInViews(
    data.views,
    relationsID,
    (relation, node, index) => {
      if (
        relation === relationsID &&
        node === addedNodeID &&
        index >= addedNodeIndex
      ) {
        return (index + 1) as NodeIndex;
      }
      return index;
    }
  );
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
  nodeIndex: NodeIndex
): Views {
  // If I delete A:0, A:1 will be A:0, A:2 will be A:1 ...
  const toDelete = `${fromRelation}:${disconnectNode}:${nodeIndex}`;
  const withDeleted = views.filterNot(
    (_, k) => k.includes(`${toDelete}:`) || k.endsWith(toDelete)
  );

  return alterNodeIndicesInViews(
    withDeleted,
    fromRelation,
    (relation, node, index) => {
      if (
        relation === fromRelation &&
        node === disconnectNode &&
        index > nodeIndex
      ) {
        return (index - 1) as NodeIndex;
      }
      return index;
    }
  );
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
  repoPath: ViewPath,
  stack: ID[],
  nAdds: number,
  startPos?: number
): Views {
  const relation = getRelationForView(data, repoPath, stack);
  if (!relation || startPos === undefined) {
    return data.views;
  }
  return Array.from({ length: nAdds }, (_, i) => i).reduce(
    (rdx, currentIndex) => {
      const pos = startPos + currentIndex;
      const item = relation.items.get(pos);
      if (!item) {
        return rdx;
      }
      const itemNodeID = getRelationItemViewNodeID(
        data.knowledgeDBs,
        relation,
        item
      );
      const addedNodeIndex = relation.items
        .slice(0, pos)
        .filter(
          (candidate) =>
            getRelationItemViewNodeID(
              data.knowledgeDBs,
              relation,
              candidate
            ) === itemNodeID
        ).size as NodeIndex;
      return updateViewPathsAfterAddRelation(
        { ...data, views: rdx },
        relation.id,
        itemNodeID,
        addedNodeIndex
      );
    },
    data.views
  );
}
