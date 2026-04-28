import { LoadedCliProfile } from "../../cli/config";
import { WorkspaceIpc, WorkspaceLoaded } from "./FilesystemBackendProvider";
import type { Document } from "../../core/Document";
import type { FsEvent, FsEventHandler } from "./workspaceWatcher";

export type IpcChannel = {
  load: () => Promise<{
    profile: LoadedCliProfile;
    documents: Document[];
  } | null>;
  pickFolder: () => Promise<string | null>;
  open: (folder: string) => Promise<void>;
  create: (args: { folder: string; secretKeyInput?: string }) => Promise<void>;
  isInitialised: (folder: string) => Promise<boolean>;
  save: (
    documents: ReadonlyArray<Document>,
    deletedPaths?: ReadonlyArray<string>
  ) => Promise<{ changed_paths: string[]; removed_paths: string[] }>;
  onFsEvent: (listener: (event: FsEvent) => void) => () => void;
};

function getChannel(): IpcChannel | undefined {
  const desktop = (
    window as unknown as {
      knowstrDesktop?: { workspace?: IpcChannel };
    }
  ).knowstrDesktop;
  return desktop?.workspace;
}

export function electronWorkspaceIpc(): WorkspaceIpc {
  return {
    load: async (): Promise<WorkspaceLoaded | null> => {
      const channel = getChannel();
      if (!channel) {
        return null;
      }
      return channel.load();
    },
    pickFolder: async () => {
      const channel = getChannel();
      if (!channel) {
        return null;
      }
      return channel.pickFolder();
    },
    open: async (folder) => {
      const channel = getChannel();
      if (!channel) {
        throw new Error("Electron workspace bridge not available");
      }
      await channel.open(folder);
    },
    create: async (args) => {
      const channel = getChannel();
      if (!channel) {
        throw new Error("Electron workspace bridge not available");
      }
      await channel.create(args);
    },
    isInitialised: async (folder) => {
      const channel = getChannel();
      if (!channel) {
        return false;
      }
      return channel.isInitialised(folder);
    },
    save: async (documents, deletedPaths) => {
      const channel = getChannel();
      if (!channel) {
        return { changed_paths: [], removed_paths: [] };
      }
      return channel.save(documents, deletedPaths);
    },
    subscribeFsEvents: (handler: FsEventHandler) => {
      const channel = getChannel();
      if (!channel) {
        return () => undefined;
      }
      return channel.onFsEvent(handler);
    },
  };
}
