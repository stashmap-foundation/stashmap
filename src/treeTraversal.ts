import { List, Map, Set as ImmutableSet } from "immutable";
import {
  ViewPath,
  VirtualRowsMap,
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
  virtualRows: VirtualRowsMap;
  firstVirtualKeys: ImmutableSet<string>;
  displayDepths: Map<string, number>;
};

type TreeTraversalOptions = {
  isMarkdownExport?: boolean;
};

const EMPTY_VIRTUAL_ROWS: VirtualRowsMap = Map<string, GraphNode>();
const EMPTY_FIRST_VIRTUAL_KEYS: ImmutableSet<string> = ImmutableSet<string>();
const EMPTY_DISPLAY_DEPTHS: Map<string, number> = Map<string, number>();

function emptyTreeResult(): TreeResult {
  return {
    paths: List<ViewPath>(),
    virtualRows: EMPTY_VIRTUAL_ROWS,
    firstVirtualKeys: EMPTY_FIRST_VIRTUAL_KEYS,
    displayDepths: EMPTY_DISPLAY_DEPTHS,
  };
}

function isNodeKindFilterActive(
  nodeKindFilters: Pane["nodeKindFilters"]
): nodeKindFilters is NodeKind[] {
  return nodeKindFilters !== undefined;
}

function nodeMatchesKindFilters(
  node: GraphNode,
  nodeKindFilters: NodeKind[]
): boolean {
  return !!node.nodeKind && nodeKindFilters.includes(node.nodeKind);
}

function getChildrenForConcreteRef(
  data: Data,
  parentPath: ViewPath,
  parentRowID: ID,
  currentRow?: GraphNode
): TreeResult {
  const refNode = currentRow || getCurrentEdgeForView(data, parentPath);
  const sourceNode =
    refNode && isRefNode(refNode)
      ? resolveNode(data.knowledgeDBs, refNode)
      : getNode(data.knowledgeDBs, parentRowID, data.user.publicKey);
  if (!sourceNode || sourceNode.children.size === 0) {
    return emptyTreeResult();
  }

  return {
    paths: sourceNode.children
      .map((_, i) => addNodeToPathWithNodes(parentPath, sourceNode, i))
      .toList(),
    virtualRows: EMPTY_VIRTUAL_ROWS,
    firstVirtualKeys: EMPTY_FIRST_VIRTUAL_KEYS,
    displayDepths: EMPTY_DISPLAY_DEPTHS,
  };
}

function getSemanticNodeChildren(
  data: Data,
  parentPath: ViewPath,
  nodes: GraphNode,
  activeFilters: NonNullable<Pane["typeFilters"]>,
  nodeKindFilters: NodeKind[]
): List<ViewPath> {
  const descendantMemo = new globalThis.Map<string, boolean>();
  const visiting = new globalThis.Set<string>();

  const getFilteredChildEntries = (
    parent: GraphNode
  ): { childPath: ViewPath; childNode: GraphNode }[] =>
    parent.children
      .map((childID, index) => ({
        childID,
        childNode:
          childID === EMPTY_SEMANTIC_ID
            ? undefined
            : getNode(data.knowledgeDBs, childID, data.user.publicKey),
        index,
      }))
      .filter(
        (
          entry
        ): entry is {
          childID: ID;
          childNode: GraphNode;
          index: number;
        } =>
          !!entry.childNode && itemPassesFilters(entry.childNode, activeFilters)
      )
      .map(({ childNode, index }) => ({
        childNode,
        childPath: addNodeToPathWithNodes(parentPath, parent, index),
      }))
      .toArray();

  const getEntriesForPath = (
    path: ViewPath,
    parent: GraphNode
  ): { childPath: ViewPath; childNode: GraphNode }[] =>
    parent.children
      .map((childID, index) => ({
        childID,
        childNode:
          childID === EMPTY_SEMANTIC_ID
            ? undefined
            : getNode(data.knowledgeDBs, childID, data.user.publicKey),
        index,
      }))
      .filter(
        (
          entry
        ): entry is {
          childID: ID;
          childNode: GraphNode;
          index: number;
        } =>
          !!entry.childNode && itemPassesFilters(entry.childNode, activeFilters)
      )
      .map(({ childNode, index }) => ({
        childNode,
        childPath: addNodeToPathWithNodes(path, parent, index),
      }))
      .toArray();

  const hasMatchingDescendant = (path: ViewPath, node: GraphNode): boolean => {
    const key = viewPathToString(path);
    const cached = descendantMemo.get(key);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(key)) {
      return false;
    }
    visiting.add(key);
    const found = getEntriesForPath(path, node).some(
      ({ childPath, childNode }) =>
        nodeMatchesKindFilters(childNode, nodeKindFilters) ||
        hasMatchingDescendant(childPath, childNode)
    );
    visiting.delete(key);
    descendantMemo.set(key, found);
    return found;
  };

  const collectFromNode = (path: ViewPath, node: GraphNode): ViewPath[] =>
    getEntriesForPath(path, node).flatMap(({ childPath, childNode }) => {
      if (nodeMatchesKindFilters(childNode, nodeKindFilters)) {
        return [childPath];
      }
      return collectFromNode(childPath, childNode);
    });

  return List(
    getFilteredChildEntries(nodes).flatMap(({ childPath, childNode }) => {
      if (nodeMatchesKindFilters(childNode, nodeKindFilters)) {
        return [childPath];
      }
      return hasMatchingDescendant(childPath, childNode)
        ? collectFromNode(childPath, childNode)
        : [];
    })
  );
}

function getChildrenForRegularNode(
  data: Data,
  parentPath: ViewPath,
  parentRowID: ID,
  stack: ID[],
  rootNode: LongID | undefined,
  author: PublicKey,
  typeFilters: Pane["typeFilters"],
  nodeKindFilters: Pane["nodeKindFilters"],
  options?: TreeTraversalOptions
): TreeResult {
  const effectiveAuthor = getEffectiveAuthor(data, parentPath);
  const activeFilters = typeFilters || DEFAULT_TYPE_FILTERS;
  const directNodes = isSearchId(parentRowID as ID)
    ? getNode(data.knowledgeDBs, parentRowID as ID, data.user.publicKey)
    : getNodeForView(data, parentPath, stack);
  const nodes = directNodes;
  const childNodes = nodes
    ? getNodeChildren(data.knowledgeDBs, nodes, data.user.publicKey)
    : List<GraphNode>();
  const nodeSemanticID = nodes
    ? getSemanticID(data.knowledgeDBs, nodes)
    : parentRowID;
  const coordinateSemanticID = nodes ? nodeSemanticID : parentRowID;

  const nodePaths = (() => {
    if (!nodes) {
      return List<ViewPath>();
    }
    if (isNodeKindFilterActive(nodeKindFilters) && !options?.isMarkdownExport) {
      return getSemanticNodeChildren(
        data,
        parentPath,
        nodes,
        activeFilters,
        nodeKindFilters
      );
    }
    return nodes.children
      .map((childID, index) => ({
        childID,
        childNode:
          childID === EMPTY_SEMANTIC_ID
            ? undefined
            : getNode(data.knowledgeDBs, childID, data.user.publicKey),
        index,
      }))
      .filter(({ childID, childNode }) =>
        options?.isMarkdownExport
          ? !!childNode
          : childID === EMPTY_SEMANTIC_ID ||
            (!!childNode && itemPassesFilters(childNode, activeFilters))
      )
      .map(({ index }) => addNodeToPathWithNodes(parentPath, nodes, index))
      .toList();
  })();

  if (options?.isMarkdownExport || isNodeKindFilterActive(nodeKindFilters)) {
    return {
      paths: nodePaths,
      virtualRows: EMPTY_VIRTUAL_ROWS,
      firstVirtualKeys: EMPTY_FIRST_VIRTUAL_KEYS,
      displayDepths: EMPTY_DISPLAY_DEPTHS,
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
  const { suggestions: diffItems, versionMetas } = getAlternativeFooterData(
    data.knowledgeDBs,
    data.semanticIndex,
    visibleAuthors,
    activeFilters,
    nodes,
    isOwnContent,
    data.snapshotNodes
  );

  const createVirtualRow = (rowID: ID, virtualType: VirtualType): GraphNode => {
    const sourceRowNode =
      virtualType === "suggestion"
        ? getNode(data.knowledgeDBs, rowID, data.user.publicKey)
        : undefined;
    const suggestionTargetID = sourceRowNode?.targetID;
    const targetID =
      virtualType === "incoming" || virtualType === "version"
        ? (rowID as LongID)
        : suggestionTargetID;
    const versionMeta =
      virtualType === "version" ? versionMetas.get(rowID as LongID) : undefined;
    return {
      children: List<ID>(),
      id: (targetID || rowID) as ID,
      text: sourceRowNode?.text || "",
      parent: nodeId,
      updated: sourceRowNode?.updated ?? nodes?.updated ?? Date.now(),
      author: sourceRowNode?.author ?? nodes?.author ?? data.user.publicKey,
      root: nodes?.root ?? nodeId,
      relevance: sourceRowNode?.relevance,
      argument: sourceRowNode?.argument,
      virtualType,
      versionMeta,
      ...(targetID
        ? {
            isRef: true,
            isCref: true,
            targetID,
            linkText: sourceRowNode?.linkText,
          }
        : {}),
    };
  };

  const addVirtualRows = (
    acc: { paths: List<ViewPath>; virtualRows: VirtualRowsMap },
    children: List<ID>,
    virtualType: VirtualType
  ): { paths: List<ViewPath>; virtualRows: VirtualRowsMap } =>
    children.reduce((result, rowID) => {
      const virtualRow = createVirtualRow(rowID, virtualType);
      const pathWithNodes = addNodesToLastElement(parentPath, nodeId);
      const path = [...pathWithNodes, virtualRow.id] as ViewPath;
      return {
        paths: result.paths.push(path),
        virtualRows: result.virtualRows.set(viewPathToString(path), virtualRow),
      };
    }, acc);

  const initial = {
    paths: List<ViewPath>(),
    virtualRows: EMPTY_VIRTUAL_ROWS,
  };

  const withIncoming = addVirtualRows(
    initial,
    visibleIncomingCrefs,
    "incoming"
  );
  const withSuggestions = addVirtualRows(withIncoming, diffItems, "suggestion");
  const withVersions = addVirtualRows(
    withSuggestions,
    versionMetas.keySeq().toList() as List<ID>,
    "version"
  );

  const firstVirtualPath = withVersions.paths.first();
  const firstVirtualKeys = firstVirtualPath
    ? EMPTY_FIRST_VIRTUAL_KEYS.add(viewPathToString(firstVirtualPath))
    : EMPTY_FIRST_VIRTUAL_KEYS;

  return {
    paths: nodePaths.concat(withVersions.paths),
    virtualRows: withVersions.virtualRows,
    firstVirtualKeys,
    displayDepths: EMPTY_DISPLAY_DEPTHS,
  };
}

export function getTreeChildren(
  data: Data,
  parentPath: ViewPath,
  stack: ID[],
  rootNode: LongID | undefined,
  author: PublicKey,
  typeFilters: Pane["typeFilters"],
  nodeKindFilters: Pane["nodeKindFilters"],
  options?: TreeTraversalOptions,
  virtualRows: VirtualRowsMap = EMPTY_VIRTUAL_ROWS
): TreeResult {
  const [parentRowID] = getRowIDFromView(data, parentPath);
  const currentEdge =
    virtualRows.get(viewPathToString(parentPath)) ||
    getCurrentEdgeForView(data, parentPath);

  if (isRefNode(currentEdge)) {
    return getChildrenForConcreteRef(
      data,
      parentPath,
      parentRowID,
      currentEdge
    );
  }

  return getChildrenForRegularNode(
    data,
    parentPath,
    parentRowID,
    stack,
    rootNode,
    author,
    typeFilters,
    nodeKindFilters,
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
  nodeKindFilters: Pane["nodeKindFilters"],
  options?: TreeTraversalOptions,
  virtualRows: VirtualRowsMap = EMPTY_VIRTUAL_ROWS,
  displayDepths: Map<string, number> = EMPTY_DISPLAY_DEPTHS
): TreeResult {
  const childResult = getTreeChildren(
    data,
    parentPath,
    stack,
    rootNode,
    author,
    typeFilters,
    nodeKindFilters,
    options,
    virtualRows
  );

  return childResult.paths.reduce(
    (result, childPath) => {
      const [, childView] = getRowIDFromView(data, childPath);
      const withChild = result.paths.push(childPath);
      const nodeKindFilterActive = isNodeKindFilterActive(nodeKindFilters);
      const parentDepth =
        result.displayDepths.get(viewPathToString(parentPath)) ??
        parentPath.length - 1;
      const childKey = viewPathToString(childPath);
      const childDisplayDepth = nodeKindFilterActive
        ? parentDepth + 1
        : childPath.length - 1;
      const withDisplayDepths = result.displayDepths.set(
        childKey,
        childDisplayDepth
      );

      const childEdge =
        result.virtualRows.get(viewPathToString(childPath)) ||
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
          nodeKindFilters,
          options,
          result.virtualRows,
          withDisplayDepths
        );
        return {
          paths: sub.paths,
          virtualRows: result.virtualRows.merge(sub.virtualRows),
          firstVirtualKeys: result.firstVirtualKeys.union(sub.firstVirtualKeys),
          displayDepths: sub.displayDepths,
        };
      }
      return { ...result, paths: withChild, displayDepths: withDisplayDepths };
    },
    {
      paths: ctx,
      virtualRows: childResult.virtualRows,
      firstVirtualKeys: childResult.firstVirtualKeys,
      displayDepths,
    }
  );
}
