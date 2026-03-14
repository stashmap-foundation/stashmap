import { List, Map, Set as ImmutableSet } from "immutable";
import {
  ViewPath,
  VirtualItemsMap,
  addNodeToPathWithRelations,
  addRelationsToLastElement,
  getRowIDFromView,
  getContext,
  getRelationForView,
  getCurrentEdgeForView,
  getEffectiveAuthor,
  getParentRelation,
  viewPathToString,
} from "./ViewContext";
import {
  EMPTY_SEMANTIC_ID,
  getRelationChildNodes,
  isSearchId,
  getRelations,
  itemPassesFilters,
  getRelationContext,
  getSemanticID,
  resolveNode,
  isRefNode,
} from "./connections";
import { DEFAULT_TYPE_FILTERS } from "./constants";
import { buildOutgoingReference } from "./buildReferenceRow";
import {
  getIncomingCrefsForNode,
  getOccurrencesForNode,
  getSuggestionsForNode,
  getVersionsForRelation,
} from "./semanticProjection";

export type TreeResult = {
  paths: List<ViewPath>;
  virtualItems: VirtualItemsMap;
  firstVirtualKeys: ImmutableSet<string>;
};

export type TreeTraversalOptions = {
  isMarkdownExport?: boolean;
};

const EMPTY_VIRTUAL_ITEMS: VirtualItemsMap = Map<string, GraphNode>();
const EMPTY_FIRST_VIRTUAL_KEYS: ImmutableSet<string> = ImmutableSet<string>();

function getChildrenForConcreteRef(
  data: Data,
  parentPath: ViewPath,
  parentItemID: ID,
  currentItem?: GraphNode
): TreeResult {
  const refNode = currentItem || getCurrentEdgeForView(data, parentPath);
  const sourceRelation =
    refNode && isRefNode(refNode)
      ? resolveNode(data.knowledgeDBs, refNode)
      : getRelations(data.knowledgeDBs, parentItemID, data.user.publicKey);
  if (!sourceRelation || sourceRelation.children.size === 0) {
    return {
      paths: List(),
      virtualItems: EMPTY_VIRTUAL_ITEMS,
      firstVirtualKeys: EMPTY_FIRST_VIRTUAL_KEYS,
    };
  }

  return {
    paths: sourceRelation.children
      .map((_, i) => addNodeToPathWithRelations(parentPath, sourceRelation, i))
      .toList(),
    virtualItems: EMPTY_VIRTUAL_ITEMS,
    firstVirtualKeys: EMPTY_FIRST_VIRTUAL_KEYS,
  };
}

function getChildrenForRegularNode(
  data: Data,
  parentPath: ViewPath,
  parentItemID: ID,
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
  const nodes = directRelations;
  const childNodes = nodes
    ? getRelationChildNodes(data.knowledgeDBs, nodes, data.user.publicKey)
    : List<GraphNode>();
  const relationSemanticID = nodes
    ? getSemanticID(data.knowledgeDBs, nodes)
    : parentItemID;
  const coordinateSemanticID = nodes ? relationSemanticID : parentItemID;
  const coordinateContext = nodes
    ? getRelationContext(data.knowledgeDBs, nodes)
    : context;

  const relationPaths = nodes
    ? nodes.children
        .map((childID, index) => ({
          childID,
          item:
            childID === EMPTY_SEMANTIC_ID
              ? undefined
              : getRelations(data.knowledgeDBs, childID, data.user.publicKey),
          index,
        }))
        .filter(({ childID, item }) =>
          options?.isMarkdownExport
            ? !!item
            : childID === EMPTY_SEMANTIC_ID ||
              (!!item && itemPassesFilters(item, activeFilters))
        )
        .map(({ index }) =>
          addNodeToPathWithRelations(parentPath, nodes, index)
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

  const relationId = nodes?.id || ("" as LongID);

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
    data.semanticIndex,
    visibleAuthors,
    coordinateSemanticID,
    containingRelationID,
    nodes?.id,
    author,
    childNodes
  );

  const visibleIncomingCrefs = activeFilters.includes("incoming")
    ? incomingCrefs
    : List<LongID>();
  const occurrences = activeFilters.includes("occurrence")
    ? getOccurrencesForNode(
        data.knowledgeDBs,
        data.semanticIndex,
        visibleAuthors,
        coordinateSemanticID,
        nodes?.id,
        effectiveAuthor,
        coordinateContext,
        nodes?.root ?? currentRoot,
        childNodes,
        incomingCrefs
      )
    : List<ID>();
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
        data.semanticIndex,
        visibleAuthors,
        data.user.publicKey,
        coordinateSemanticID,
        activeFilters,
        nodes?.id,
        coordinateContext
      )
    : {
        suggestions: List<ID>(),
        coveredCandidateIDs: ImmutableSet<string>(),
      };

  const createVirtualItem = (
    itemID: ID,
    virtualType: VirtualType
  ): GraphNode => {
    const resolvedItem =
      virtualType === "suggestion"
        ? getRelations(data.knowledgeDBs, itemID, data.user.publicKey)
        : undefined;
    const suggestionTargetID = resolvedItem?.targetID;
    const targetID =
      virtualType === "incoming" ||
      virtualType === "occurrence" ||
      virtualType === "version"
        ? (itemID as LongID)
        : suggestionTargetID;
    return {
      children: List<ID>(),
      id: (targetID || itemID) as ID,
      text: resolvedItem?.text || "",
      parent: relationId,
      updated: resolvedItem?.updated ?? nodes?.updated ?? Date.now(),
      author: resolvedItem?.author ?? nodes?.author ?? data.user.publicKey,
      root: nodes?.root ?? relationId,
      relevance: resolvedItem?.relevance,
      argument: resolvedItem?.argument,
      virtualType,
      ...(targetID
        ? {
            isRef: true,
            isCref: true,
            targetID,
            linkText: resolvedItem?.linkText,
          }
        : {}),
    };
  };

  const addVirtualItems = (
    acc: { paths: List<ViewPath>; virtualItems: VirtualItemsMap },
    children: List<ID>,
    virtualType: VirtualType
  ): { paths: List<ViewPath>; virtualItems: VirtualItemsMap } =>
    children.reduce((result, itemID) => {
      const virtualItem = createVirtualItem(itemID, virtualType);
      const pathWithRelations = addRelationsToLastElement(
        parentPath,
        relationId
      );
      const path = [...pathWithRelations, virtualItem.id] as ViewPath;
      return {
        paths: result.paths.push(path),
        virtualItems: result.virtualItems.set(
          viewPathToString(path),
          virtualItem
        ),
      };
    }, acc);

  const initial = {
    paths: List<ViewPath>(),
    virtualItems: EMPTY_VIRTUAL_ITEMS,
  };
  const versions = getVersionsForRelation(
    data.knowledgeDBs,
    data.semanticIndex,
    visibleAuthors,
    coordinateSemanticID,
    activeFilters,
    nodes,
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
  options?: TreeTraversalOptions,
  virtualItems: VirtualItemsMap = EMPTY_VIRTUAL_ITEMS
): TreeResult {
  const [parentItemID] = getRowIDFromView(data, parentPath);
  const currentEdge =
    virtualItems.get(viewPathToString(parentPath)) ||
    getCurrentEdgeForView(data, parentPath);

  if (isRefNode(currentEdge)) {
    return getChildrenForConcreteRef(
      data,
      parentPath,
      parentItemID,
      currentEdge
    );
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
  options?: TreeTraversalOptions,
  virtualItems: VirtualItemsMap = EMPTY_VIRTUAL_ITEMS
): TreeResult {
  const childResult = getChildNodes(
    data,
    parentPath,
    stack,
    rootRelation,
    author,
    typeFilters,
    options,
    virtualItems
  );

  return childResult.paths.reduce(
    (result, childPath) => {
      const [, childView] = getRowIDFromView(data, childPath);
      const withChild = result.paths.push(childPath);

      const childEdge =
        result.virtualItems.get(viewPathToString(childPath)) ||
        getCurrentEdgeForView(data, childPath);
      const shouldRecurse = options?.isMarkdownExport
        ? !isRefNode(childEdge)
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
          options,
          result.virtualItems
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
