export const KIND_SETTINGS = 11071;

export const KIND_KNOWLEDGE_DOCUMENT = 34770;
export const KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT = 34771;

export const KIND_CONTACTLIST = 3;
export const KIND_DELETE = 5;

export const KIND_RELAY_METADATA_EVENT = 10002;

export function newTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

export function msTag(): string[] {
  return ["ms", String(Date.now())];
}

export function getReplaceableKey(event: {
  kind: number;
  pubkey: string;
  tags: string[][];
}): string | undefined {
  const { kind, pubkey } = event;
  if (kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000)) {
    return `${kind}:${pubkey}`;
  }
  if (kind >= 30000 && kind < 40000) {
    const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
    return `${kind}:${pubkey}:${dTag}`;
  }
  return undefined;
}
