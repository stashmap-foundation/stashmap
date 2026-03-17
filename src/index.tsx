import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import * as serviceWorker from "./surface/app-shell/serviceWorker";
import "bootstrap/dist/css/bootstrap.min.css";
import "./surface/app-shell/styles/solarized.scss";
import "./surface/app-shell/assets/fonts/nostr/css/nostr.css";
import "./surface/app-shell/styles/Workspace.scss";
import "./surface/app-shell/styles/App.css";
import { App } from "./surface/app-shell/App";
import type { LocalStorage } from "./surface/app-shell/types";
import { NostrAuthContextProvider } from "./surface/app-shell/NostrAuthContext";
import { NostrProvider } from "./surface/app-shell/NostrProvider";
import { UserRelayContextProvider } from "./surface/app-shell/UserRelayContext";

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
