import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import * as serviceWorker from "./serviceWorker";
import "bootstrap/dist/css/bootstrap.min.css";
import "./theme/solarized.scss";
import "./assets/fonts/nostr/css/nostr.css";
import "./Workspace.scss";
import "./App.css";
import { App } from "./App";
import { AuthProvider } from "./AuthProvider";
import { FilesystemBackendProvider } from "./infra/filesystem/FilesystemBackendProvider";
import { FilesystemDataProvider } from "./infra/filesystem/FilesystemDataProvider";
import { NostrBackendProvider } from "./infra/nostr/NostrBackendProvider";
import { NostrDataProvider } from "./infra/nostr/NostrDataProvider";
import { NostrProvider } from "./NostrProvider";
import { UserRelayContextProvider } from "./UserRelayContext";
import {
  isElectronDesktopShell,
  shouldUseHashRouter,
} from "./runtimeEnvironment";
import { electronWorkspaceIpc } from "./infra/filesystem/electronWorkspaceIpc";
import { FilesystemAppRoot } from "./desktop/FilesystemAppRoot";

const defaultRelayUrls = process.env.DEFAULT_RELAYS?.split(",");

function createFileStore(): LocalStorage {
  return {
    setLocalStorage: (key: string, value: string) =>
      window.localStorage.setItem(key, value),
    getLocalStorage: (key: string) => window.localStorage.getItem(key),
    deleteLocalStorage: (key: string) => window.localStorage.removeItem(key),
  };
}

const Router = shouldUseHashRouter() ? HashRouter : BrowserRouter;

function bootstrap(): void {
  const root = document.getElementById("root");
  if (root === null) {
    return;
  }
  if (isElectronDesktopShell()) {
    const ipc = electronWorkspaceIpc();
    createRoot(root).render(
      <Router>
        <NostrProvider apis={{ fileStore: createFileStore() }}>
          <FilesystemBackendProvider ipc={ipc}>
            <AuthProvider>
              <FilesystemAppRoot>
                <FilesystemDataProvider>
                  <App />
                </FilesystemDataProvider>
              </FilesystemAppRoot>
            </AuthProvider>
          </FilesystemBackendProvider>
        </NostrProvider>
      </Router>
    );
    return;
  }
  createRoot(root).render(
    <Router>
      <NostrProvider apis={{ fileStore: createFileStore() }}>
        <NostrBackendProvider defaultRelayUrls={defaultRelayUrls}>
          <AuthProvider>
            <UserRelayContextProvider>
              <NostrDataProvider>
                <App />
              </NostrDataProvider>
            </UserRelayContextProvider>
          </AuthProvider>
        </NostrBackendProvider>
      </NostrProvider>
    </Router>
  );
}

bootstrap();

serviceWorker.unregister();
