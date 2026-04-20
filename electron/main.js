const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const devServerUrl = process.env.ELECTRON_START_URL;
const isDev = !!devServerUrl;

function resolveProfilePath() {
  if (process.env.KNOWSTR_PROFILE) {
    return path.resolve(process.env.KNOWSTR_PROFILE);
  }
  if (process.env.KNOWSTR_HOME) {
    return path.join(path.resolve(process.env.KNOWSTR_HOME), "profile.json");
  }
  if (process.env.KNOWSTR_WORKSPACE) {
    return path.join(
      path.resolve(process.env.KNOWSTR_WORKSPACE),
      ".knowstr",
      "profile.json"
    );
  }
  return path.join(os.homedir(), ".knowstr", "profile.json");
}

function readProfile() {
  const profilePath = resolveProfilePath();
  if (!fs.existsSync(profilePath)) {
    throw new Error(
      `Missing Knowstr profile: ${profilePath}. Set KNOWSTR_PROFILE, KNOWSTR_HOME, or KNOWSTR_WORKSPACE to point at your workspace.`
    );
  }
  const raw = fs.readFileSync(profilePath, "utf8");
  const parsed = JSON.parse(raw);
  const agentRoot =
    path.basename(path.dirname(profilePath)) === ".knowstr"
      ? path.dirname(path.dirname(profilePath))
      : path.dirname(profilePath);
  const workspaceDir = parsed.workspace_dir
    ? path.resolve(agentRoot, parsed.workspace_dir)
    : agentRoot;
  return {
    pubkey: parsed.pubkey,
    workspaceDir,
    profilePath,
  };
}

async function loadWorkspace() {
  const profile = readProfile();
  // eslint-disable-next-line global-require, import/no-unresolved
  const { loadWorkspaceAsEvents } = require("../dist/core/workspaceBackend");
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
