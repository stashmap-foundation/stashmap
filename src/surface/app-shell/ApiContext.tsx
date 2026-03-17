import React from "react";
import { SimplePool } from "nostr-tools";
// eslint-disable-next-line import/no-unresolved
import { RelayInformation } from "nostr-tools/lib/types/nip11";
import type { LocalStorage } from "./types";
import type { FinalizeEvent } from "../../infra/apiTypes";

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

export type { FinalizeEvent } from "../../infra/apiTypes";

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
