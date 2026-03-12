import { updateItemArgument, updateItemRelevance } from "./connections";

export type RelationItemMetadata = {
  relevance?: Relevance;
  argument?: Argument;
};

export function updateRelationItemMetadata(
  relations: Relations,
  relationIndex: number,
  metadata: RelationItemMetadata
): Relations {
  const withRelevance =
    "relevance" in metadata
      ? updateItemRelevance(relations, relationIndex, metadata.relevance)
      : relations;
  return "argument" in metadata
    ? updateItemArgument(withRelevance, relationIndex, metadata.argument)
    : withRelevance;
}
