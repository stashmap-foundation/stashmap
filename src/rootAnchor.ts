import { List } from "immutable";

export function createRootAnchor(
  snapshotContext?: Context,
  sourceRelation?: Relations
): RootAnchor | undefined {
  const normalizedContext = snapshotContext ?? List<ID>();
  if (normalizedContext.size === 0 && !sourceRelation) {
    return undefined;
  }

  return {
    snapshotContext: normalizedContext,
    ...(sourceRelation
      ? {
          sourceAuthor: sourceRelation.author,
          sourceRootID: sourceRelation.root,
          sourceRelationID: sourceRelation.id,
          ...(sourceRelation.parent
            ? { sourceParentRelationID: sourceRelation.parent }
            : {}),
        }
      : {}),
  };
}

export function getRootAnchorContext(relation: Relations): Context {
  return relation.anchor?.snapshotContext ?? List<ID>();
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
    left.sourceAuthor === right.sourceAuthor &&
    left.sourceRootID === right.sourceRootID &&
    left.sourceRelationID === right.sourceRelationID &&
    left.sourceParentRelationID === right.sourceParentRelationID
  );
}
