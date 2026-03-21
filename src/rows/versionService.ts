/* eslint-disable import/no-restricted-paths */
import { List, Map as ImmutableMap } from "immutable";
import type { StoredSnapshotRecord } from "../infra/indexedDB";
import { parseSnapshotNodes } from "../infra/snapshotMaterialization";
import type { PublicKey } from "../graph/identity";
import type {
  Argument,
  GraphNode,
  ID,
  KnowledgeDBs,
  LongID,
  Relevance,
  VersionMeta,
} from "../graph/types";
import { getNodeSemanticID, getSemanticID, shortID } from "../graph/context";
import { getChildNodes, getNode, nodePassesFilters } from "../graph/queries";
import { resolveNode } from "../graph/references";
import type { RowsData } from "./data";
import { getNodeForView } from "./resolveRow";
import {
  getLast,
  getPaneIndex,
  getParentRowPath,
  type RowPath,
} from "./rowPaths";
import { DEFAULT_TYPE_FILTERS } from "./settings";

export type SnapshotKey = {
  readonly author: PublicKey;
  readonly dTag: string;
};

const parsedSnapshotCache = new Map<string, ImmutableMap<string, GraphNode>>();

function snapshotStoreKey(author: PublicKey, dTag: string): string {
  return `${author}:${dTag}`;
}

function effectiveIDs(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode,
  activeFilters: (
    | Relevance
    | Argument
    | "suggestions"
    | "versions"
    | "incoming"
    | "contains"
  )[]
): List<string> {
  return getChildNodes(knowledgeDBs, node, node.author)
    .filter(
      (item) =>
        nodePassesFilters(item, activeFilters) &&
        item.relevance !== "not_relevant"
    )
    .map((item) => getSemanticID(knowledgeDBs, item))
    .toList();
}

function getSnapshotChildNodes(
  snapshotNodes: ImmutableMap<string, GraphNode>,
  node: GraphNode
): List<GraphNode> {
  return node.children.reduce((acc, childID) => {
    const childNode = snapshotNodes.get(shortID(childID));
    return childNode ? acc.push(childNode) : acc;
  }, List<GraphNode>());
}

function getSnapshotSemanticID(
  snapshotNodes: ImmutableMap<string, GraphNode>,
  node: GraphNode
): ID {
  if (node.isRef && node.targetID) {
    const targetNode = snapshotNodes.get(shortID(node.targetID));
    if (targetNode) {
      return getSnapshotSemanticID(snapshotNodes, targetNode);
    }
  }
  return getNodeSemanticID(node);
}

function effectiveSnapshotIDs(
  snapshotNodes: ImmutableMap<string, GraphNode>,
  node: GraphNode,
  activeFilters: (
    | Relevance
    | Argument
    | "suggestions"
    | "versions"
    | "incoming"
    | "contains"
  )[]
): List<string> {
  return getSnapshotChildNodes(snapshotNodes, node)
    .filter(
      (item) =>
        nodePassesFilters(item, activeFilters) &&
        item.relevance !== "not_relevant"
    )
    .map((item) => getSnapshotSemanticID(snapshotNodes, item))
    .toList();
}

function computeNodeDiff(
  knowledgeDBs: KnowledgeDBs,
  versionNode: GraphNode,
  baselineNode: GraphNode | undefined,
  activeFilters: (
    | Relevance
    | Argument
    | "suggestions"
    | "versions"
    | "incoming"
    | "contains"
  )[],
  baselineSnapshotNodes?: ImmutableMap<string, GraphNode>
): { addCount: number; removeCount: number } {
  const versionIDs = effectiveIDs(
    knowledgeDBs,
    versionNode,
    activeFilters
  ).toSet();
  const baselineIDs = baselineNode
    ? (baselineSnapshotNodes
        ? effectiveSnapshotIDs(
            baselineSnapshotNodes,
            baselineNode,
            activeFilters
          )
        : effectiveIDs(knowledgeDBs, baselineNode, activeFilters)
      ).toSet()
    : List<string>().toSet();
  return {
    addCount: versionIDs.filter((id) => !baselineIDs.has(id)).size,
    removeCount: baselineIDs.filter((id) => !versionIDs.has(id)).size,
  };
}

function getParsedSnapshotNodes(
  snapshot: StoredSnapshotRecord
): ImmutableMap<string, GraphNode> {
  const cached = parsedSnapshotCache.get(snapshot.eventId);
  if (cached) {
    return cached;
  }
  const parsed = parseSnapshotNodes(snapshot);
  parsedSnapshotCache.set(snapshot.eventId, parsed);
  return parsed;
}

function findSnapshotBaselineNode(
  versionNode: GraphNode,
  data: RowsData
): {
  baselineNode?: GraphNode;
  snapshotNodes?: ImmutableMap<string, GraphNode>;
  diffStatus?: VersionMeta["diffStatus"];
} {
  if (!versionNode.snapshotDTag) {
    return {};
  }

  const storeKey = snapshotStoreKey(
    versionNode.author,
    versionNode.snapshotDTag
  );
  const snapshot = data.snapshots?.get(storeKey);
  if (!snapshot) {
    const status = data.snapshotStatuses?.get(storeKey);
    return {
      diffStatus: status === "unavailable" ? "unavailable" : "loading",
    };
  }

  const snapshotNodes = getParsedSnapshotNodes(snapshot);
  const baselineNode = snapshotNodes.get(snapshot.sourceRootShortID);

  return baselineNode
    ? { baselineNode, snapshotNodes, diffStatus: "computed" }
    : { diffStatus: "unavailable" };
}

export function getVersionSnapshotKeys(
  knowledgeDBs: KnowledgeDBs,
  versionIDs: List<LongID>,
  myself: PublicKey
): List<SnapshotKey> {
  return versionIDs.reduce((acc, versionID) => {
    const node = resolveNode(
      knowledgeDBs,
      getNode(knowledgeDBs, versionID, myself)
    );
    if (!node?.snapshotDTag) {
      return acc;
    }
    const key = { author: node.author, dTag: node.snapshotDTag };
    return acc.some(
      (existing) => existing.author === key.author && existing.dTag === key.dTag
    )
      ? acc
      : acc.push(key);
  }, List<SnapshotKey>());
}

export function getVersionMeta(
  data: RowsData,
  rowPath: RowPath,
  stack: ID[]
): VersionMeta {
  const refId = getLast(rowPath);
  const versionNode = resolveNode(
    data.knowledgeDBs,
    getNode(data.knowledgeDBs, refId, data.user.publicKey)
  );
  if (!versionNode) {
    return {
      updated: 0,
      addCount: 0,
      removeCount: 0,
      diffStatus: "unavailable",
    };
  }

  const pane = data.panes[getPaneIndex(rowPath)];
  const activeFilters = pane.typeFilters || DEFAULT_TYPE_FILTERS;
  const parentPath = getParentRowPath(rowPath);
  const parentNode = parentPath
    ? getNodeForView(data, parentPath, stack)
    : undefined;

  if (parentNode) {
    const { addCount, removeCount } = computeNodeDiff(
      data.knowledgeDBs,
      versionNode,
      parentNode,
      activeFilters
    );
    return {
      updated: versionNode.updated,
      addCount,
      removeCount,
      snapshotDTag: versionNode.snapshotDTag,
      diffStatus: "computed",
    };
  }

  const snapshotBaseline = findSnapshotBaselineNode(versionNode, data);

  if (snapshotBaseline.diffStatus === "loading") {
    return {
      updated: versionNode.updated,
      addCount: 0,
      removeCount: 0,
      snapshotDTag: versionNode.snapshotDTag,
      diffStatus: "loading",
    };
  }

  if (snapshotBaseline.diffStatus === "computed") {
    const { addCount, removeCount } = computeNodeDiff(
      data.knowledgeDBs,
      versionNode,
      snapshotBaseline.baselineNode,
      activeFilters,
      snapshotBaseline.snapshotNodes
    );
    return {
      updated: versionNode.updated,
      addCount,
      removeCount,
      snapshotDTag: versionNode.snapshotDTag,
      diffStatus: "computed",
    };
  }

  const { addCount, removeCount } = computeNodeDiff(
    data.knowledgeDBs,
    versionNode,
    parentNode,
    activeFilters
  );
  return {
    updated: versionNode.updated,
    addCount,
    removeCount,
    snapshotDTag: versionNode.snapshotDTag,
    diffStatus: snapshotBaseline.diffStatus || "computed",
  };
}
