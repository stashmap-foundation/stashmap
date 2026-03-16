export type NodeItemMetadata = {
  relevance?: Relevance;
  argument?: Argument;
};

export function updateNodeItemMetadata(
  node: GraphNode,
  metadata: NodeItemMetadata
): GraphNode {
  return {
    ...node,
    ...("relevance" in metadata ? { relevance: metadata.relevance } : {}),
    ...("argument" in metadata ? { argument: metadata.argument } : {}),
  };
}
