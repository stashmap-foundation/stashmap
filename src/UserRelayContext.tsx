import React, { createContext, useContext } from "react";
import { List } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import {
  createRelaysQuery,
  findAllRelays,
  getMostRecentReplacableEvent,
  useEventQuery,
} from "./commons/useNostrQuery";
import { sanitizeRelays } from "./relays";
import { useDefaultRelays, useUserOrAnon } from "./NostrAuthContext";
import { useApis } from "./Apis";

type UserRelayInfo = {
  userRelays: Relays;
  isRelaysLoaded: boolean;
};

const UserRelayContext = createContext<UserRelayInfo | undefined>(undefined);

function processRelayEvents(
  relaysEvents: List<UnsignedEvent>,
  defaultRelays: Relays
): Relays {
  const newestEvent = getMostRecentReplacableEvent(relaysEvents);
  const myRelays = newestEvent ? findAllRelays(newestEvent) : defaultRelays;
  return sanitizeRelays(myRelays);
}

export function UserRelayContextProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const user = useUserOrAnon();
  const defaultRelays = useDefaultRelays();
  const { relayPool } = useApis();
  const { events: relaysEvents, eose: relaysEose } = useEventQuery(
    relayPool,
    [createRelaysQuery([user.publicKey])],
    { readFromRelays: defaultRelays }
  );
  const userRelays = processRelayEvents(
    relaysEvents.valueSeq().toList(),
    defaultRelays
  );

  return (
    <UserRelayContext.Provider
      value={{
        isRelaysLoaded: relaysEose,
        userRelays,
      }}
    >
      {children}
    </UserRelayContext.Provider>
  );
}

export function useUserRelayContext(): UserRelayInfo {
  const context = useContext(UserRelayContext);
  if (context === undefined) {
    throw new Error(
      "useUserRelayContext must be used within a UserRelayContextProvider"
    );
  }
  return context;
}
