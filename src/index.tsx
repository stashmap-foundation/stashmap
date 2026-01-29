import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { FocusContextProvider } from "./commons/FocusContextProvider";
import * as serviceWorker from "./serviceWorker";
import "bootstrap/dist/css/bootstrap.min.css";
import "./theme/solarized.scss";
import "./assets/fonts/nostr/css/nostr.css";
import "./editor.css";
import "./Workspace.scss";
import "./App.css";
import "react-quill/dist/quill.bubble.css";
import { App } from "./App";
import { NostrAuthContextProvider } from "./NostrAuthContext";
import { NostrProvider } from "./NostrProvider";
import { UserRelayContextProvider } from "./UserRelayContext";

const defaultRelayUrls = process.env.DEFAULT_RELAYS?.split(",");
const defaultWorkspace = process.env.DEFAULT_WORKSPACE;

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
        <NostrAuthContextProvider
          defaultRelayUrls={defaultRelayUrls}
          defaultWorkspace={
            defaultWorkspace ? (defaultWorkspace as LongID) : undefined
          }
        >
          <UserRelayContextProvider>
            <FocusContextProvider>
              <App />
            </FocusContextProvider>
          </UserRelayContextProvider>
        </NostrAuthContextProvider>
      </NostrProvider>
    </BrowserRouter>
  );
}

serviceWorker.unregister();
