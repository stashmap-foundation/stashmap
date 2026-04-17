import React, { useMemo } from "react";
import { useApis } from "./Apis";
import { Backend, BackendProvider } from "./BackendContext";

export function NostrBackendProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { relayPool } = useApis();
  const backend: Backend = useMemo(
    () => ({
      subscribe: (relays, filters, params) =>
        relayPool.subscribeMany(relays, filters, params),
      publish: (relays, event) => relayPool.publish(relays, event),
    }),
    [relayPool]
  );
  return <BackendProvider backend={backend}>{children}</BackendProvider>;
}
