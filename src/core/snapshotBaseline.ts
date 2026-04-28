import { List, Map as ImmutableMap } from "immutable";
import { getChildNodes, getNode } from "./connections";

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
  knowledgeDBs: KnowledgeDBs,
  currentNode: GraphNode,
  versionNode: GraphNode
): List<GraphNode> | undefined {
  const forkedByVersion = versionNode.basedOn ? versionNode : undefined;
  const forkedNode =
    forkedByVersion || (currentNode.basedOn ? currentNode : undefined);
  if (!forkedNode) {
    return undefined;
  }
  const rootNode = getNode(knowledgeDBs, forkedNode.root, forkedNode.author);
  if (!rootNode?.snapshotDTag) {
    return undefined;
  }
  const snapshotMap = snapshotNodes.get(rootNode.snapshotDTag);
  if (!snapshotMap) {
    return undefined;
  }
  const snapshotNode = snapshotMap.get(forkedNode.basedOn as string);
  if (!snapshotNode) {
    return undefined;
  }
  return getSnapshotChildNodes(snapshotMap, snapshotNode);
}

function originKey(node: GraphNode): string {
  return (node.basedOn ?? node.id) as string;
}

export function computeVersionDiff(
  snapshotNodes: SnapshotNodes,
  knowledgeDBs: KnowledgeDBs,
  currentNode: GraphNode,
  versionNode: GraphNode
): VersionDiff {
  const snapshotChildren = findSnapshotBaseline(
    snapshotNodes,
    knowledgeDBs,
    currentNode,
    versionNode
  );
  if (!snapshotChildren) {
    return { node: versionNode, additions: List(), deletions: List() };
  }
  const versionChildren = getChildNodes(
    knowledgeDBs,
    versionNode,
    versionNode.author
  );
  const snapshotChildIDs = snapshotChildren.map((c) => c.id as string).toSet();
  const versionMatchKeys = versionChildren.map(originKey).toSet();
  return {
    node: versionNode,
    additions: versionChildren.filter(
      (child) => !snapshotChildIDs.has(originKey(child))
    ),
    deletions: snapshotChildren.filter(
      (child) => !versionMatchKeys.has(child.id as string)
    ),
  };
}
