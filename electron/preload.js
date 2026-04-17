const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("knowstrDesktop", {
  isElectron: true,
  platform: process.platform,
});
