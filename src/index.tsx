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
import { FilesystemBackendProvider } from "./FilesystemBackendProvider";
import { FilesystemIdentityProvider } from "./FilesystemIdentityProvider";
import { NostrAuthContextProvider } from "./NostrAuthContext";
import { NostrBackendProvider } from "./NostrBackendProvider";
import { NostrProvider } from "./NostrProvider";
import { UserRelayContextProvider } from "./UserRelayContext";
import { shouldUseHashRouter } from "./runtimeEnvironment";
import {
  isFilesystemModeActive,
  loadFilesystemWorkspaceBeforeReact,
} from "./filesystemBootstrap";

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

async function bootstrap(): Promise<void> {
  await loadFilesystemWorkspaceBeforeReact();
  const root = document.getElementById("root");
  if (root === null) {
    return;
  }
  const Backend = isFilesystemModeActive()
    ? FilesystemBackendProvider
    : NostrBackendProvider;
  const Identity = isFilesystemModeActive()
    ? FilesystemIdentityProvider
    : (props: { children: React.ReactNode }) => (
        <NostrAuthContextProvider defaultRelayUrls={defaultRelayUrls}>
          {props.children}
        </NostrAuthContextProvider>
      );
  createRoot(root).render(
    <Router>
      <NostrProvider apis={{ fileStore: createFileStore() }}>
        <Backend>
          <Identity>
            <UserRelayContextProvider>
              <App />
            </UserRelayContextProvider>
          </Identity>
        </Backend>
      </NostrProvider>
    </Router>
  );
}

bootstrap();

serviceWorker.unregister();
