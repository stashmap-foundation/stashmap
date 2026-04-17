import React from "react";
import { Event, Filter, SubCloser, SubscribeManyParams } from "nostr-tools";

export type Backend = {
  subscribe: (
    relays: string[],
    filters: Filter[],
    params: SubscribeManyParams
  ) => SubCloser;
  publish: (relays: string[], event: Event) => Promise<string>[];
};

const BackendContext = React.createContext<Backend | undefined>(undefined);

export function useBackend(): Backend {
  const context = React.useContext(BackendContext);
  if (context === undefined) {
    throw new Error("BackendContext not provided");
  }
  return context;
}

export function BackendProvider({
  backend,
  children,
}: {
  backend: Backend;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <BackendContext.Provider value={backend}>
      {children}
    </BackendContext.Provider>
  );
}
