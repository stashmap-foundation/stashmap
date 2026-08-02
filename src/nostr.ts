export const KIND_SETTINGS = 11071;

// Storage is encrypted on the wire: content is {"key": <nip44 to self>,
// "data": <base64 age/scrypt ciphertext>} under a per-document storage key
// (see storageEncryption.ts). 34775 replaces the plaintext 34772 — old
// plaintext storage events are deliberately no longer read (pre-release,
// no migration).
export const KIND_KNOWLEDGE_DOCUMENT = 34775;
// Deposits: published documents, tagged with the entities they are
// published under. Distinct from storage (34772) so the same document can
// be both stored and published without the replaceable events colliding.
export const KIND_KNOWLEDGE_DEPOSIT = 34774;

export const KIND_DELETE = 5;

export const DEFAULT_STORAGE_RELAYS = [
  "wss://nostr.nodesmap.com/",
  "wss://relay.damus.io/",
  "wss://relay.primal.net/",
  "wss://nos.lol/",
  "wss://nostr.mom/",
];

export const DEFAULT_ROOM_RELAYS = [...DEFAULT_STORAGE_RELAYS];

export const CONFIG_RELAYS = [
  "wss://relay.nostr.band/",
  "wss://purplepag.es/",
  "wss://relay.snort.social/",
];

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
