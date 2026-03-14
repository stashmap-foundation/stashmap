export type RelationItemMetadata = {
  relevance?: Relevance;
  argument?: Argument;
};

export function updateRelationItemMetadata(
  node: GraphNode,
  metadata: RelationItemMetadata
): GraphNode {
  return {
    ...node,
    ...("relevance" in metadata ? { relevance: metadata.relevance } : {}),
    ...("argument" in metadata ? { argument: metadata.argument } : {}),
  };
}
