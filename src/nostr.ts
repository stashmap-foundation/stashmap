export const KIND_SETTINGS = 11071;

export const KIND_VIEWS = 11074;

export const KIND_KNOWLEDGE_LIST = 34750;
export const KIND_KNOWLEDGE_NODE = 34751;
// TODO: Make this non-editable
export const KIND_PROJECT = 34752;
export const KIND_WORKSPACE = 34753;

// Should this be a DM?
export const KIND_JOIN_PROJECT = 34754;
// Essentially a markdown which is not editable
export const KIND_KNOWLEDGE_NODE_COLLECTION = 2945;

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
  { url: "wss://relay.damus.io/", read: true, write: true },
  { url: "wss://relay.primal.net/", read: true, write: true },
  { url: "wss://nos.lol/", read: true, write: true },
  { url: "wss://relay.nostr.band/", read: true, write: true },
  { url: "wss://nostr.mom/", read: true, write: true },
  { url: "wss://nostr.noones.com/", read: true, write: true },
];

// eslint-disable-next-line functional/no-let
let lastPublished = 0;

export function newTimestamp(): number {
  const ts = Math.floor(Date.now() / 1000);
  const timestamp = ts > lastPublished ? ts : lastPublished + 1;
  lastPublished = timestamp;
  return timestamp;
}
