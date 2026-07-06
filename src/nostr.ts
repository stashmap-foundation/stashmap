export const KIND_SETTINGS = 11071;

// Storage is encrypted on the wire: content is {"key": <nip44 to self>,
// "data": <base64 age/scrypt ciphertext>} under a per-document storage key
// (see storageEncryption.ts). 34775 replaces the plaintext 34772 — old
// plaintext storage events are deliberately no longer read (pre-release,
// no migration).
export const KIND_KNOWLEDGE_DOCUMENT = 34775;
// Snapshots render the fork's SOURCE document — private storage, not
// deposit content — so they are encrypted exactly like storage, under the
// forking document's storage key. The d tag stays the plaintext hash, so
// filesystem and web derive identical ids. 34776 replaces the plaintext
// 34773, retired without migration (pre-release; it was a leak, not a
// format evolution).
export const KIND_KNOWLEDGE_DOCUMENT_SNAPSHOT = 34776;
// Deposits: published documents, tagged with the entities they are
// published under. Distinct from storage (34772) so the same document can
// be both stored and published without the replaceable events colliding.
export const KIND_KNOWLEDGE_DEPOSIT = 34774;

// v0 cheat: every document published under an asset: entity goes to the
// deedsats relay only (per-document override in the publish popover wins).
export const ASSET_ENTITY_RELAY =
  process.env.REACT_APP_ASSET_RELAY ?? "wss://nostr.nodesmap.com/";

export const KIND_DELETE = 5;

export const KIND_RELAY_METADATA_EVENT = 10002;
export const DEFAULT_RELAYS: Relays = [
  { url: "wss://nostr.nodesmap.com/", read: true, write: true },
  { url: "wss://relay.damus.io/", read: true, write: true },
  { url: "wss://relay.primal.net/", read: true, write: true },
  { url: "wss://nos.lol/", read: true, write: true },
  { url: "wss://nostr.mom/", read: true, write: true },
  //  { url: "wss://nostr.noones.com/", read: true, write: true },
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
