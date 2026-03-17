import { List, Map } from "immutable";
import { EventTemplate, Filter } from "nostr-tools";
import { KIND_RELAY_METADATA_EVENT } from "./nostrCore";
import { findAllTags, getMostRecentReplacableEvent } from "./nostrEvents";

export function sanitizeRelayUrl(url: string): string | undefined {
  const trimmedUrl = url.trim();
  const noAddWS =
    trimmedUrl.startsWith("wss://") || trimmedUrl.startsWith("ws://");
  const urlWithWS = noAddWS ? trimmedUrl : `wss://${trimmedUrl}`;
  try {
    return new URL(urlWithWS).toString();
  } catch {
    return undefined;
  }
}

export function sanitizeRelays(relays: Array<Relay>): Array<Relay> {
  return relays
    .map((relay) => {
      const sanitizedRelayUrl = sanitizeRelayUrl(relay.url);
      return sanitizedRelayUrl
        ? {
            ...relay,
            url: sanitizedRelayUrl,
          }
        : undefined;
    })
    .filter((relay) => relay !== undefined) as Array<Relay>;
}

export function uniqueRelayUrls(relays: Relays): string[] {
  return [...new Set(sanitizeRelays(relays).map((relay) => relay.url))];
}

export function relaysFromUrls(urls: string[]): Relays {
  const normalized = urls.map((url) => ({
    url,
    read: true,
    write: true,
  }));
  const sanitized = sanitizeRelays(normalized);
  if (sanitized.length !== normalized.length) {
    throw new Error("Invalid relay URL");
  }
  return sanitized;
}

export function findAllRelays(event: EventTemplate): Array<Relay> {
  const relayTags = findAllTags(event, "r");
  if (!relayTags) {
    return [];
  }
  return relayTags
    .filter((tag) => tag.length >= 1)
    .map((tag) => {
      const { length } = tag;
      const url = tag[0];
      if (length === 1) {
        return {
          url,
          read: true,
          write: true,
        };
      }
      const read =
        (length >= 2 && tag[1] === "read") ||
        (length >= 3 && tag[2] === "read");
      const write =
        (length >= 2 && tag[1] === "write") ||
        (length >= 3 && tag[2] === "write");
      return {
        url,
        read,
        write,
      };
    });
}

export function createRelaysQuery(nostrPublicKeys: Array<string>): Filter {
  return {
    kinds: [KIND_RELAY_METADATA_EVENT],
    authors: nostrPublicKeys,
  };
}

export function findRelays(events: List<EventTemplate>): Relays {
  const relaysEvent = getMostRecentReplacableEvent(
    events.filter((event) => event.kind === KIND_RELAY_METADATA_EVENT)
  );
  if (!relaysEvent) {
    return [];
  }
  return findAllRelays(relaysEvent);
}

export function mergeRelays<T extends Relays>(relays: T, relaysToMerge: T): T {
  const combinedRelays = [...relays, ...relaysToMerge];
  const uniqueRelays: T = combinedRelays.reduce(
    (acc: T, current: Relay | SuggestedRelay) => {
      if (!acc.some((relay) => relay.url === current.url)) {
        return [...acc, current] as T;
      }
      return acc;
    },
    [] as unknown as T
  );
  return uniqueRelays;
}

export function getReadRelays(relays: Array<Relay>): Array<Relay> {
  return relays.filter((relay) => relay.read === true);
}

export function getWriteRelays(relays: Array<Relay>): Array<Relay> {
  return relays.filter((relay) => relay.write === true);
}

export function flattenRelays(relays: Map<PublicKey, Relays>): Relays {
  return relays.reduce((acc: Relays, value) => [...acc, ...value], []);
}

export function getSuggestedRelays(
  contactsRelays: Map<PublicKey, Relays>
): Array<SuggestedRelay> {
  const contactsWriteRelays = getWriteRelays(
    sanitizeRelays(Array.from(contactsRelays.values()).flat())
  );
  return contactsWriteRelays
    .reduce((rdx: Map<string, SuggestedRelay>, relay: Relay) => {
      const foundRelay = rdx.find((r) => r.url === relay.url);
      return rdx.set(relay.url, {
        ...relay,
        numberOfContacts: foundRelay ? foundRelay.numberOfContacts + 1 : 1,
      });
    }, Map<string, SuggestedRelay>())
    .valueSeq()
    .toArray();
}

export function getIsNecessaryReadRelays(
  contactsRelays: Map<PublicKey, Relays>
): (relayState: Relays) => Relays {
  return (relayState: Relays) => {
    return contactsRelays.reduce((rdx: Relays, cRelays: Relays): Relays => {
      const cWriteRelays = getWriteRelays(cRelays);
      const relayStateReadRelays = getReadRelays(relayState);
      const isOverlap = relayStateReadRelays.some((relay) =>
        cWriteRelays.some((cRelay) => relay.url === cRelay.url)
      );
      return isOverlap ? rdx : mergeRelays(rdx, cRelays);
    }, [] as Relays);
  };
}

export function applyWriteRelayConfig(
  defaultRelays: Relays,
  userRelays: Relays,
  contactsRelays: Relays,
  config?: WriteRelayConf
): Relays {
  if (!config) {
    return getWriteRelays(userRelays);
  }
  return getWriteRelays([
    ...(config.defaultRelays ? defaultRelays : []),
    ...(config.user ? userRelays : []),
    ...(config.contacts ? contactsRelays : []),
    ...(config.extraRelays ? config.extraRelays : []),
  ]);
}
