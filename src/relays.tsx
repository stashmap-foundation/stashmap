import { Map } from "immutable";
import { useUserRelayContext } from "./UserRelayContext";
import { useData } from "./DataContext";
import { useDefaultRelays } from "./NostrAuthContext";
import {
  flattenRelays,
  getReadRelays,
  getWriteRelays,
  mergeRelays,
  sanitizeRelays,
} from "./relayUtils";

export {
  flattenRelays,
  getReadRelays,
  getWriteRelays,
  mergeRelays,
  sanitizeRelays,
  sanitizeRelayUrl,
  findRelays,
} from "./relayUtils";

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
