import React, { useMemo } from "react";
import { Backend, BackendProvider } from "./BackendContext";

export function FilesystemBackendProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const backend: Backend = useMemo(
    () => ({
      subscribe: (_relays, _filters, params) => {
        params.oneose?.();
        return { close: () => undefined };
      },
      publish: (relays, event) => {
        // eslint-disable-next-line no-console
        console.warn(
          "Filesystem publish not yet implemented; dropping event",
          event.kind
        );
        return relays.map(() => Promise.resolve(""));
      },
    }),
    []
  );
  return <BackendProvider backend={backend}>{children}</BackendProvider>;
}
