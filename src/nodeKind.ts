export const NODE_KINDS = [
  "topic",
  "person",
  "source",
  "statement",
  "task",
] as const;

export function parseNodeKind(value: string | undefined): NodeKind | undefined {
  if (!value) {
    return undefined;
  }
  return NODE_KINDS.includes(value as NodeKind)
    ? (value as NodeKind)
    : undefined;
}
