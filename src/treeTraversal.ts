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
  joinID,
} from "./core/connections";
import {
  getBlockFileLinkText,
  getBlockLinkTarget,
  getBlockLinkText,
  isBlockLink,
  linkSpan,
  plainSpans,
} from "./core/nodeSpans";
import type { Document } from "./core/Document";
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

function emptyTreeResult(paths: List<ViewPath> = List<ViewPath>()): TreeResult {
  return {
    paths,
    virtualRows: EMPTY_VIRTUAL_ROWS,
    firstVirtualKeys: EMPTY_FIRST_VIRTUAL_KEYS,
  };
}

type VirtualFooterInput = {
  parentPath: ViewPath;
  parentID?: ID;
  parentAuthor: PublicKey;
  parentRoot: ID;
  parentUpdated: number;
  incomingCrefs: List<LongID>;
  suggestions: List<ID>;
  versionMetas: Map<LongID, VersionMeta>;
};

function createVirtualRow(
  data: Data,
  input: VirtualFooterInput,
  rowID: ID,
  virtualType: VirtualType
): GraphNode {
  const sourceRowNode =
    virtualType === "suggestion"
      ? getNode(data.knowledgeDBs, rowID, data.user.publicKey)
      : undefined;
  const incomingRowNode =
    virtualType === "incoming"
      ? getNode(data.knowledgeDBs, rowID, data.user.publicKey)
      : undefined;
  const suggestionTargetID = getBlockLinkTarget(sourceRowNode);
  const targetID =
    virtualType === "incoming" || virtualType === "version"
      ? (rowID as LongID)
      : suggestionTargetID;
  const versionMeta =
    virtualType === "version"
      ? input.versionMetas.get(rowID as LongID)
      : undefined;
  return {
    children: List<ID>(),
    id: (targetID || rowID) as ID,
    spans: targetID
      ? [
          linkSpan(
            targetID,
            getBlockLinkText(sourceRowNode) ??
              getBlockFileLinkText(incomingRowNode) ??
              ""
          ),
        ]
      : plainSpans(""),
    parent: input.parentID,
    updated:
      sourceRowNode?.updated ?? incomingRowNode?.updated ?? input.parentUpdated,
    author:
      sourceRowNode?.author ?? incomingRowNode?.author ?? input.parentAuthor,
    root: input.parentRoot,
    relevance: sourceRowNode?.relevance ?? incomingRowNode?.relevance,
    argument: sourceRowNode?.argument ?? incomingRowNode?.argument,
    virtualType,
    versionMeta,
  };
}

function appendVirtualFooterRows(
  data: Data,
  input: VirtualFooterInput,
  initial: TreeResult = emptyTreeResult()
): TreeResult {
  const addVirtualRows = (
    acc: { paths: List<ViewPath>; virtualRows: VirtualRowsMap },
    children: List<ID>,
    virtualType: VirtualType
  ): { paths: List<ViewPath>; virtualRows: VirtualRowsMap } =>
    children.reduce((result, rowID) => {
      const virtualRow = createVirtualRow(data, input, rowID, virtualType);
      const path =
        input.parentID === undefined
          ? addNodesToLastElement(input.parentPath, virtualRow.id)
          : ([
              ...addNodesToLastElement(input.parentPath, input.parentID),
              virtualRow.id,
            ] as ViewPath);
      return {
        paths: result.paths.push(path),
        virtualRows: result.virtualRows.set(viewPathToString(path), virtualRow),
      };
    }, acc);

  const withIncoming = addVirtualRows(
    { paths: List<ViewPath>(), virtualRows: initial.virtualRows },
    input.incomingCrefs,
    "incoming"
  );
  const withSuggestions = addVirtualRows(
    withIncoming,
    input.suggestions,
    "suggestion"
  );
  const withVersions = addVirtualRows(
    withSuggestions,
    input.versionMetas.keySeq().toList() as List<ID>,
    "version"
  );

  const firstVirtualPath = withVersions.paths.first();
  return {
    paths: initial.paths.concat(withVersions.paths),
    virtualRows: withVersions.virtualRows,
    firstVirtualKeys: firstVirtualPath
      ? initial.firstVirtualKeys.add(viewPathToString(firstVirtualPath))
      : initial.firstVirtualKeys,
  };
}

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
  rootNode: LongID | undefined,
  author: PublicKey,
  typeFilters: Pane["typeFilters"],
  options?: TreeTraversalOptions
): TreeResult {
  const effectiveAuthor = getEffectiveAuthor(data, parentPath);
  const activeFilters = typeFilters || DEFAULT_TYPE_FILTERS;
  const directNodes = isSearchId(parentRowID as ID)
    ? getNode(data.knowledgeDBs, parentRowID as ID, data.user.publicKey)
    : getNodeForView(data, parentPath);
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

  const incomingCrefs = getIncomingCrefsForNode(
    data.knowledgeDBs,
    data.graphIndex,
    visibleAuthors,
    coordinateSemanticID,
    containingNodeID,
    nodes?.id,
    author,
    childNodes,
    undefined,
    nodes?.author,
    data.documents,
    data.documentByFilePath
  );

  const visibleIncomingCrefs = activeFilters.includes("incoming")
    ? incomingCrefs
    : List<LongID>();

  const isOwnContent = effectiveAuthor === data.user.publicKey;
  const { suggestions: diffItems, versionMetas } = getAlternativeFooterData(
    data.knowledgeDBs,
    data.graphIndex,
    visibleAuthors,
    activeFilters,
    nodes,
    isOwnContent,
    data.snapshotNodes
  );

  const footerResult = appendVirtualFooterRows(data, {
    parentPath,
    parentID: nodeId,
    parentAuthor: nodes?.author ?? data.user.publicKey,
    parentRoot: nodes?.root ?? nodeId,
    parentUpdated: nodes?.updated ?? Date.now(),
    incomingCrefs: visibleIncomingCrefs,
    suggestions: diffItems,
    versionMetas,
  });

  return {
    ...footerResult,
    paths: nodePaths.concat(footerResult.paths),
  };
}

export function getTreeChildren(
  data: Data,
  parentPath: ViewPath,
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
    rootNode,
    author,
    typeFilters,
    options
  );
}

export function getNodesInTree(
  data: Data,
  rootPaths: List<ViewPath>,
  ctx: List<ViewPath>,
  rootNode: LongID | undefined,
  author: PublicKey,
  typeFilters: Pane["typeFilters"],
  options?: TreeTraversalOptions,
  virtualRows: VirtualRowsMap = EMPTY_VIRTUAL_ROWS
): TreeResult {
  return rootPaths.reduce<TreeResult>(
    (result, rootPath) => {
      const [, rootView] = getRowIDFromView(data, rootPath);
      const withRoot = {
        ...result,
        paths: result.paths.push(rootPath),
      };
      const rootEdge =
        result.virtualRows.get(viewPathToString(rootPath)) ||
        getCurrentEdgeForView(data, rootPath);
      const shouldRecurse = options?.isMarkdownExport
        ? !isBlockLink(rootEdge)
        : rootView.expanded;
      if (!shouldRecurse) {
        return withRoot;
      }

      const childResult = getTreeChildren(
        data,
        rootPath,
        rootNode,
        author,
        typeFilters,
        options,
        withRoot.virtualRows
      );
      const sub = getNodesInTree(
        data,
        childResult.paths,
        withRoot.paths,
        rootNode,
        author,
        typeFilters,
        options,
        withRoot.virtualRows.merge(childResult.virtualRows)
      );
      return {
        paths: sub.paths,
        virtualRows: sub.virtualRows,
        firstVirtualKeys: withRoot.firstVirtualKeys
          .union(childResult.firstVirtualKeys)
          .union(sub.firstVirtualKeys),
      };
    },
    {
      paths: ctx,
      virtualRows,
      firstVirtualKeys: EMPTY_FIRST_VIRTUAL_KEYS,
    }
  );
}

export function getNodesInDocument(
  data: Data,
  documentRootPath: ViewPath,
  document: Document,
  typeFilters: Pane["typeFilters"]
): TreeResult {
  const activeFilters = typeFilters || DEFAULT_TYPE_FILTERS;
  const topNodePaths = List(
    document.topNodeShortIds.map((topNodeShortId) =>
      addNodesToLastElement(
        documentRootPath,
        joinID(document.author, topNodeShortId)
      )
    )
  );
  const topNodes = List(
    document.topNodeShortIds
      .map((topNodeShortId) =>
        getNode(
          data.knowledgeDBs,
          joinID(document.author, topNodeShortId),
          document.author
        )
      )
      .filter((node): node is GraphNode => node !== undefined)
  );
  const treeResult = getNodesInTree(
    data,
    topNodePaths,
    List<ViewPath>(),
    undefined,
    document.author,
    activeFilters
  );

  if (!activeFilters.includes("incoming")) {
    return treeResult;
  }

  const visibleAuthors = data.contacts
    .keySeq()
    .toSet()
    .add(data.user.publicKey)
    .add(document.author);
  const incomingCrefs = getIncomingCrefsForNode(
    data.knowledgeDBs,
    data.graphIndex,
    visibleAuthors,
    EMPTY_SEMANTIC_ID,
    undefined,
    undefined,
    document.author,
    topNodes,
    document.filePath,
    document.author,
    data.documents,
    data.documentByFilePath
  );

  return appendVirtualFooterRows(
    data,
    {
      parentPath: documentRootPath,
      parentAuthor: document.author,
      parentRoot: topNodes.first()?.root ?? EMPTY_SEMANTIC_ID,
      parentUpdated: document.updatedMs,
      incomingCrefs,
      suggestions: List<ID>(),
      versionMetas: Map<LongID, VersionMeta>(),
    },
    treeResult
  );
}
