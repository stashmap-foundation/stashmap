import { List, Map as ImmutableMap, Set as ImmutableSet } from "immutable";
import { getChildNodes } from "./connections";
import { ResolvedNode } from "./graphLookup";

export type VersionDiff = {
  readonly node: GraphNode;
  readonly additions: List<GraphNode>;
  readonly deletions: List<GraphNode>;
  // true = the edge has no resolvable baseline; additions/deletions are a
  // direct comparison of the two versions and carry no direction — display
  // as ±, never derive suggestions from them.
  readonly direct: boolean;
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

// A version pair is comparable only along a fork edge: the fork and its
// direct original. Skip-generation pairs (A forked to B forked to C: the
// A↔C pair) have no baseline of their own — their story is told hop by hop
// on the intermediate edges — and diffing them against a borrowed baseline
// produces garbage.
export function isForkEdge(a: GraphNode, b: GraphNode): boolean {
  return a.basedOn === b.id || b.basedOn === a.id;
}

// The baseline belongs to exactly one edge: the forked side carries the
// snapshotId, and its basedOn must be the other side of this comparison.
function edgeBaseline(
  snapshotNodes: SnapshotNodes,
  currentNode: GraphNode,
  versionNode: GraphNode
): List<GraphNode> | undefined {
  const forkedSide =
    versionNode.basedOn === currentNode.id && versionNode.snapshotId
      ? versionNode
      : undefined;
  const forkedCurrent =
    currentNode.basedOn === versionNode.id && currentNode.snapshotId
      ? currentNode
      : undefined;
  const forkedNode = forkedSide ?? forkedCurrent;
  if (!forkedNode || !forkedNode.basedOn || !forkedNode.snapshotId) {
    return undefined;
  }
  const snapshotMap = snapshotNodes.get(forkedNode.snapshotId);
  const snapshotNode = snapshotMap?.get(forkedNode.basedOn);
  if (!snapshotMap || !snapshotNode) {
    return undefined;
  }
  return getSnapshotChildNodes(snapshotMap, snapshotNode);
}

// A child may sit in the comparison under its own id or under its origin:
// fork copies match their originals through basedOn, while nodes carrying
// basedOn from an EARLIER fork edge still match themselves by id.
function matchKeys(node: GraphNode): string[] {
  return node.basedOn ? [node.id, node.basedOn] : [node.id];
}

function matchesAny(keys: ImmutableSet<string>, node: GraphNode): boolean {
  return matchKeys(node).some((key) => keys.has(key));
}

export function computeVersionDiff(
  snapshotNodes: SnapshotNodes,
  knowledgeDBs: KnowledgeDBs,
  current: ResolvedNode,
  version: ResolvedNode
): VersionDiff | undefined {
  const currentNode = current.node;
  const versionNode = version.node;
  if (!isForkEdge(currentNode, versionNode)) {
    return undefined;
  }
  const versionChildren = getChildNodes(
    knowledgeDBs,
    versionNode,
    version.ref.sourceId
  );
  const snapshotChildren = edgeBaseline(
    snapshotNodes,
    currentNode,
    versionNode
  );
  if (snapshotChildren) {
    const snapshotChildIDs = snapshotChildren
      .map((c) => c.id)
      .toSet() as ImmutableSet<string>;
    const versionMatchKeys = versionChildren
      .flatMap(matchKeys)
      .toSet() as ImmutableSet<string>;
    return {
      node: versionNode,
      additions: versionChildren.filter(
        (child) => !matchesAny(snapshotChildIDs, child)
      ),
      deletions: snapshotChildren.filter(
        (child) => !versionMatchKeys.has(child.id)
      ),
      direct: false,
    };
  }
  // No baseline resolvable (unrepaired legacy fork, foreign fork without
  // the capability): compare the two versions directly. Silent when they
  // agree — an unchanged fork must not grow version rows.
  const currentChildren = getChildNodes(
    knowledgeDBs,
    currentNode,
    current.ref.sourceId
  );
  const currentKeys = currentChildren
    .flatMap(matchKeys)
    .toSet() as ImmutableSet<string>;
  const versionKeys = versionChildren
    .flatMap(matchKeys)
    .toSet() as ImmutableSet<string>;
  return {
    node: versionNode,
    additions: versionChildren.filter(
      (child) => !matchesAny(currentKeys, child)
    ),
    deletions: currentChildren.filter(
      (child) => !matchesAny(versionKeys, child)
    ),
    direct: true,
  };
}
