const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  shell,
} = require("electron");
const fs = require("fs");
const path = require("path");
// eslint-disable-next-line import/no-unresolved
const {
  loadCliProfile,
  writeCliWorkspaceConfig,
} = require("../dist/cli/config");
// eslint-disable-next-line import/no-unresolved
const {
  createRecentWorkspacesStore,
  listMostRecent,
  pickAutoOpenId,
} = require("../dist/electronMain/recentWorkspaces");
// eslint-disable-next-line import/no-unresolved
const { convertInputToPrivateKey } = require("../dist/nostrKey");
const { assertFetchableFeedUrl } = require("../dist/core/ical");
// eslint-disable-next-line import/no-unresolved
const {
  createWorkspaceRuntime,
} = require("../dist/infra/filesystem/workspaceRuntime");

const workspaceRuntimeState = {
  runtime: null,
  workspaceDir: null,
};

function sendFsEventToWindows(event) {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("workspace:fs-event", event);
  });
}

async function stopWorkspaceRuntime() {
  if (!workspaceRuntimeState.runtime) return;
  const runtime = workspaceRuntimeState.runtime;
  workspaceRuntimeState.runtime = null;
  workspaceRuntimeState.workspaceDir = null;
  await runtime.dispose();
}

async function getWorkspaceRuntime(workspaceDir) {
  if (
    workspaceRuntimeState.runtime &&
    workspaceRuntimeState.workspaceDir === workspaceDir
  ) {
    return workspaceRuntimeState.runtime;
  }
  await stopWorkspaceRuntime();
  const runtime = createWorkspaceRuntime(workspaceDir);
  runtime.subscribeFsEvents(sendFsEventToWindows);
  workspaceRuntimeState.runtime = runtime;
  workspaceRuntimeState.workspaceDir = workspaceDir;
  return runtime;
}

const devServerUrl = process.env.ELECTRON_START_URL;
const isDev = !!devServerUrl;

function envCliProfileArgs() {
  if (process.env.KNOWSTR_PROFILE) {
    return { configPath: path.resolve(process.env.KNOWSTR_PROFILE) };
  }
  if (process.env.KNOWSTR_WORKSPACE) {
    return { cwd: path.resolve(process.env.KNOWSTR_WORKSPACE) };
  }
  if (process.env.KNOWSTR_HOME) {
    return {};
  }
  return null;
}

const recentWorkspaces = createRecentWorkspacesStore();

function readProfilePrivateKey(profile) {
  if (!profile.nsecFile || !fs.existsSync(profile.nsecFile)) {
    return undefined;
  }
  try {
    const raw = fs.readFileSync(profile.nsecFile, "utf8");
    return convertInputToPrivateKey(raw) || undefined;
  } catch {
    return undefined;
  }
}

async function loadProfileAndEvents(profile) {
  const runtime = await getWorkspaceRuntime(profile.workspaceDir);
  const loaded = await runtime.load();
  return {
    profile: loaded.profile,
    files: loaded.files,
    privateKey: readProfilePrivateKey(loaded.profile),
  };
}

async function loadFromFolder(folder) {
  const profile = loadCliProfile({ cwd: folder });
  return loadProfileAndEvents(profile);
}

async function loadCurrentWorkspace() {
  const envArgs = envCliProfileArgs();
  if (envArgs) {
    return loadProfileAndEvents(loadCliProfile(envArgs));
  }
  const pruned = recentWorkspaces.listAndPrune();
  const id = pickAutoOpenId(pruned);
  if (!id) {
    return null;
  }
  const entry = pruned.workspaces[id];
  if (!entry || !fs.existsSync(entry.path)) {
    return null;
  }
  return loadFromFolder(entry.path);
}

async function pickWorkspaceFolder() {
  const window = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(window, {
    properties: ["openDirectory", "createDirectory"],
    title: "Choose Workspace Folder",
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
}

function recordOpenedWorkspace(folder) {
  const id = recentWorkspaces.addOrTouch(folder);
  recentWorkspaces.markOpen(id);
}

function reloadFocusedWindow() {
  const window = BrowserWindow.getFocusedWindow();
  if (window) {
    window.webContents.reload();
  }
}

async function handleOpenWorkspaceMenuAction() {
  const folder = await pickWorkspaceFolder();
  if (!folder) {
    return;
  }
  recordOpenedWorkspace(folder);
  reloadFocusedWindow();
  buildAndSetMenu();
}

function handleSwitchWorkspaceMenuAction(folder) {
  if (!fs.existsSync(folder)) {
    dialog.showErrorBox(
      "Workspace not available",
      `${folder} no longer exists.`
    );
    buildAndSetMenu();
    return;
  }
  recordOpenedWorkspace(folder);
  reloadFocusedWindow();
  buildAndSetMenu();
}

function buildSwitchSubmenu() {
  const pruned = recentWorkspaces.listAndPrune();
  const entries = listMostRecent(pruned);
  if (entries.length === 0) {
    return [{ label: "No recent workspaces", enabled: false }];
  }
  return entries.map((entry) => ({
    label: entry.path,
    type: "checkbox",
    checked: entry.open === true,
    click: () => handleSwitchWorkspaceMenuAction(entry.path),
  }));
}

function buildAndSetMenu() {
  const fileSubmenu = [
    {
      label: "Open Workspace…",
      accelerator: "CmdOrCtrl+O",
      click: () => {
        handleOpenWorkspaceMenuAction();
      },
    },
    {
      label: "Switch Workspace",
      submenu: buildSwitchSubmenu(),
    },
    { type: "separator" },
    process.platform === "darwin" ? { role: "close" } : { role: "quit" },
  ];

  const template = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: fileSubmenu,
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
      preload: path.join(__dirname, "..", "dist", "electronMain", "preload.js"),
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
  // Calendar feeds fetch in the main process: no CORS in Node, and the
  // renderer never gets network powers beyond this one text fetch. The
  // url and every redirect hop must pass the shared feed-url validation.
  ipcMain.handle("net:fetch-text", async (_event, url) => {
    const MAX_REDIRECTS = 5;
    const MAX_BYTES = 2 * 1024 * 1024;
    let target = String(url).replace(/^webcal:\/\//u, "https://");
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      assertFetchableFeedUrl(target);
      const response = await fetch(new URL(target), {
        signal: AbortSignal.timeout(10000),
        redirect: "manual",
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`status ${response.status}`);
        }
        target = new URL(location, target).toString();
        continue;
      }
      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }
      const body = await response.text();
      if (body.length > MAX_BYTES) {
        throw new Error("feed too large");
      }
      return body;
    }
    throw new Error("too many redirects");
  });
  ipcMain.handle("workspace:load", async () => loadCurrentWorkspace());
  ipcMain.handle("workspace:pickFolder", async () => pickWorkspaceFolder());
  ipcMain.handle("workspace:open", async (_event, folder) => {
    if (!fs.existsSync(folder)) {
      throw new Error(`${folder} does not exist`);
    }
    recordOpenedWorkspace(folder);
    buildAndSetMenu();
  });
  ipcMain.handle("workspace:create", async (_event, args) => {
    const { folder } = args || {};
    if (!folder) {
      throw new Error("workspace:create requires a folder");
    }
    fs.mkdirSync(folder, { recursive: true });
    recordOpenedWorkspace(folder);
    buildAndSetMenu();
  });
  ipcMain.handle("workspace:configure", async (_event, config) => {
    const envArgs = envCliProfileArgs();
    const pruned = recentWorkspaces.listAndPrune();
    const autoOpenId = pickAutoOpenId(pruned);
    const autoOpenEntry = autoOpenId
      ? pruned.workspaces[autoOpenId]
      : undefined;
    const workspaceDir = envArgs
      ? loadCliProfile(envArgs).workspaceDir
      : autoOpenEntry?.path;
    if (!workspaceDir) {
      throw new Error("workspace:configure has no active workspace");
    }
    writeCliWorkspaceConfig(workspaceDir, config);
  });
  ipcMain.handle("workspace:save", async (_event, documents, deletedPaths) => {
    const envArgs = envCliProfileArgs();
    const pruned = recentWorkspaces.listAndPrune();
    const autoOpenId = pickAutoOpenId(pruned);
    const autoOpenEntry = autoOpenId
      ? pruned.workspaces[autoOpenId]
      : undefined;
    const profile = envArgs
      ? loadCliProfile(envArgs)
      : autoOpenEntry
      ? loadCliProfile({ cwd: autoOpenEntry.path })
      : null;
    if (!profile) {
      throw new Error("workspace:save has no active workspace");
    }
    const runtime = await getWorkspaceRuntime(profile.workspaceDir);
    return runtime.save(documents, deletedPaths);
  });

  buildAndSetMenu();
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

app.on("before-quit", () => {
  stopWorkspaceRuntime();
});
