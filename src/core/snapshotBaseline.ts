import { List, Map as ImmutableMap, Set as ImmutableSet } from "immutable";
import { getChildNodes } from "./connections";
import { nodeText } from "./nodeSpans";
import { ResolvedNode } from "./graphLookup";

export type VersionDiff = {
  readonly node: GraphNode;
  readonly additions: List<GraphNode>;
  readonly deletions: List<GraphNode>;
  // The version's text moved since the fork-time baseline (and is not
  // simply equal to the current node's, nor already dismissed): their
  // rename, surfaced as a rename-suggestion row. Symmetric — both sides
  // of the edge see it. Baselined edges only.
  readonly textDrift?: string;
  // The edge baseline the drift was computed against — what a dismissal
  // advances (to a constructed baseline) and where the renamed node lives
  // inside that snapshot.
  readonly baselineSnapshotId?: string;
  readonly baselineNodeId?: string;
  // Direct (unbaselined) mode: the two versions' texts differ. Counts
  // into the ± per the law ("silent when they agree, ±n when they
  // differ") — never shown as text, direction unknown.
  readonly textDiffers?: boolean;
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
):
  | {
      children: List<GraphNode>;
      node: GraphNode;
      textBase: string;
      snapshotId: string;
      baselineNodeId: string;
    }
  | undefined {
  const forkedVersion =
    versionNode.basedOn === currentNode.id ? versionNode : undefined;
  const forkedCurrent =
    currentNode.basedOn === versionNode.id ? currentNode : undefined;
  const forkedNode = forkedVersion ?? forkedCurrent;
  if (!forkedNode || !forkedNode.basedOn) {
    return undefined;
  }
  // A pin is only a pin when it cannot be a fork stamp (the kernel's
  // pinOf applies the same rule): a node with basedOn carries its OWN
  // edge's stamp, which must never be borrowed as the baseline of some
  // other edge — a chained fork is fork and origin at once, and reading
  // its stamp for the wrong edge diffs against the wrong document.
  const pin =
    currentNode.basedOn === undefined ? currentNode.snapshotId : undefined;
  const snapshotId = forkedVersion
    ? pin ?? forkedVersion.snapshotId
    : forkedNode.snapshotId;
  const snapshotMap = snapshotId ? snapshotNodes.get(snapshotId) : undefined;
  const snapshotNode = snapshotMap?.get(forkedNode.basedOn);
  if (!snapshotId || !snapshotMap || !snapshotNode) {
    return undefined;
  }
  // Each endpoint of the edge has its own base text: a dismissal-
  // constructed baseline records the version's endpoint under its own
  // id; historical snapshots carry only the shared origin record.
  const versionRecord = snapshotMap.get(versionNode.id) ?? snapshotNode;
  return {
    children: getSnapshotChildNodes(snapshotMap, snapshotNode),
    node: snapshotNode,
    textBase: nodeText(versionRecord),
    snapshotId,
    baselineNodeId: forkedNode.basedOn,
  };
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
  const baseline = edgeBaseline(snapshotNodes, currentNode, versionNode);
  if (baseline) {
    const snapshotChildren = baseline.children;
    // CP4.1: text drift — the version's text left the edge baseline and
    // differs from mine. Symmetric: fork additions show on the original,
    // so do renames. Dismissal is the baseline's job (never a field): a
    // dismissed rename advances the edge to a CONSTRUCTED baseline (old
    // children + their text), so theirs == baseline here and the drift
    // vanishes — while child diffs keep running against the old children.
    const theirsText = nodeText(versionNode);
    const textDrift =
      theirsText !== baseline.textBase && theirsText !== nodeText(currentNode)
        ? theirsText
        : undefined;
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
      textDrift,
      baselineSnapshotId: baseline.snapshotId,
      baselineNodeId: baseline.baselineNodeId,
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
    textDiffers: nodeText(versionNode) !== nodeText(currentNode),
    direct: true,
  };
}
