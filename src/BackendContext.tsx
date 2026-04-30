import React from "react";
import { Event, Filter, SubCloser, SubscribeManyParams } from "nostr-tools";
import { LoadedCliProfile } from "./cli/config";
import type { ScannedWorkspaceDocument } from "./infra/filesystem/workspaceScan";
import type { WorkspaceWriteRequest } from "./infra/filesystem/workspaceBackend";
import type { FsEventHandler } from "./infra/filesystem/workspaceWatcher";

export type WorkspaceState = {
  pickFolder: () => Promise<string | null>;
  open: (folder: string) => Promise<void>;
  create: (args: { folder: string; secretKeyInput?: string }) => Promise<void>;
  isInitialised: (folder: string) => Promise<boolean>;
  save: (
    writes: ReadonlyArray<WorkspaceWriteRequest>,
    deletedPaths?: ReadonlyArray<string>
  ) => Promise<{ changed_paths: string[]; removed_paths: string[] }>;
  subscribeFsEvents: (handler: FsEventHandler) => () => void;
  profile: LoadedCliProfile | null;
  documents: ScannedWorkspaceDocument[];
};

export type Backend = {
  subscribe: (
    relays: string[],
    filters: Filter[],
    params: SubscribeManyParams
  ) => SubCloser;
  publish: (relays: string[], event: Event) => Promise<string>[];
  user: User | undefined;
  login?: (privateKey: string) => User;
  loginWithExtension?: (publicKey: PublicKey) => User;
  logout?: () => Promise<void>;
  defaultRelays: Relays;
  workspace?: WorkspaceState;
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
