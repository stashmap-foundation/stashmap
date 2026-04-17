const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

const devServerUrl = process.env.ELECTRON_START_URL;
const isDev = !!devServerUrl;

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
