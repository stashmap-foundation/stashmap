export function nodeRefKey(ref: NodeRef): string {
  return JSON.stringify([ref.sourceId, ref.id]);
}
