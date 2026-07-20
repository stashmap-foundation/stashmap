import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AbstractSimplePool, verifyEvent } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { Backend, BackendProvider, WorkspaceState } from "../../BackendContext";
import { LoadedCliProfile } from "../../cli/config";
import type {
  WorkspaceMarkdownFile,
  WorkspaceSnapshotFile,
  WorkspaceWriteRequest,
} from "./workspaceBackend";
import { DEFAULT_RELAYS } from "../../nostr";
import type { FsEventHandler } from "./workspaceWatcher";

export type WorkspaceLoaded = {
  profile: LoadedCliProfile;
  files: WorkspaceMarkdownFile[];
  snapshots?: WorkspaceSnapshotFile[];
  // Hex private key from the profile's nsec file, when present. Publishing
  // signs deposits in the renderer; local work needs no key.
  privateKey?: string;
};

export type WorkspaceIpc = {
  load: () => Promise<WorkspaceLoaded | null>;
  pickFolder: () => Promise<string | null>;
  open: (folder: string) => Promise<void>;
  create: (args: { folder: string; secretKeyInput?: string }) => Promise<void>;
  isInitialised: (folder: string) => Promise<boolean>;
  save: (
    writes: ReadonlyArray<WorkspaceWriteRequest>,
    deletedPaths?: ReadonlyArray<string>
  ) => Promise<{ changed_paths: string[]; removed_paths: string[] }>;
  ready?: () => Promise<void>;
  loadSnapshots: () => Promise<ReadonlyArray<WorkspaceSnapshotFile>>;
  subscribeFsEvents: (handler: FsEventHandler) => () => void;
};

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; data: WorkspaceLoaded | null };

export type RelayPoolLike = {
  subscribe: Backend["subscribe"];
  publish: Backend["publish"];
};

function realRelayPool(): RelayPoolLike {
  const pool = new AbstractSimplePool({ verifyEvent });
  return {
    subscribe: (relayList, filters, params) =>
      pool.subscribeMany(relayList, filters, params),
    publish: (relayList, event) => pool.publish(relayList, event),
  };
}

export function FilesystemBackendProvider({
  ipc,
  pool,
  children,
}: {
  ipc: WorkspaceIpc;
  pool?: RelayPoolLike;
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
      if (data && ipc.ready) {
        ipc.ready().catch(() => undefined);
      }
    });
    return () => controller.abort();
  }, [ipc, version]);

  const refresh = useCallback(() => {
    setState({ status: "loading" });
    setVersion((v) => v + 1);
  }, []);

  const relayPool = useMemo(() => pool ?? realRelayPool(), [pool]);

  const backend: Backend = useMemo(() => {
    const data = state.status === "loaded" ? state.data : null;
    const profile = data?.profile ?? null;
    const files = data?.files ?? [];
    const user = profile
      ? {
          publicKey: profile.pubkey,
          ...(data?.privateKey
            ? { privateKey: hexToBytes(data.privateKey) }
            : {}),
        }
      : undefined;
    const defaultRelays =
      profile && profile.relays.length > 0 ? profile.relays : DEFAULT_RELAYS;
    const workspace: WorkspaceState = {
      profile,
      files,
      snapshots: data?.snapshots ?? [],
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
      save: (writes, deletedPaths) => ipc.save(writes, deletedPaths),
      loadSnapshots: () => ipc.loadSnapshots(),
      subscribeFsEvents: (handler) => ipc.subscribeFsEvents(handler),
    };
    return {
      subscribe: relayPool.subscribe,
      publish: relayPool.publish,
      user,
      defaultRelays,
      workspace,
    };
  }, [state, ipc, refresh, relayPool]);

  if (state.status === "loading") {
    return null;
  }
  return <BackendProvider backend={backend}>{children}</BackendProvider>;
}
