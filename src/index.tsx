import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import * as serviceWorker from "./features/app-shell/serviceWorker";
import "bootstrap/dist/css/bootstrap.min.css";
import "./features/app-shell/styles/solarized.scss";
import "./features/app-shell/assets/fonts/nostr/css/nostr.css";
import "./features/app-shell/styles/Workspace.scss";
import "./features/app-shell/styles/App.css";
import { App } from "./features/app-shell/App";
import type { LocalStorage } from "./features/app-shell/types";
import { NostrAuthContextProvider } from "./features/app-shell/NostrAuthContext";
import { NostrProvider } from "./features/app-shell/NostrProvider";
import { UserRelayContextProvider } from "./features/app-shell/UserRelayContext";

const defaultRelayUrls = process.env.DEFAULT_RELAYS?.split(",");

function createFileStore(): LocalStorage {
  return {
    setLocalStorage: (key: string, value: string) =>
      window.localStorage.setItem(key, value),
    getLocalStorage: (key: string) => window.localStorage.getItem(key),
    deleteLocalStorage: (key: string) => window.localStorage.removeItem(key),
  };
}

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <BrowserRouter>
      <NostrProvider apis={{ fileStore: createFileStore() }}>
        <NostrAuthContextProvider defaultRelayUrls={defaultRelayUrls}>
          <UserRelayContextProvider>
            <App />
          </UserRelayContextProvider>
        </NostrAuthContextProvider>
      </NostrProvider>
    </BrowserRouter>
  );
}

serviceWorker.unregister();
