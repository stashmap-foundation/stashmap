import React from "react";
import type { StashmapDB } from "./indexedDB";

const CacheDBContext = React.createContext<StashmapDB | null | undefined>(
  undefined
);

export function CacheDBProvider({
  db,
  children,
}: {
  db: StashmapDB | null | undefined;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <CacheDBContext.Provider value={db}>{children}</CacheDBContext.Provider>
  );
}

export function useCacheDB(): StashmapDB | null | undefined {
  return React.useContext(CacheDBContext);
}
