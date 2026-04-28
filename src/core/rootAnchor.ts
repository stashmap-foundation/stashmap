import { List } from "immutable";

export function createRootAnchor(
  snapshotContext?: Context,
  sourceNode?: GraphNode,
  snapshotLabels?: string[]
): RootAnchor | undefined {
  const normalizedContext = snapshotContext ?? List<ID>();
  if (normalizedContext.size === 0 && !sourceNode) {
    return undefined;
  }

  return {
    snapshotContext: normalizedContext,
    ...(snapshotLabels?.length ? { snapshotLabels } : {}),
    ...(sourceNode
      ? {
          sourceAuthor: sourceNode.author,
          sourceRootID: sourceNode.root,
          sourceNodeID: sourceNode.id,
          ...(sourceNode.parent
            ? { sourceParentNodeID: sourceNode.parent }
            : {}),
        }
      : {}),
  };
}

export function getRootAnchorContext(node: GraphNode): Context {
  return node.anchor?.snapshotContext ?? List<ID>();
}

export function rootAnchorsEqual(
  left?: RootAnchor,
  right?: RootAnchor
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.snapshotContext.equals(right.snapshotContext) &&
    JSON.stringify(left.snapshotLabels ?? []) ===
      JSON.stringify(right.snapshotLabels ?? []) &&
    left.sourceAuthor === right.sourceAuthor &&
    left.sourceRootID === right.sourceRootID &&
    left.sourceNodeID === right.sourceNodeID &&
    left.sourceParentNodeID === right.sourceParentNodeID
  );
}
