import { List, Map } from "immutable";
import { Event, EventTemplate, UnsignedEvent } from "nostr-tools";
import type { PublicKey } from "../graph/identity";

export type Relay = {
  url: string;
  read: boolean;
  write: boolean;
};

export type SuggestedRelay = Relay & {
  numberOfContacts: number;
};

export type Relays = Array<Relay>;

export type SuggestedRelays = Array<SuggestedRelay>;

export type PublishStatus = {
  status: "rejected" | "fulfilled";
  reason?: string;
};

export type PublishResultsOfEvent = {
  event: Event;
  results: Map<string, PublishStatus>;
};

export type PublishResultsEventMap = Map<string, PublishResultsOfEvent>;

export type PublishEvents<T = void> = {
  unsignedEvents: List<UnsignedEvent & T>;
  results: PublishResultsEventMap;
  isLoading: boolean;
};

export type PublishResultsOfRelay = Map<string, Event & PublishStatus>;
export type PublishResultsRelayMap = Map<string, PublishResultsOfRelay>;

export type RepublishEvents = (
  events: List<Event>,
  relayUrl: string
) => Promise<void>;

export type WriteRelayConf = {
  defaultRelays?: boolean;
  user?: boolean;
  contacts?: boolean;
  extraRelays?: Relays;
};

export type EventAttachment = {
  writeRelayConf?: WriteRelayConf;
};

export type AllRelays = {
  defaultRelays: Relays;
  userRelays: Relays;
  contactsRelays: Relays;
};

export type QueueStatus = {
  readonly pendingCount: number;
  readonly flushing: boolean;
  readonly backedOffRelays: ReadonlyArray<{
    readonly url: string;
    readonly retryAfter: number;
  }>;
  readonly succeededPerRelay: ReadonlyArray<{
    readonly url: string;
    readonly count: number;
  }>;
};

export type Nostr = {
  getPublicKey: () => Promise<PublicKey>;
  signEvent: (event: EventTemplate) => Promise<Event>;
};
