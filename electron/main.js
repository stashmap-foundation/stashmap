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
const { loadCliProfile } = require("../dist/cli/config");
// eslint-disable-next-line import/no-unresolved
const {
  buildWorkspaceDocumentContent,
  loadWorkspaceAsDocuments,
  saveDocumentsToWorkspace,
} = require("../dist/core/workspaceBackend");
// eslint-disable-next-line import/no-unresolved
const { createWorkspaceProfile } = require("../dist/cli/init");
// eslint-disable-next-line import/no-unresolved
const {
  createRecentWorkspacesStore,
  listMostRecent,
  pickAutoOpenId,
} = require("../dist/electronMain/recentWorkspaces");
// eslint-disable-next-line import/no-unresolved
const { convertInputToPrivateKey } = require("../dist/nostrKey");
const { hexToBytes } = require("@noble/hashes/utils");
// eslint-disable-next-line import/no-unresolved
const { watchWorkspace } = require("../dist/core/workspaceWatcher");
const crypto = require("crypto");

const ECHO_TTL_MS = 2000;

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

const watcherState = {
  watcher: null,
  workspaceDir: null,
  pendingEchoes: new Map(),
  pendingUnlinkEchoes: new Map(),
};

function isOwnEcho(event) {
  const now = Date.now();
  if (event.type === "unlink") {
    const expiresAt = watcherState.pendingUnlinkEchoes.get(event.relativePath);
    if (expiresAt && expiresAt > now) {
      watcherState.pendingUnlinkEchoes.delete(event.relativePath);
      return true;
    }
    return false;
  }
  const pending = watcherState.pendingEchoes.get(event.relativePath);
  if (
    pending &&
    pending.expiresAt > now &&
    pending.hash === hashContent(event.content)
  ) {
    watcherState.pendingEchoes.delete(event.relativePath);
    return true;
  }
  return false;
}

function broadcastFsEvent(event) {
  if (isOwnEcho(event)) return;
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("workspace:fs-event", event);
  });
}

async function stopWatcher() {
  if (!watcherState.watcher) return;
  const pending = watcherState.watcher;
  watcherState.watcher = null;
  watcherState.workspaceDir = null;
  const instance = await pending;
  await instance.close();
}

async function startWatcher(workspaceDir) {
  await stopWatcher();
  watcherState.workspaceDir = workspaceDir;
  watcherState.watcher = watchWorkspace(workspaceDir, broadcastFsEvent);
}

function recordSaveEchoes(documents, deletedPaths) {
  const expiresAt = Date.now() + ECHO_TTL_MS;
  documents.forEach((doc) => {
    if (doc.filePath !== undefined) {
      watcherState.pendingEchoes.set(doc.filePath, {
        hash: hashContent(
          buildWorkspaceDocumentContent(doc.content, doc.docId)
        ),
        expiresAt,
      });
    }
  });
  (deletedPaths || []).forEach((relativePath) => {
    watcherState.pendingUnlinkEchoes.set(relativePath, expiresAt);
  });
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

async function loadProfileAndEvents(profile) {
  const documents = await loadWorkspaceAsDocuments({
    pubkey: profile.pubkey,
    workspaceDir: profile.workspaceDir,
  });
  if (watcherState.workspaceDir !== profile.workspaceDir) {
    await startWatcher(profile.workspaceDir);
  }
  return { profile, documents };
}

function isInitialisedFolder(folder) {
  return fs.existsSync(path.join(folder, ".knowstr", "profile.json"));
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
  if (!entry || !isInitialisedFolder(entry.path)) {
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

async function confirmInitialise(folder) {
  const result = await dialog.showMessageBox({
    type: "question",
    buttons: ["Initialize", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    title: "Initialize Workspace",
    message: `${folder} isn't a workspace yet.`,
    detail: "Initialize it as a new workspace with a freshly generated key?",
  });
  return result.response === 0;
}

async function handleOpenWorkspaceMenuAction() {
  const folder = await pickWorkspaceFolder();
  if (!folder) {
    return;
  }
  if (!isInitialisedFolder(folder)) {
    const ok = await confirmInitialise(folder);
    if (!ok) {
      return;
    }
    createWorkspaceProfile({ workspaceDir: folder });
  }
  recordOpenedWorkspace(folder);
  reloadFocusedWindow();
  buildAndSetMenu();
}

function handleSwitchWorkspaceMenuAction(folder) {
  if (!isInitialisedFolder(folder)) {
    dialog.showErrorBox(
      "Workspace not available",
      `${folder} no longer contains a workspace.`
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
  ipcMain.handle("workspace:load", async () => loadCurrentWorkspace());
  ipcMain.handle("workspace:pickFolder", async () => pickWorkspaceFolder());
  ipcMain.handle("workspace:isInitialised", async (_event, folder) =>
    isInitialisedFolder(folder)
  );
  ipcMain.handle("workspace:open", async (_event, folder) => {
    if (!isInitialisedFolder(folder)) {
      throw new Error(`${folder} is not an initialised workspace`);
    }
    recordOpenedWorkspace(folder);
    buildAndSetMenu();
  });
  ipcMain.handle("workspace:create", async (_event, args) => {
    const { folder, secretKeyInput } = args || {};
    if (!folder) {
      throw new Error("workspace:create requires a folder");
    }
    const secretKey = secretKeyInput
      ? (() => {
          const hex = convertInputToPrivateKey(secretKeyInput);
          if (!hex) {
            throw new Error(
              "Input is not a valid nsec, private key or mnemonic"
            );
          }
          return hexToBytes(hex);
        })()
      : undefined;
    createWorkspaceProfile({ workspaceDir: folder, secretKey });
    recordOpenedWorkspace(folder);
    buildAndSetMenu();
  });
  ipcMain.handle("workspace:save", async (_event, documents, deletedPaths) => {
    const envArgs = envCliProfileArgs();
    const pruned = recentWorkspaces.listAndPrune();
    const autoOpenId = pickAutoOpenId(pruned);
    const autoOpenEntry = autoOpenId ? pruned.workspaces[autoOpenId] : undefined;
    const profile = envArgs
      ? loadCliProfile(envArgs)
      : autoOpenEntry
        ? loadCliProfile({ cwd: autoOpenEntry.path })
        : null;
    if (!profile) {
      throw new Error("workspace:save has no active workspace");
    }
    recordSaveEchoes(documents, deletedPaths);
    return saveDocumentsToWorkspace(
      { pubkey: profile.pubkey, workspaceDir: profile.workspaceDir },
      documents,
      deletedPaths
    );
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
  stopWatcher();
});
