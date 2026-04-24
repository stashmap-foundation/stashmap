import React from "react";
import { Event, Filter, SubCloser, SubscribeManyParams } from "nostr-tools";
import { LoadedCliProfile } from "./cli/config";
import type { Document } from "./DocumentStore";
import type { FsEventHandler } from "./core/workspaceWatcher";

export type WorkspaceState = {
  pickFolder: () => Promise<string | null>;
  open: (folder: string) => Promise<void>;
  create: (args: { folder: string; secretKeyInput?: string }) => Promise<void>;
  isInitialised: (folder: string) => Promise<boolean>;
  save: (
    documents: ReadonlyArray<Document>,
    deletedPaths?: ReadonlyArray<string>
  ) => Promise<{ changed_paths: string[]; removed_paths: string[] }>;
  subscribeFsEvents: (handler: FsEventHandler) => () => void;
  profile: LoadedCliProfile | null;
  documents: Document[];
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
