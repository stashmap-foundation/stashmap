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
} from "./core/connections";
import {
  getBlockLinkTarget,
  getBlockLinkText,
  isBlockLink,
  linkSpan,
  plainSpans,
} from "./core/nodeSpans";
import { documentKeyOf } from "./core/Document";
import { DEFAULT_TYPE_FILTERS } from "./core/constants";
import {
  getAlternativeFooterData,
  getIncomingCrefsForNode,
} from "./semanticProjection";

export type TreeResult = {
  paths: List<ViewPath>;
  virtualRows: VirtualRowsMap;
  firstVirtualKeys: ImmutableSet<string>;
};

type TreeTraversalOptions = {
  isMarkdownExport?: boolean;
};

const EMPTY_VIRTUAL_ROWS: VirtualRowsMap = Map<string, GraphNode>();
const EMPTY_FIRST_VIRTUAL_KEYS: ImmutableSet<string> = ImmutableSet<string>();

function getChildrenForConcreteRef(
  data: Data,
  parentPath: ViewPath,
  parentRowID: ID,
  currentRow?: GraphNode
): TreeResult {
  const refNode = currentRow || getCurrentEdgeForView(data, parentPath);
  const sourceNode =
    refNode && isBlockLink(refNode)
      ? resolveNode(data.knowledgeDBs, refNode)
      : getNode(data.knowledgeDBs, parentRowID, data.user.publicKey);
  if (!sourceNode || sourceNode.children.size === 0) {
    return {
      paths: List(),
      virtualRows: EMPTY_VIRTUAL_ROWS,
      firstVirtualKeys: EMPTY_FIRST_VIRTUAL_KEYS,
    };
  }

  return {
    paths: sourceNode.children
      .map((_, i) => addNodeToPathWithNodes(parentPath, sourceNode, i))
      .toList(),
    virtualRows: EMPTY_VIRTUAL_ROWS,
    firstVirtualKeys: EMPTY_FIRST_VIRTUAL_KEYS,
  };
}

function getChildrenForRegularNode(
  data: Data,
  parentPath: ViewPath,
  parentRowID: ID,
  stack: ID[],
  rootNode: LongID | undefined,
  author: PublicKey,
  typeFilters: Pane["typeFilters"],
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

  const nodePaths = nodes
    ? nodes.children
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
        .toList()
    : List<ViewPath>();

  if (options?.isMarkdownExport) {
    return {
      paths: nodePaths,
      virtualRows: EMPTY_VIRTUAL_ROWS,
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

  const currentDoc =
    nodes?.docId && nodes.author
      ? data.documents.get(documentKeyOf(nodes.author, nodes.docId))
      : undefined;
  const incomingCrefs = getIncomingCrefsForNode(
    data.knowledgeDBs,
    data.semanticIndex,
    visibleAuthors,
    coordinateSemanticID,
    containingNodeID,
    nodes?.id,
    author,
    childNodes,
    currentDoc?.filePath,
    nodes?.author
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
    const suggestionTargetID = getBlockLinkTarget(sourceRowNode);
    const targetID =
      virtualType === "incoming" || virtualType === "version"
        ? (rowID as LongID)
        : suggestionTargetID;
    const versionMeta =
      virtualType === "version" ? versionMetas.get(rowID as LongID) : undefined;
    return {
      children: List<ID>(),
      id: (targetID || rowID) as ID,
      spans: targetID
        ? [linkSpan(targetID, getBlockLinkText(sourceRowNode) ?? "")]
        : plainSpans(""),
      parent: nodeId,
      updated: sourceRowNode?.updated ?? nodes?.updated ?? Date.now(),
      author: sourceRowNode?.author ?? nodes?.author ?? data.user.publicKey,
      root: nodes?.root ?? nodeId,
      relevance: sourceRowNode?.relevance,
      argument: sourceRowNode?.argument,
      virtualType,
      versionMeta,
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
  virtualRows: VirtualRowsMap = EMPTY_VIRTUAL_ROWS
): TreeResult {
  const [parentRowID] = getRowIDFromView(data, parentPath);
  const currentEdge =
    virtualRows.get(viewPathToString(parentPath)) ||
    getCurrentEdgeForView(data, parentPath);

  if (isBlockLink(currentEdge)) {
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
  virtualRows: VirtualRowsMap = EMPTY_VIRTUAL_ROWS
): TreeResult {
  const childResult = getTreeChildren(
    data,
    parentPath,
    stack,
    rootNode,
    author,
    typeFilters,
    options,
    virtualRows
  );

  return childResult.paths.reduce(
    (result, childPath) => {
      const [, childView] = getRowIDFromView(data, childPath);
      const withChild = result.paths.push(childPath);

      const childEdge =
        result.virtualRows.get(viewPathToString(childPath)) ||
        getCurrentEdgeForView(data, childPath);
      const shouldRecurse = options?.isMarkdownExport
        ? !isBlockLink(childEdge)
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
          result.virtualRows
        );
        return {
          paths: sub.paths,
          virtualRows: result.virtualRows.merge(sub.virtualRows),
          firstVirtualKeys: result.firstVirtualKeys.union(sub.firstVirtualKeys),
        };
      }
      return { ...result, paths: withChild };
    },
    {
      paths: ctx,
      virtualRows: childResult.virtualRows,
      firstVirtualKeys: childResult.firstVirtualKeys,
    }
  );
}
