import React from "react";
import { Event, Filter, SubCloser, SubscribeManyParams } from "nostr-tools";
import { LoadedCliProfile } from "./cli/config";
import type {
  WorkspaceMarkdownFile,
  WorkspaceWriteRequest,
} from "./infra/filesystem/workspaceBackend";
import type { FsEventHandler } from "./infra/filesystem/workspaceWatcher";
import type { WritePublisher } from "./infra/filesystem/writeSupport";
import type { WorkspaceConfig } from "./workspaceConfig";

export type WorkspaceState = {
  pickFolder: () => Promise<string | null>;
  open: (folder: string) => Promise<void>;
  create: (args: { folder: string }) => Promise<void>;
  configure: (config: WorkspaceConfig) => Promise<void>;
  save: (
    writes: ReadonlyArray<WorkspaceWriteRequest>,
    deletedPaths?: ReadonlyArray<string>
  ) => Promise<{ changed_paths: string[]; removed_paths: string[] }>;
  subscribeFsEvents: (handler: FsEventHandler) => () => void;
  publisher: WritePublisher;
  profile: LoadedCliProfile | null;
  files: WorkspaceMarkdownFile[];
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
  workspaceConfig: WorkspaceConfig;
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
