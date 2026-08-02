import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AbstractSimplePool, verifyEvent } from "nostr-tools";
import { Map as ImmutableMap } from "immutable";
import { hexToBytes } from "@noble/hashes/utils";
import { Backend, BackendProvider, WorkspaceState } from "../../BackendContext";
import { LoadedCliProfile } from "../../cli/config";
import type {
  WorkspaceMarkdownFile,
  WorkspaceWriteRequest,
} from "./workspaceBackend";
import type { FsEventHandler } from "./workspaceWatcher";
import type { WritePublisher } from "./writeSupport";
import type { WorkspaceConfig } from "../../workspaceConfig";
import { publishEventToRelays } from "../nostr/nostrPublish";

export type WorkspaceLoaded = {
  profile: LoadedCliProfile;
  files: WorkspaceMarkdownFile[];
  // Hex private key from the profile's nsec file, when present. Publishing
  // signs deposits in the renderer; local work needs no key.
  privateKey?: string;
};

export type WorkspaceIpc = {
  load: () => Promise<WorkspaceLoaded | null>;
  pickFolder: () => Promise<string | null>;
  open: (folder: string) => Promise<void>;
  create: (args: { folder: string }) => Promise<void>;
  configure: (config: WorkspaceConfig) => Promise<void>;
  save: (
    writes: ReadonlyArray<WorkspaceWriteRequest>,
    deletedPaths?: ReadonlyArray<string>
  ) => Promise<{ changed_paths: string[]; removed_paths: string[] }>;
  ready?: () => Promise<void>;
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
  publisher,
  children,
}: {
  ipc: WorkspaceIpc;
  pool?: RelayPoolLike;
  publisher?: WritePublisher;
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
  const writePublisher = useMemo<WritePublisher>(
    () =>
      publisher ?? {
        publishEvent: async (relayUrls, event) => {
          try {
            return await publishEventToRelays(
              { publish: relayPool.publish },
              event,
              relayUrls
            );
          } catch (error) {
            return {
              event,
              results: ImmutableMap(
                relayUrls.map((url) => [
                  url,
                  { status: "rejected", reason: String(error) },
                ])
              ),
            };
          }
        },
      },
    [publisher, relayPool]
  );

  const backend: Backend = useMemo(() => {
    const data = state.status === "loaded" ? state.data : null;
    const profile = data?.profile ?? null;
    const files = data?.files ?? [];
    const user = profile?.pubkey
      ? {
          publicKey: profile.pubkey,
          ...(data?.privateKey
            ? { privateKey: hexToBytes(data.privateKey) }
            : {}),
        }
      : undefined;
    const workspaceConfig = profile?.workspaceConfig ?? {
      storageRelays: [],
      roomRelays: [],
    };
    const workspace: WorkspaceState = {
      profile,
      files,
      pickFolder: () => ipc.pickFolder(),
      publisher: writePublisher,
      open: async (folder) => {
        await ipc.open(folder);
        refresh();
      },
      create: async (args) => {
        await ipc.create(args);
        refresh();
      },
      configure: async (config) => {
        await ipc.configure(config);
        refresh();
      },
      save: (writes, deletedPaths) => ipc.save(writes, deletedPaths),
      subscribeFsEvents: (handler) => ipc.subscribeFsEvents(handler),
    };
    return {
      subscribe: relayPool.subscribe,
      publish: relayPool.publish,
      user,
      workspaceConfig,
      workspace,
    };
  }, [state, ipc, refresh, relayPool, writePublisher]);

  if (state.status === "loading") {
    return null;
  }
  return <BackendProvider backend={backend}>{children}</BackendProvider>;
}
