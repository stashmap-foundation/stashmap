export const KIND_SETTINGS = 11071;

export const KIND_VIEWS = 11074;

// Changed from 34750 to 34760 for new context-aware relations format
export const KIND_KNOWLEDGE_LIST = 34760;
export const KIND_KNOWLEDGE_NODE = 34751;

export const KIND_NIP05 = 0;
export const KIND_CONTACTLIST = 3;
export const KIND_DELETE = 5;

// Same as 3, but also excepts the `votes` tag to be set for each
// contact
// Missing votes tag will be treated as 0
// Votes tag without a contact will be ignored
export const KIND_MEMBERLIST = 34850;

export const KIND_RELAY_METADATA_EVENT = 10002;
export const DEFAULT_RELAYS: Relays = [
  { url: "wss://nostr.nodesmap.com/", read: true, write: true },
  { url: "wss://relay.damus.io/", read: true, write: true },
  { url: "wss://relay.primal.net/", read: true, write: true },
  { url: "wss://nos.lol/", read: true, write: true },
  { url: "wss://nostr.mom/", read: true, write: true },
  { url: "wss://nostr.noones.com/", read: true, write: true },
];

export function newTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}
