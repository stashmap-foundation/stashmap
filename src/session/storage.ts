import {
  jsonToPanes,
  jsonToViews,
  paneToJSON,
  Serializable,
  viewDataToJSON,
} from "./serializer";
import type { Pane, Views } from "./types";
import {
  pathToStack,
  parseNodeRouteUrl,
  parseAuthorFromSearch,
} from "./navigation";
import { defaultPane, generatePaneId } from "./panes";

const UNAUTHENTICATED_USER_PK = "UNAUTHENTICATEDUSERPK" as PublicKey;

function splitID(id: ID): [PublicKey | undefined, string] {
  if (!id) {
    return [undefined, ""];
  }
  const split = id.split("_");
  if (split.length === 1) {
    return [undefined, split[0]];
  }
  return [split[0] as PublicKey, split.slice(1).join(":")];
}

type BrowserStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

type HistoryState = { panes?: Pane[] } | null;

function panesStorageKey(publicKey: PublicKey): string {
  return `stashmap-panes-${publicKey}`;
}

function viewsStorageKey(publicKey: PublicKey): string {
  return `stashmap-views-${publicKey}`;
}

export function loadPanesFromStorage(
  storage: Pick<BrowserStorage, "getItem">,
  publicKey: PublicKey
): Pane[] | undefined {
  try {
    const raw = storage.getItem(panesStorageKey(publicKey));
    if (!raw) {
      return undefined;
    }
    const panes = jsonToPanes({ panes: JSON.parse(raw) as Serializable });
    return panes.length > 0 ? panes : undefined;
  } catch {
    return undefined;
  }
}

export function savePanesToStorage(
  storage: Pick<BrowserStorage, "setItem">,
  publicKey: PublicKey,
  panes: Pane[]
): void {
  if (publicKey === UNAUTHENTICATED_USER_PK) {
    return;
  }
  try {
    storage.setItem(
      panesStorageKey(publicKey),
      JSON.stringify(panes.map((pane) => paneToJSON(pane)))
    );
  } catch {
    // ignore storage errors
  }
}

export function loadViewsFromStorage(
  storage: Pick<BrowserStorage, "getItem">,
  publicKey: PublicKey
): Views | undefined {
  try {
    const raw = storage.getItem(viewsStorageKey(publicKey));
    if (!raw) {
      return undefined;
    }
    return jsonToViews(JSON.parse(raw) as Serializable);
  } catch {
    return undefined;
  }
}

export function saveViewsToStorage(
  storage: Pick<BrowserStorage, "setItem">,
  publicKey: PublicKey,
  views: Views
): void {
  try {
    storage.setItem(
      viewsStorageKey(publicKey),
      JSON.stringify(viewDataToJSON(views, []))
    );
  } catch {
    // ignore storage errors
  }
}

export function getInitialPanes(props: {
  publicKey: PublicKey;
  pathname: string;
  search: string;
  historyState: HistoryState;
  loadStoredPanes: (publicKey: PublicKey) => Pane[] | undefined;
}): Pane[] {
  const { publicKey, pathname, search, historyState, loadStoredPanes } = props;
  const nodeID = parseNodeRouteUrl(pathname);
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
  const urlStack = pathToStack(pathname);
  if (urlStack.length > 0) {
    const urlAuthor = parseAuthorFromSearch(search) || publicKey;
    return [{ id: generatePaneId(), stack: urlStack, author: urlAuthor }];
  }
  if (historyState?.panes && historyState.panes.length > 0) {
    return historyState.panes;
  }
  const stored = loadStoredPanes(publicKey);
  if (stored) {
    return stored;
  }
  return [defaultPane(publicKey)];
}
