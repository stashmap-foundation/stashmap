export const LOCAL: SourceId = "local";

const COORDINATE_SOURCE_RE = /^3477[45]:([0-9a-f]{64}):/u;

export function sourceAuthor(sourceId: SourceId): SourceId {
  return sourceId.match(COORDINATE_SOURCE_RE)?.[1] ?? sourceId;
}

export function nodeRefKey(ref: NodeRef): string {
  return JSON.stringify([sourceAuthor(ref.sourceId), ref.id]);
}

export function rowKey(path: string, rowId: string): ID {
  return `${path}#${rowId}`;
}

export function pathOf(id: ID): string {
  const hashIndex = id.indexOf("#");
  return hashIndex < 0 ? id : id.slice(0, hashIndex);
}

export function rowIdOf(id: ID): string {
  const hashIndex = id.indexOf("#");
  return hashIndex < 0 ? id : id.slice(hashIndex + 1);
}
