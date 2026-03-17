import React from "react";
import { EventTemplate, SimplePool, VerifiedEvent } from "nostr-tools";
// eslint-disable-next-line import/no-unresolved
import { RelayInformation } from "nostr-tools/lib/types/nip11";

export type FinalizeEvent = (
  t: EventTemplate,
  secretKey: Uint8Array
) => VerifiedEvent;

export type Apis = {
  fileStore: LocalStorage;
  relayPool: SimplePool;
  finalizeEvent: FinalizeEvent;
  nip11: {
    fetchRelayInformation: (url: string) => Promise<RelayInformation>;
    searchDebounce: number;
  };
  eventLoadingTimeout: number;
  timeToStorePreLoginEvents: number;
};

const ApiContext = React.createContext<Apis | undefined>(undefined);

export function useApis(): Apis {
  const context = React.useContext(ApiContext);
  if (context === undefined) {
    throw new Error("ApiContext not provided");
  }
  return context;
}

export function ApiProvider({
  children,
  apis,
}: {
  children: React.ReactNode;
  apis: Apis;
}): JSX.Element {
  return <ApiContext.Provider value={apis}>{children}</ApiContext.Provider>;
}
