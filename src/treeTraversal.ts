import { List, Map, Set as ImmutableSet } from "immutable";
import {
  ViewPath,
  VirtualItemsMap,
  addNodeToPathWithNodes,
  addNodesToLastElement,
  getRowIDFromView,
  getNodeForView,
  getCurrentEdgeForView,
  getEffectiveAuthor,
  getParentNode,
  viewPathToString,
} from "./ViewContext";
import {
  EMPTY_SEMANTIC_ID,
  getChildNodes as getNodeChildren,
  isSearchId,
  getNode,
  itemPassesFilters,
  getSemanticID,
  resolveNode,
  isRefNode,
} from "./connections";
import { DEFAULT_TYPE_FILTERS } from "./constants";
import {
  getAlternativeFooterData,
  getIncomingCrefsForNode,
} from "./semanticProjection";

export type TreeResult = {
  paths: List<ViewPath>;
  virtualItems: VirtualItemsMap;
  firstVirtualKeys: ImmutableSet<string>;
};

type TreeTraversalOptions = {
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
  const sourceNode =
    refNode && isRefNode(refNode)
      ? resolveNode(data.knowledgeDBs, refNode)
      : getNode(data.knowledgeDBs, parentItemID, data.user.publicKey);
  if (!sourceNode || sourceNode.children.size === 0) {
    return {
      paths: List(),
      virtualItems: EMPTY_VIRTUAL_ITEMS,
      firstVirtualKeys: EMPTY_FIRST_VIRTUAL_KEYS,
    };
  }

  return {
    paths: sourceNode.children
      .map((_, i) => addNodeToPathWithNodes(parentPath, sourceNode, i))
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
  rootNode: LongID | undefined,
  author: PublicKey,
  typeFilters: Pane["typeFilters"],
  options?: TreeTraversalOptions
): TreeResult {
  const effectiveAuthor = getEffectiveAuthor(data, parentPath);
  const activeFilters = typeFilters || DEFAULT_TYPE_FILTERS;
  const directNodes = isSearchId(parentItemID as ID)
    ? getNode(data.knowledgeDBs, parentItemID as ID, data.user.publicKey)
    : getNodeForView(data, parentPath, stack);
  const nodes = directNodes;
  const childNodes = nodes
    ? getNodeChildren(data.knowledgeDBs, nodes, data.user.publicKey)
    : List<GraphNode>();
  const nodeSemanticID = nodes
    ? getSemanticID(data.knowledgeDBs, nodes)
    : parentItemID;
  const coordinateSemanticID = nodes ? nodeSemanticID : parentItemID;

  const nodePaths = nodes
    ? nodes.children
        .map((childID, index) => ({
          childID,
          item:
            childID === EMPTY_SEMANTIC_ID
              ? undefined
              : getNode(data.knowledgeDBs, childID, data.user.publicKey),
          index,
        }))
        .filter(({ childID, item }) =>
          options?.isMarkdownExport
            ? !!item
            : childID === EMPTY_SEMANTIC_ID ||
              (!!item && itemPassesFilters(item, activeFilters))
        )
        .map(({ index }) => addNodeToPathWithNodes(parentPath, nodes, index))
        .toList()
    : List<ViewPath>();

  if (options?.isMarkdownExport) {
    return {
      paths: nodePaths,
      virtualItems: EMPTY_VIRTUAL_ITEMS,
      firstVirtualKeys: EMPTY_FIRST_VIRTUAL_KEYS,
    };
  }

  const nodeId = nodes?.id || ("" as LongID);

  const containingNodeID = getParentNode(data, parentPath)?.id;
  const visibleAuthors = data.contacts
    .keySeq()
    .toSet()
    .add(data.user.publicKey)
    .add(author)
    .add(effectiveAuthor);

  const incomingCrefs = getIncomingCrefsForNode(
    data.knowledgeDBs,
    data.semanticIndex,
    visibleAuthors,
    coordinateSemanticID,
    containingNodeID,
    nodes?.id,
    author,
    childNodes
  );

  const visibleIncomingCrefs = activeFilters.includes("incoming")
    ? incomingCrefs
    : List<LongID>();

  const isOwnContent = effectiveAuthor === data.user.publicKey;
  const { suggestions: diffItems, versions } = getAlternativeFooterData(
    data.knowledgeDBs,
    data.semanticIndex,
    visibleAuthors,
    activeFilters,
    nodes,
    isOwnContent
  );

  const createVirtualItem = (
    itemID: ID,
    virtualType: VirtualType
  ): GraphNode => {
    const resolvedItem =
      virtualType === "suggestion"
        ? getNode(data.knowledgeDBs, itemID, data.user.publicKey)
        : undefined;
    const suggestionTargetID = resolvedItem?.targetID;
    const targetID =
      virtualType === "incoming" || virtualType === "version"
        ? (itemID as LongID)
        : suggestionTargetID;
    return {
      children: List<ID>(),
      id: (targetID || itemID) as ID,
      text: resolvedItem?.text || "",
      parent: nodeId,
      updated: resolvedItem?.updated ?? nodes?.updated ?? Date.now(),
      author: resolvedItem?.author ?? nodes?.author ?? data.user.publicKey,
      root: nodes?.root ?? nodeId,
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
      const pathWithNodes = addNodesToLastElement(parentPath, nodeId);
      const path = [...pathWithNodes, virtualItem.id] as ViewPath;
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
  const withVersions = addVirtualItems(withSuggestions, versions, "version");

  const firstVirtualPath = withVersions.paths.first();
  const firstVirtualKeys = firstVirtualPath
    ? EMPTY_FIRST_VIRTUAL_KEYS.add(viewPathToString(firstVirtualPath))
    : EMPTY_FIRST_VIRTUAL_KEYS;

  return {
    paths: nodePaths.concat(withVersions.paths),
    virtualItems: withVersions.virtualItems,
    firstVirtualKeys,
  };
}

export function getTreeChildren(
  data: Data,
  parentPath: ViewPath,
  stack: ID[],
  rootNode: LongID | undefined,
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
    rootNode,
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
  rootNode: LongID | undefined,
  author: PublicKey,
  typeFilters: Pane["typeFilters"],
  options?: TreeTraversalOptions,
  virtualItems: VirtualItemsMap = EMPTY_VIRTUAL_ITEMS
): TreeResult {
  const childResult = getTreeChildren(
    data,
    parentPath,
    stack,
    rootNode,
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
          rootNode,
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
