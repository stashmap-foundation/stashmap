import { List, Map as ImmutableMap } from "immutable";
import { getChildNodes } from "./connections";
import { ResolvedNode } from "./graphLookup";

export type VersionDiff = {
  readonly node: GraphNode;
  readonly additions: List<GraphNode>;
  readonly deletions: List<GraphNode>;
};

function getSnapshotChildNodes(
  snapshotMap: ImmutableMap<string, GraphNode>,
  node: GraphNode
): List<GraphNode> {
  return node.children.reduce((acc, childID) => {
    const childNode = snapshotMap.get(childID);
    return childNode ? acc.push(childNode) : acc;
  }, List<GraphNode>());
}

function findSnapshotBaseline(
  snapshotNodes: SnapshotNodes,
  currentNode: GraphNode,
  versionNode: GraphNode
): List<GraphNode> | undefined {
  const forkedByVersion = versionNode.basedOn ? versionNode : undefined;
  const forkedNode =
    forkedByVersion || (currentNode.basedOn ? currentNode : undefined);
  const basedOn = forkedNode?.basedOn;
  if (!forkedNode || !basedOn || !forkedNode.snapshotId) {
    return undefined;
  }
  const snapshotMap = snapshotNodes.get(forkedNode.snapshotId);
  if (!snapshotMap) {
    return undefined;
  }
  const snapshotNode = snapshotMap.get(basedOn);
  if (!snapshotNode) {
    return undefined;
  }
  return getSnapshotChildNodes(snapshotMap, snapshotNode);
}

function originKey(node: GraphNode): string {
  return node.basedOn ?? node.id;
}

export function computeVersionDiff(
  snapshotNodes: SnapshotNodes,
  knowledgeDBs: KnowledgeDBs,
  currentNode: GraphNode,
  version: ResolvedNode
): VersionDiff {
  const versionNode = version.node;
  const snapshotChildren = findSnapshotBaseline(
    snapshotNodes,
    currentNode,
    versionNode
  );
  if (!snapshotChildren) {
    return { node: versionNode, additions: List(), deletions: List() };
  }
  const versionChildren = getChildNodes(
    knowledgeDBs,
    versionNode,
    version.ref.sourceId
  );
  const snapshotChildIDs = snapshotChildren.map((c) => c.id).toSet();
  const versionMatchKeys = versionChildren.map(originKey).toSet();
  return {
    node: versionNode,
    additions: versionChildren.filter(
      (child) => !snapshotChildIDs.has(originKey(child))
    ),
    deletions: snapshotChildren.filter(
      (child) => !versionMatchKeys.has(child.id)
    ),
  };
}
