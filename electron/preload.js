const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("knowstrDesktop", {
  isElectron: true,
  platform: process.platform,
  workspace: {
    load: () => ipcRenderer.invoke("workspace:load"),
  },
});
