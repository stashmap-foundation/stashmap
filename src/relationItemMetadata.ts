import { updateItemArgument, updateItemRelevance } from "./connections";

export type RelationItemMetadata = {
  relevance?: Relevance;
  argument?: Argument;
};

export function updateRelationItemMetadata(
  nodes: GraphNode,
  relationIndex: number,
  metadata: RelationItemMetadata
): GraphNode {
  const withRelevance =
    "relevance" in metadata
      ? updateItemRelevance(nodes, relationIndex, metadata.relevance)
      : nodes;
  return "argument" in metadata
    ? updateItemArgument(withRelevance, relationIndex, metadata.argument)
    : withRelevance;
}
