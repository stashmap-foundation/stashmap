// eslint-disable-next-line import/no-extraneous-dependencies
import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import type { IpcChannel } from "../infra/filesystem/electronWorkspaceIpc";
import type { FsEvent } from "../infra/filesystem/workspaceWatcher";

const workspace: IpcChannel = {
  load: () => ipcRenderer.invoke("workspace:load"),
  loadSnapshots: () => ipcRenderer.invoke("workspace:loadSnapshots"),
  pickFolder: () => ipcRenderer.invoke("workspace:pickFolder"),
  open: (folder) => ipcRenderer.invoke("workspace:open", folder),
  create: (args) => ipcRenderer.invoke("workspace:create", args),
  isInitialised: (folder) =>
    ipcRenderer.invoke("workspace:isInitialised", folder),
  save: (documents, deletedPaths) =>
    ipcRenderer.invoke("workspace:save", documents, deletedPaths),
  onFsEvent: (listener) => {
    const wrapped = (_event: IpcRendererEvent, fsEvent: FsEvent): void =>
      listener(fsEvent);
    ipcRenderer.on("workspace:fs-event", wrapped);
    return () => {
      ipcRenderer.removeListener("workspace:fs-event", wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("knowstrDesktop", {
  isElectron: true,
  platform: process.platform,
  workspace,
  fetchText: async (url: string): Promise<string> => {
    const text: unknown = await ipcRenderer.invoke("net:fetch-text", url);
    if (typeof text !== "string") {
      throw new Error("net:fetch-text returned a non-string");
    }
    return text;
  },
});
