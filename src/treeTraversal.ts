import { List, Map, Set as ImmutableSet } from "immutable";
import {
  ViewPath,
  VirtualItemsMap,
  addNodeToPathWithRelations,
  addRelationsToLastElement,
  getRowIDFromView,
  getContext,
  getRelationForView,
  getEffectiveAuthor,
  getParentRelation,
  viewPathToString,
} from "./ViewContext";
import {
  isConcreteRefId,
  isSearchId,
  getRelations,
  itemPassesFilters,
  getRelationContext,
  getRelationSemanticID,
} from "./connections";
import { DEFAULT_TYPE_FILTERS } from "./constants";
import { buildOutgoingReference } from "./buildReferenceRow";
import {
  getIncomingCrefsForNode,
  getOccurrencesForNode,
  getSuggestionsForNode,
  getVersionsForRelation,
} from "./semanticProjection";

type TreeResult = {
  paths: List<ViewPath>;
  virtualItems: VirtualItemsMap;
  firstVirtualKeys: ImmutableSet<string>;
};

export type TreeTraversalOptions = {
  isMarkdownExport?: boolean;
};

const EMPTY_VIRTUAL_ITEMS: VirtualItemsMap = Map<string, RelationItem>();
const EMPTY_FIRST_VIRTUAL_KEYS: ImmutableSet<string> = ImmutableSet<string>();

function getChildrenForConcreteRef(
  data: Data,
  parentPath: ViewPath,
  parentItemID: LongID | ID
): TreeResult {
  const sourceRelation = getRelations(
    data.knowledgeDBs,
    parentItemID,
    data.user.publicKey
  );
  if (!sourceRelation || sourceRelation.items.size === 0) {
    return {
      paths: List(),
      virtualItems: EMPTY_VIRTUAL_ITEMS,
      firstVirtualKeys: EMPTY_FIRST_VIRTUAL_KEYS,
    };
  }

  return {
    paths: sourceRelation.items
      .map((_, i) => addNodeToPathWithRelations(parentPath, sourceRelation, i))
      .toList(),
    virtualItems: EMPTY_VIRTUAL_ITEMS,
    firstVirtualKeys: EMPTY_FIRST_VIRTUAL_KEYS,
  };
}

function getChildrenForRegularNode(
  data: Data,
  parentPath: ViewPath,
  parentItemID: LongID | ID,
  stack: ID[],
  rootRelation: LongID | undefined,
  author: PublicKey,
  typeFilters: Pane["typeFilters"],
  options?: TreeTraversalOptions
): TreeResult {
  const effectiveAuthor = getEffectiveAuthor(data, parentPath);
  const context = getContext(data, parentPath, stack);
  const currentRoot = getParentRelation(data, parentPath)?.root;
  const activeFilters = typeFilters || DEFAULT_TYPE_FILTERS;
  const directRelations = isSearchId(parentItemID as ID)
    ? getRelations(data.knowledgeDBs, parentItemID as ID, data.user.publicKey)
    : getRelationForView(data, parentPath, stack);
  const relations = directRelations;
  const relationSemanticID = relations
    ? getRelationSemanticID(relations)
    : parentItemID;
  const coordinateSemanticID = relations ? relationSemanticID : parentItemID;
  const coordinateContext = relations
    ? getRelationContext(data.knowledgeDBs, relations)
    : context;

  const relationPaths = relations
    ? relations.items
        .map((item, i) => ({ item, index: i }))
        .filter(
          ({ item }) =>
            options?.isMarkdownExport || itemPassesFilters(item, activeFilters)
        )
        .map(({ index }) =>
          addNodeToPathWithRelations(parentPath, relations, index)
        )
        .toList()
    : List<ViewPath>();

  if (options?.isMarkdownExport) {
    return {
      paths: relationPaths,
      virtualItems: EMPTY_VIRTUAL_ITEMS,
      firstVirtualKeys: EMPTY_FIRST_VIRTUAL_KEYS,
    };
  }

  const relationId = relations?.id || ("" as LongID);

  const containingRelationID = getParentRelation(data, parentPath)?.id;
  const visibleAuthors = data.contacts
    .keySeq()
    .toSet()
    .union(data.projectMembers.keySeq().toSet())
    .add(data.user.publicKey)
    .add(author)
    .add(effectiveAuthor);

  const incomingCrefs = getIncomingCrefsForNode(
    data.knowledgeDBs,
    visibleAuthors,
    coordinateSemanticID,
    containingRelationID,
    relations?.id,
    author,
    relations?.items
  );

  const visibleIncomingCrefs = activeFilters.includes("incoming")
    ? incomingCrefs
    : List<LongID>();
  const occurrences = activeFilters.includes("occurrence")
    ? getOccurrencesForNode(
        data.knowledgeDBs,
        visibleAuthors,
        coordinateSemanticID,
        relations?.id,
        effectiveAuthor,
        coordinateContext,
        relations?.root ?? currentRoot,
        relations?.items,
        incomingCrefs
      )
    : List<LongID | ID>();
  const sortedOccurrences = occurrences.sortBy((refID) => {
    const reference = buildOutgoingReference(
      refID as LongID,
      data.knowledgeDBs,
      data.user.publicKey
    );
    return reference?.text || String(refID);
  });

  const isOwnContent = effectiveAuthor === data.user.publicKey;

  const { suggestions: diffItems, coveredCandidateIDs } = isOwnContent
    ? getSuggestionsForNode(
        data.knowledgeDBs,
        visibleAuthors,
        data.user.publicKey,
        coordinateSemanticID,
        activeFilters,
        relations?.id,
        coordinateContext
      )
    : {
        suggestions: List<LongID | ID>(),
        coveredCandidateIDs: ImmutableSet<string>(),
      };

  const addVirtualItems = (
    acc: { paths: List<ViewPath>; virtualItems: VirtualItemsMap },
    items: List<LongID | ID>,
    virtualType: VirtualType
  ): { paths: List<ViewPath>; virtualItems: VirtualItemsMap } =>
    items.reduce((result, itemID) => {
      const pathWithRelations = addRelationsToLastElement(
        parentPath,
        relationId
      );
      const path = [...pathWithRelations, itemID] as ViewPath;
      const isCref = isConcreteRefId(itemID as LongID);
      return {
        paths: result.paths.push(path),
        virtualItems: result.virtualItems.set(viewPathToString(path), {
          id: itemID,
          relevance: undefined as Relevance,
          virtualType,
          ...(isCref ? { isCref: true } : {}),
        }),
      };
    }, acc);

  const initial = {
    paths: List<ViewPath>(),
    virtualItems: EMPTY_VIRTUAL_ITEMS,
  };
  const versions = getVersionsForRelation(
    data.knowledgeDBs,
    visibleAuthors,
    coordinateSemanticID,
    activeFilters,
    relations,
    coordinateContext,
    coveredCandidateIDs
  );

  const withIncoming = addVirtualItems(
    initial,
    visibleIncomingCrefs,
    "incoming"
  );
  const withSuggestions = addVirtualItems(
    withIncoming,
    diffItems,
    "suggestion"
  );
  const withOccurrences = addVirtualItems(
    withSuggestions,
    sortedOccurrences,
    "occurrence"
  );
  const withVersions = addVirtualItems(withOccurrences, versions, "version");

  const firstVirtualPath = withVersions.paths.first();
  const firstVirtualKeys = firstVirtualPath
    ? EMPTY_FIRST_VIRTUAL_KEYS.add(viewPathToString(firstVirtualPath))
    : EMPTY_FIRST_VIRTUAL_KEYS;

  return {
    paths: relationPaths.concat(withVersions.paths),
    virtualItems: withVersions.virtualItems,
    firstVirtualKeys,
  };
}

export function getChildNodes(
  data: Data,
  parentPath: ViewPath,
  stack: ID[],
  rootRelation: LongID | undefined,
  author: PublicKey,
  typeFilters: Pane["typeFilters"],
  options?: TreeTraversalOptions
): TreeResult {
  const [parentItemID] = getRowIDFromView(data, parentPath);

  if (isConcreteRefId(parentItemID)) {
    return getChildrenForConcreteRef(data, parentPath, parentItemID);
  }

  return getChildrenForRegularNode(
    data,
    parentPath,
    parentItemID,
    stack,
    rootRelation,
    author,
    typeFilters,
    options
  );
}

export function getNodesInTree(
  data: Data,
  parentPath: ViewPath,
  stack: ID[],
  ctx: List<ViewPath>,
  rootRelation: LongID | undefined,
  author: PublicKey,
  typeFilters: Pane["typeFilters"],
  options?: TreeTraversalOptions
): TreeResult {
  const childResult = getChildNodes(
    data,
    parentPath,
    stack,
    rootRelation,
    author,
    typeFilters,
    options
  );

  return childResult.paths.reduce(
    (result, childPath) => {
      const [, childView] = getRowIDFromView(data, childPath);
      const withChild = result.paths.push(childPath);

      const [childItemID] = getRowIDFromView(data, childPath);
      const shouldRecurse = options?.isMarkdownExport
        ? !isConcreteRefId(childItemID)
        : childView.expanded;
      if (shouldRecurse) {
        const sub = getNodesInTree(
          data,
          childPath,
          stack,
          withChild,
          rootRelation,
          author,
          typeFilters,
          options
        );
        return {
          paths: sub.paths,
          virtualItems: result.virtualItems.merge(sub.virtualItems),
          firstVirtualKeys: result.firstVirtualKeys.union(sub.firstVirtualKeys),
        };
      }
      return { ...result, paths: withChild };
    },
    {
      paths: ctx,
      virtualItems: childResult.virtualItems,
      firstVirtualKeys: childResult.firstVirtualKeys,
    }
  );
}
