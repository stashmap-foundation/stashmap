import { List, Map } from "immutable";
import { EventTemplate, Filter } from "nostr-tools";
import { KIND_RELAY_METADATA_EVENT } from "./nostr";
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
