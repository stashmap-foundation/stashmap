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
import { NostrAuthContextProvider } from "./NostrAuthContext";
import { NostrProvider } from "./NostrProvider";
import { UserRelayContextProvider } from "./UserRelayContext";
import { shouldUseHashRouter } from "./runtimeEnvironment";

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

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <Router>
      <NostrProvider apis={{ fileStore: createFileStore() }}>
        <NostrAuthContextProvider defaultRelayUrls={defaultRelayUrls}>
          <UserRelayContextProvider>
            <App />
          </UserRelayContextProvider>
        </NostrAuthContextProvider>
      </NostrProvider>
    </Router>
  );
}

serviceWorker.unregister();
