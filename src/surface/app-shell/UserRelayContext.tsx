import React, { createContext, useContext } from "react";
import { List } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import type { Relays } from "../../infra/publishTypes";
import { getMostRecentReplacableEvent } from "../../infra/nostrEvents";
import { useEventQuery } from "../shared/useNostrQuery";
import {
  createRelaysQuery,
  findAllRelays,
  sanitizeRelays,
} from "../../infra/relayUtils";
import { useDefaultRelays, useUserOrAnon } from "./NostrAuthContext";
import { useApis } from "./ApiContext";

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
