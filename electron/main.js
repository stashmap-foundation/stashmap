const { app, BrowserWindow, ipcMain, shell } = require("electron");
const os = require("os");
const path = require("path");
// eslint-disable-next-line import/no-unresolved
const { loadCliProfile } = require("../dist/cli/config");
// eslint-disable-next-line import/no-unresolved
const { loadWorkspaceAsEvents } = require("../dist/core/workspaceBackend");

const devServerUrl = process.env.ELECTRON_START_URL;
const isDev = !!devServerUrl;

function resolveCliProfileArgs() {
  if (process.env.KNOWSTR_PROFILE) {
    return { configPath: path.resolve(process.env.KNOWSTR_PROFILE) };
  }
  if (process.env.KNOWSTR_WORKSPACE) {
    return { cwd: path.resolve(process.env.KNOWSTR_WORKSPACE) };
  }
  if (process.env.KNOWSTR_HOME) {
    return {};
  }
  return { cwd: os.homedir() };
}

async function loadWorkspace() {
  const profile = loadCliProfile(resolveCliProfileArgs());
  const events = await loadWorkspaceAsEvents({
    pubkey: profile.pubkey,
    workspaceDir: profile.workspaceDir,
  });
  return {
    pubkey: profile.pubkey,
    workspaceDir: profile.workspaceDir,
    events,
  };
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  const loadTarget = devServerUrl
    ? window.loadURL(devServerUrl)
    : window.loadFile(path.join(__dirname, "..", "build", "index.html"));

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const currentOrigin = window.webContents.getURL();
    const isSameDocumentNavigation =
      currentOrigin === "" ||
      (() => {
        try {
          return new URL(url).origin === new URL(currentOrigin).origin;
        } catch {
          return false;
        }
      })();
    if (!isSameDocumentNavigation) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  loadTarget.then(() => {
    if (isDev) {
      window.webContents.openDevTools({ mode: "detach" });
    }
  });

  return window;
}

app.whenReady().then(() => {
  ipcMain.handle("workspace:load", async () => loadWorkspace());

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
