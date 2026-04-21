import React, { useMemo } from "react";
import { NostrAuthContext } from "./NostrAuthContext";
import { useBackend } from "./BackendContext";

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const backend = useBackend();
  const value = useMemo(
    () => ({
      user: backend.user,
      login: backend.login,
      loginWithExtension: backend.loginWithExtension,
      logout: backend.logout,
      defaultRelays: backend.defaultRelays,
    }),
    [
      backend.user,
      backend.login,
      backend.loginWithExtension,
      backend.logout,
      backend.defaultRelays,
    ]
  );
  return (
    <NostrAuthContext.Provider value={value}>
      {children}
    </NostrAuthContext.Provider>
  );
}
