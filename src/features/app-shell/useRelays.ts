import { useDefaultRelays } from "./NostrAuthContext";
import { useUserRelayContext } from "./UserRelayContext";
import { useData } from "../../DataContext";
import { flattenRelays, getReadRelays, getWriteRelays } from "../../relayUtils";

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
