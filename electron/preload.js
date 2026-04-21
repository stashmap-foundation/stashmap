const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("knowstrDesktop", {
  isElectron: true,
  platform: process.platform,
  workspace: {
    load: () => ipcRenderer.invoke("workspace:load"),
    pickFolder: () => ipcRenderer.invoke("workspace:pickFolder"),
    open: (folder) => ipcRenderer.invoke("workspace:open", folder),
    create: (args) => ipcRenderer.invoke("workspace:create", args),
    isInitialised: (folder) =>
      ipcRenderer.invoke("workspace:isInitialised", folder),
  },
});
