import type { PublicKey } from "../../graph/identity";
import type { Pane, Views } from "../../session/types";
import {
  getInitialPanes as getInitialPanesFromRuntime,
  loadPanesFromStorage as loadPanes,
  loadViewsFromStorage as loadViews,
  savePanesToStorage as savePanes,
  saveViewsToStorage as saveViews,
} from "../../infra/storage";

export function loadPanesFromStorage(publicKey: PublicKey): Pane[] | undefined {
  return loadPanes(localStorage, publicKey);
}

export function savePanesToStorage(publicKey: PublicKey, panes: Pane[]): void {
  savePanes(localStorage, publicKey, panes);
}

export function loadViewsFromStorage(publicKey: PublicKey): Views | undefined {
  return loadViews(localStorage, publicKey);
}

export function saveViewsToStorage(publicKey: PublicKey, views: Views): void {
  saveViews(localStorage, publicKey, views);
}

export function getInitialPanes(publicKey: PublicKey): Pane[] {
  return getInitialPanesFromRuntime({
    publicKey,
    pathname: window.location.pathname,
    search: window.location.search,
    historyState: window.history.state as { panes?: Pane[] } | null,
    loadStoredPanes: loadPanesFromStorage,
  });
}
