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
const { loadWorkspaceAsEvents } = require("../dist/core/workspaceBackend");
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
  const events = await loadWorkspaceAsEvents({
    pubkey: profile.pubkey,
    workspaceDir: profile.workspaceDir,
  });
  return { profile, events };
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
