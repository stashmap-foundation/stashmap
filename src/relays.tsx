import { EventTemplate } from "nostr-tools";
import { List, Map } from "immutable";
import { KIND_RELAY_METADATA_EVENT } from "./nostr";
import {
  findAllRelays,
  getMostRecentReplacableEvent,
} from "./commons/useNostrQuery";
import { useUserRelayContext } from "./UserRelayContext";
import { useData } from "./DataContext";
import { useDefaultRelays } from "./NostrAuthContext";

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
    .filter((r) => r !== undefined) as Array<Relay>;
}

export function findRelays(events: List<EventTemplate>): Relays {
  const relaysEvent = getMostRecentReplacableEvent(
    events.filter((e) => e.kind === KIND_RELAY_METADATA_EVENT)
  );
  if (!relaysEvent) {
    return [];
  }
  return findAllRelays(relaysEvent);
}

export function mergeRelays<T extends Relays>(relays: T, relaysToMerge: T): T {
  const combinedRelays = [...relays, ...relaysToMerge];
  const uniqueRelays: T = combinedRelays.reduce(
    (rdx: T, current: Relay | SuggestedRelay) => {
      if (!rdx.some((relay) => relay.url === current.url)) {
        return [...rdx, current] as T;
      }
      return rdx;
    },
    [] as unknown as T
  );
  return uniqueRelays;
}

export function getReadRelays(relays: Array<Relay>): Array<Relay> {
  return relays.filter((r) => r.read === true);
}

export function getWriteRelays(relays: Array<Relay>): Array<Relay> {
  return relays.filter((r) => r.write === true);
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

export function flattenRelays(relays: Map<PublicKey, Relays>): Relays {
  return relays.reduce((acc: Relays, v) => [...acc, ...v], []);
}

function useContactsRelays(): Relays {
  return flattenRelays(useData().contactsRelays);
}

export function useReadRelays({
  defaultRelays,
  user,
  contacts,
}: WriteRelayConf): Relays {
  const { userRelays } = useUserRelayContext();
  return [
    ...getReadRelays([
      ...(defaultRelays ? useDefaultRelays() : []),
      ...(user ? userRelays : []),
    ]),
    ...getWriteRelays(contacts ? useContactsRelays() : []),
  ];
}

// This can be called while contacts is not loaded yet
export function usePreloadRelays({
  defaultRelays,
  user,
}: Omit<WriteRelayConf, "contacts">): Relays {
  const def = useDefaultRelays();
  const { userRelays } = useUserRelayContext();
  return getReadRelays([
    ...(defaultRelays ? def : []),
    ...(user ? userRelays : []),
  ]);
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

export function useRelaysToCreatePlan(): AllRelays {
  const defaultRelays = useDefaultRelays();
  const { userRelays } = useUserRelayContext();
  const { contactsRelays } = useData();
  return {
    defaultRelays,
    userRelays,
    contactsRelays: flattenRelays(contactsRelays),
  };
}

export function useRelaysForRelayManagement(): Relays {
  const { userRelays } = useUserRelayContext();
  return userRelays || [];
}
