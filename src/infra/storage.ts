import {
  jsonToPanes,
  jsonToViews,
  paneToJSON,
  Serializable,
  viewDataToJSON,
} from "../serializer";
import {
  pathToStack,
  parseNodeRouteUrl,
  parseAuthorFromSearch,
} from "../navigationUrl";
import { splitID } from "../connections";
import { UNAUTHENTICATED_USER_PK } from "../AppState";
import { defaultPane, generatePaneId } from "../session/panes";

function panesStorageKey(publicKey: PublicKey): string {
  return `stashmap-panes-${publicKey}`;
}

function viewsStorageKey(publicKey: PublicKey): string {
  return `stashmap-views-${publicKey}`;
}

export function loadPanesFromStorage(publicKey: PublicKey): Pane[] | undefined {
  try {
    const raw = localStorage.getItem(panesStorageKey(publicKey));
    if (!raw) {
      return undefined;
    }
    const panes = jsonToPanes({ panes: JSON.parse(raw) as Serializable });
    return panes.length > 0 ? panes : undefined;
  } catch {
    return undefined;
  }
}

export function savePanesToStorage(publicKey: PublicKey, panes: Pane[]): void {
  if (publicKey === UNAUTHENTICATED_USER_PK) {
    return;
  }
  try {
    localStorage.setItem(
      panesStorageKey(publicKey),
      JSON.stringify(panes.map((pane) => paneToJSON(pane)))
    );
  } catch {
    // ignore storage errors
  }
}

export function loadViewsFromStorage(publicKey: PublicKey): Views | undefined {
  try {
    const raw = localStorage.getItem(viewsStorageKey(publicKey));
    if (!raw) {
      return undefined;
    }
    return jsonToViews(JSON.parse(raw) as Serializable);
  } catch {
    return undefined;
  }
}

export function saveViewsToStorage(publicKey: PublicKey, views: Views): void {
  try {
    localStorage.setItem(
      viewsStorageKey(publicKey),
      JSON.stringify(viewDataToJSON(views, []))
    );
  } catch {
    // ignore storage errors
  }
}

export function getInitialPanes(publicKey: PublicKey): Pane[] {
  const nodeID = parseNodeRouteUrl(window.location.pathname);
  if (nodeID) {
    const nodeAuthor = splitID(nodeID)[0] || publicKey;
    return [
      {
        id: generatePaneId(),
        stack: [],
        author: nodeAuthor,
        rootNodeId: nodeID,
      },
    ];
  }
  const urlStack = pathToStack(window.location.pathname);
  if (urlStack.length > 0) {
    const urlAuthor =
      parseAuthorFromSearch(window.location.search) || publicKey;
    return [{ id: generatePaneId(), stack: urlStack, author: urlAuthor }];
  }
  const historyState = window.history.state as { panes?: Pane[] } | null;
  if (historyState?.panes && historyState.panes.length > 0) {
    return historyState.panes;
  }
  const stored = loadPanesFromStorage(publicKey);
  if (stored) {
    return stored;
  }
  return [defaultPane(publicKey)];
}
