import React, { useMemo } from "react";
import { NostrAuthContext } from "./NostrAuthContext";
import { getFilesystemPubkey } from "./filesystemBootstrap";

export function FilesystemIdentityProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const pubkey = getFilesystemPubkey();
  const value = useMemo(
    () => ({
      user: pubkey ? { publicKey: pubkey } : undefined,
      defaultRelays: [] as Relays,
    }),
    [pubkey]
  );
  return (
    <NostrAuthContext.Provider value={value}>
      {children}
    </NostrAuthContext.Provider>
  );
}
