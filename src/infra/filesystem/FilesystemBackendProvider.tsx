import React, { useCallback, useEffect, useMemo, useState } from "react";
import { UnsignedEvent } from "nostr-tools";
import { Backend, BackendProvider, WorkspaceState } from "../../BackendContext";
import { LoadedCliProfile } from "../../cli/config";

export type WorkspaceLoaded = {
  profile: LoadedCliProfile;
  events: UnsignedEvent[];
};

export type WorkspaceIpc = {
  load: () => Promise<WorkspaceLoaded | null>;
  pickFolder: () => Promise<string | null>;
  open: (folder: string) => Promise<void>;
  create: (args: { folder: string; secretKeyInput?: string }) => Promise<void>;
  isInitialised: (folder: string) => Promise<boolean>;
  save: (
    events: ReadonlyArray<UnsignedEvent>
  ) => Promise<{ changed_paths: string[]; removed_paths: string[] }>;
};

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; data: WorkspaceLoaded | null };

export function FilesystemBackendProvider({
  ipc,
  children,
}: {
  ipc: WorkspaceIpc;
  children: React.ReactNode;
}): JSX.Element | null {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    ipc.load().then((data) => {
      if (!controller.signal.aborted) {
        setState({ status: "loaded", data });
      }
    });
    return () => controller.abort();
  }, [ipc, version]);

  const refresh = useCallback(() => {
    setState({ status: "loading" });
    setVersion((v) => v + 1);
  }, []);

  const backend: Backend = useMemo(() => {
    const data = state.status === "loaded" ? state.data : null;
    const profile = data?.profile ?? null;
    const events = data?.events ?? [];
    const user = profile ? { publicKey: profile.pubkey } : undefined;
    const defaultRelays = profile?.relays ?? [];
    const workspace: WorkspaceState = {
      profile,
      events,
      pickFolder: () => ipc.pickFolder(),
      isInitialised: (folder) => ipc.isInitialised(folder),
      open: async (folder) => {
        await ipc.open(folder);
        refresh();
      },
      create: async (args) => {
        await ipc.create(args);
        refresh();
      },
      save: (eventsToWrite) => ipc.save(eventsToWrite),
    };
    return {
      subscribe: (_relays, _filters, params) => {
        params.oneose?.();
        return { close: () => undefined };
      },
      publish: (relayList, event) => {
        // eslint-disable-next-line no-console
        console.warn(
          "Filesystem publish not yet implemented; dropping event",
          event.kind
        );
        return relayList.map(() => Promise.resolve(""));
      },
      user,
      defaultRelays,
      workspace,
    };
  }, [state, ipc, refresh]);

  if (state.status === "loading") {
    return null;
  }
  return <BackendProvider backend={backend}>{children}</BackendProvider>;
}
