import type { Relays } from "./publishTypes";

export * from "../graph/public";

export const DEFAULT_RELAYS: Relays = [
  { url: "wss://nostr.nodesmap.com/", read: true, write: true },
  { url: "wss://relay.damus.io/", read: true, write: true },
  { url: "wss://relay.primal.net/", read: true, write: true },
  { url: "wss://nos.lol/", read: true, write: true },
  { url: "wss://nostr.mom/", read: true, write: true },
];
