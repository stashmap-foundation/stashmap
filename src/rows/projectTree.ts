import { List, Map, Set as ImmutableSet } from "immutable";
import type { PublicKey } from "../graph/identity";
import type { GraphNode, ID, LongID, VirtualType } from "../graph/types";
import type { RowTypeFilter, RowsData } from "./data";
import type { VirtualRowsMap } from "./types";
import { type RowPath, rowPathToString } from "./rowPaths";
import {
  addNodeToPathWithNodes,
  addNodesToLastElement,
  getCurrentEdgeForView,
  getEffectiveAuthor,
  getNodeForView,
  getParentNode,
  getRowIDFromView,
} from "./resolveRow";
import {
  getChildNodes as getNodeChildren,
  getNode,
  nodePassesFilters,
} from "../graph/queries";
import { EMPTY_SEMANTIC_ID } from "../graph/types";
import { isSearchId } from "../graph/context";
import { resolveNode, isRefNode } from "../graph/references";
import { DEFAULT_TYPE_FILTERS } from "./settings";
import {
  getAlternativeNodeData,
  getIncomingReferenceNodeIds,
} from "./alternativeNodes";
import { getVersionSnapshotKeys, type SnapshotKey } from "./versionService";

export type TreeResult = {
  paths: List<RowPath>;
  virtualRows: VirtualRowsMap;
  firstVirtualKeys: ImmutableSet<string>;
  versionSnapshotKeys: List<SnapshotKey>;
};

type TreeTraversalOptions = {
  isMarkdownExport?: boolean;
};

type RowTypeFilters = RowTypeFilter[] | undefined;

const EMPTY_VIRTUAL_ROWS: VirtualRowsMap = Map<string, GraphNode>();
const EMPTY_FIRST_VIRTUAL_KEYS: ImmutableSet<string> = ImmutableSet<string>();

function getChildrenForConcreteRef(
  data: RowsData,
  parentPath: RowPath,
  parentRowID: ID,
  currentRow?: GraphNode
): TreeResult {
  const refNode = currentRow || getCurrentEdgeForView(data, parentPath);
  const sourceNode =
    refNode && isRefNode(refNode)
      ? resolveNode(data.knowledgeDBs, refNode)
      : getNode(data.knowledgeDBs, parentRowID, data.user.publicKey);
  if (!sourceNode || sourceNode.children.size === 0) {
    return {
      paths: List(),
      virtualRows: EMPTY_VIRTUAL_ROWS,
      firstVirtualKeys: EMPTY_FIRST_VIRTUAL_KEYS,
      versionSnapshotKeys: List<SnapshotKey>(),
    };
  }

  return {
    paths: sourceNode.children
      .map((_, i) => addNodeToPathWithNodes(parentPath, sourceNode, i))
      .toList(),
    virtualRows: EMPTY_VIRTUAL_ROWS,
    firstVirtualKeys: EMPTY_FIRST_VIRTUAL_KEYS,
    versionSnapshotKeys: List<SnapshotKey>(),
  };
}

function getChildrenForRegularNode(
  data: RowsData,
  parentPath: RowPath,
  parentRowID: ID,
  stack: ID[],
  rootNode: LongID | undefined,
  author: PublicKey,
  typeFilters: RowTypeFilters,
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
              (!!childNode && nodePassesFilters(childNode, activeFilters))
        )
        .map(({ index }) => addNodeToPathWithNodes(parentPath, nodes, index))
        .toList()
    : List<RowPath>();

  if (options?.isMarkdownExport) {
    return {
      paths: nodePaths,
      virtualRows: EMPTY_VIRTUAL_ROWS,
      firstVirtualKeys: EMPTY_FIRST_VIRTUAL_KEYS,
      versionSnapshotKeys: List<SnapshotKey>(),
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

  const incomingReferenceNodeIDs = getIncomingReferenceNodeIds(
    data.knowledgeDBs,
    data.semanticIndex,
    visibleAuthors,
    containingNodeID,
    nodes?.id,
    author,
    childNodes
  );

  const visibleIncomingReferenceNodeIDs = activeFilters.includes("incoming")
    ? incomingReferenceNodeIDs
    : List<LongID>();

  const isOwnContent = effectiveAuthor === data.user.publicKey;
  const {
    suggestions: suggestionNodeIDs,
    versions,
    allVersions,
  } = getAlternativeNodeData(
    data.knowledgeDBs,
    data.semanticIndex,
    visibleAuthors,
    activeFilters,
    nodes,
    isOwnContent
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
    acc: { paths: List<RowPath>; virtualRows: VirtualRowsMap },
    children: List<ID>,
    virtualType: VirtualType
  ): { paths: List<RowPath>; virtualRows: VirtualRowsMap } =>
    children.reduce((result, rowID) => {
      const virtualRow = createVirtualRow(rowID, virtualType);
      const pathWithNodes = addNodesToLastElement(parentPath, nodeId);
      const path = [...pathWithNodes, virtualRow.id] as RowPath;
      return {
        paths: result.paths.push(path),
        virtualRows: result.virtualRows.set(rowPathToString(path), virtualRow),
      };
    }, acc);

  const initial = {
    paths: List<RowPath>(),
    virtualRows: EMPTY_VIRTUAL_ROWS,
  };

  const withIncoming = addVirtualRows(
    initial,
    visibleIncomingReferenceNodeIDs,
    "incoming"
  );
  const withSuggestions = addVirtualRows(
    withIncoming,
    suggestionNodeIDs,
    "suggestion"
  );
  const withVersions = addVirtualRows(withSuggestions, versions, "version");

  const firstVirtualPath = withVersions.paths.first();
  const firstVirtualKeys = firstVirtualPath
    ? EMPTY_FIRST_VIRTUAL_KEYS.add(rowPathToString(firstVirtualPath))
    : EMPTY_FIRST_VIRTUAL_KEYS;
  const versionSnapshotKeys = getVersionSnapshotKeys(
    data.knowledgeDBs,
    allVersions,
    data.user.publicKey
  );

  return {
    paths: nodePaths.concat(withVersions.paths),
    virtualRows: withVersions.virtualRows,
    firstVirtualKeys,
    versionSnapshotKeys,
  };
}

export function getTreeChildren(
  data: RowsData,
  parentPath: RowPath,
  stack: ID[],
  rootNode: LongID | undefined,
  author: PublicKey,
  typeFilters: RowTypeFilters,
  options?: TreeTraversalOptions,
  virtualRows: VirtualRowsMap = EMPTY_VIRTUAL_ROWS
): TreeResult {
  const [parentRowID] = getRowIDFromView(data, parentPath);
  const currentEdge =
    virtualRows.get(rowPathToString(parentPath)) ||
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
    options
  );
}

export function getNodesInTree(
  data: RowsData,
  parentPath: RowPath,
  stack: ID[],
  ctx: List<RowPath>,
  rootNode: LongID | undefined,
  author: PublicKey,
  typeFilters: RowTypeFilters,
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
        result.virtualRows.get(rowPathToString(childPath)) ||
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
          result.virtualRows
        );
        return {
          paths: sub.paths,
          virtualRows: result.virtualRows.merge(sub.virtualRows),
          firstVirtualKeys: result.firstVirtualKeys.union(sub.firstVirtualKeys),
          versionSnapshotKeys: result.versionSnapshotKeys.concat(
            sub.versionSnapshotKeys
          ),
        };
      }
      return { ...result, paths: withChild };
    },
    {
      paths: ctx,
      virtualRows: childResult.virtualRows,
      firstVirtualKeys: childResult.firstVirtualKeys,
      versionSnapshotKeys: childResult.versionSnapshotKeys,
    }
  );
}
