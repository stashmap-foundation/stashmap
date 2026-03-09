import { List, Map, Set as ImmutableSet } from "immutable";
import {
  ViewPath,
  VirtualItemsMap,
  addNodeToPathWithRelations,
  addRelationsToLastElement,
  getItemIDFromView,
  getContext,
  getRelationForView,
  getEffectiveAuthor,
  getParentRelation,
  isRoot,
  viewPathToString,
} from "./ViewContext";
import {
  isConcreteRefId,
  isSearchId,
  getRelations,
  itemPassesFilters,
  getOccurrencesForNode,
  getIncomingCrefsForNode,
  getRelationContext,
  getRelationSemanticID,
} from "./connections";
import { DEFAULT_TYPE_FILTERS } from "./constants";
import { buildOutgoingReference } from "./buildReferenceRow";
import {
  getSuggestionsForNode,
  getVersionsForRelation,
} from "./footerSemantics";

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
  parentNodeID: LongID | ID
): TreeResult {
  const sourceRelation = getRelations(
    data.knowledgeDBs,
    parentNodeID,
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
      .map((_, i) =>
        addNodeToPathWithRelations(parentPath, sourceRelation, i)
      )
      .toList(),
    virtualItems: EMPTY_VIRTUAL_ITEMS,
    firstVirtualKeys: EMPTY_FIRST_VIRTUAL_KEYS,
  };
}

function getChildrenForRegularNode(
  data: Data,
  parentPath: ViewPath,
  parentNodeID: LongID | ID,
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
  const directRelations = isSearchId(parentNodeID as ID)
    ? getRelations(data.knowledgeDBs, parentNodeID as ID, data.user.publicKey)
    : getRelationForView(data, parentPath, stack);
  const relations = directRelations;
  const relationNodeID = relations ? getRelationSemanticID(relations) : parentNodeID;
  const coordinateNodeID = relations ? relationNodeID : parentNodeID;
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

  const incomingCrefs = getIncomingCrefsForNode(
    data.knowledgeDBs,
    coordinateNodeID,
    containingRelationID,
    relations?.id,
    author,
    relations?.items,
    coordinateContext,
    relations?.root ?? currentRoot
  );

  const visibleIncomingCrefs = activeFilters.includes("incoming")
    ? incomingCrefs
    : List<LongID>();

  const occurrences = activeFilters.includes("occurrence")
    ? getOccurrencesForNode(
        data.knowledgeDBs,
        coordinateNodeID,
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

  const {
    suggestions: diffItems,
    coveredCandidateIDs,
    crefSuggestionIDs,
  } = isOwnContent
    ? getSuggestionsForNode(
          data.knowledgeDBs,
          data.user.publicKey,
          coordinateNodeID,
          activeFilters,
          relations?.id,
          coordinateContext
      )
    : {
        suggestions: List<LongID | ID>(),
        coveredCandidateIDs: ImmutableSet<string>(),
        crefSuggestionIDs: ImmutableSet<string>(),
      };

  const addVirtualItems = (
    acc: { paths: List<ViewPath>; virtualItems: VirtualItemsMap },
    items: List<LongID | ID>,
    virtualType: VirtualType,
    crefIDs?: ImmutableSet<string>
  ): { paths: List<ViewPath>; virtualItems: VirtualItemsMap } =>
    items.reduce((result, nodeID, idx) => {
      const pathWithRelations = addRelationsToLastElement(
        parentPath,
        relationId
      );
      const path = [...pathWithRelations, nodeID] as ViewPath;
      const isCref = crefIDs?.has(nodeID as string);
      return {
        paths: result.paths.push(path),
        virtualItems: result.virtualItems.set(viewPathToString(path), {
          id: nodeID,
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
    coordinateNodeID,
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
    "suggestion",
    crefSuggestionIDs
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
  const [parentNodeID] = getItemIDFromView(data, parentPath);

  if (isConcreteRefId(parentNodeID)) {
    return getChildrenForConcreteRef(data, parentPath, parentNodeID);
  }

  return getChildrenForRegularNode(
    data,
    parentPath,
    parentNodeID,
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
      const [, childView] = getItemIDFromView(data, childPath);
      const withChild = result.paths.push(childPath);

      const [childNodeID] = getItemIDFromView(data, childPath);
      const shouldRecurse = options?.isMarkdownExport
        ? !isConcreteRefId(childNodeID)
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
