import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { List, Map, Set, OrderedSet } from "immutable";
import { UNAUTHENTICATED_USER_PK } from "./NostrAuthContext";
import { splitID } from "./core/connections";
import { generatePaneId } from "./SplitPanesContext";
import {
  jsonToPanes,
  jsonToViews,
  paneToJSON,
  Serializable,
  viewDataToJSON,
} from "./serializer";
import {
  pathToStack,
  parseNodeRouteUrl,
  parseAuthorFromSearch,
} from "./navigationUrl";
import { replaceUnauthenticatedUser } from "./planner";

export const defaultPane = (author: PublicKey, rootItemID?: ID): Pane => ({
  id: generatePaneId(),
  stack: rootItemID ? [rootItemID] : [],
  author,
});

const DEFAULT_TEMPORARY_VIEW: TemporaryViewState = {
  rowFocusIntents: Map<number, RowFocusIntent>(),
  baseSelection: OrderedSet<string>(),
  shiftSelection: OrderedSet<string>(),
  anchor: "",
  editingViews: Set<string>(),
  editorOpenViews: Set<string>(),
  draftTexts: Map<string, string>(),
};

function panesStorageKey(publicKey: PublicKey): string {
  return `stashmap-panes-${publicKey}`;
}

function loadPanesFromStorage(publicKey: PublicKey): Pane[] | undefined {
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

function savePanesToStorage(publicKey: PublicKey, panes: Pane[]): void {
  if (publicKey === UNAUTHENTICATED_USER_PK) {
    return;
  }
  try {
    const serialized = panes.map((p) => paneToJSON(p));
    localStorage.setItem(
      panesStorageKey(publicKey),
      JSON.stringify(serialized)
    );
  } catch {
    // ignore storage errors
  }
}

function viewsStorageKey(publicKey: PublicKey): string {
  return `stashmap-views-${publicKey}`;
}

function loadViewsFromStorage(publicKey: PublicKey): Views | undefined {
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

function saveViewsToStorage(publicKey: PublicKey, views: Views): void {
  try {
    localStorage.setItem(
      viewsStorageKey(publicKey),
      JSON.stringify(viewDataToJSON(views, []))
    );
  } catch {
    // ignore storage errors
  }
}

function getUrlPanes(publicKey: PublicKey): Pane[] | undefined {
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
  return undefined;
}

function getInitialPanes(publicKey: PublicKey): Pane[] {
  const urlPanes = getUrlPanes(publicKey);
  if (urlPanes) {
    return urlPanes;
  }
  const historyState = window.history.state as {
    panes?: Pane[];
  } | null;
  if (historyState?.panes && historyState.panes.length > 0) {
    return historyState.panes;
  }
  const stored = loadPanesFromStorage(publicKey);
  if (stored) {
    return stored;
  }
  return [defaultPane(publicKey)];
}

export type UserSessionState = {
  panes: Pane[];
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  views: Views;
  setViews: Dispatch<SetStateAction<Views>>;
  publishStatus: EventState;
  setPublishStatus: Dispatch<SetStateAction<EventState>>;
};

export function useUserSessionState(user: User): UserSessionState {
  const myPublicKey = user.publicKey;
  const [panes, setPanes] = useState<Pane[]>(() =>
    getInitialPanes(myPublicKey)
  );
  const [views, setViews] = useState<Views>(
    () => loadViewsFromStorage(myPublicKey) || Map<string, View>()
  );
  const [publishStatus, setPublishStatus] = useState<EventState>({
    unsignedEvents: List(),
    results: Map(),
    isLoading: false,
    preLoginEvents: List(),
    temporaryView: DEFAULT_TEMPORARY_VIEW,
    temporaryEvents: List(),
  });

  const initialUrlRouteRef = useRef(getUrlPanes(myPublicKey) !== undefined);
  const initialPublicKeyRef = useRef(myPublicKey);
  useEffect(() => {
    if (myPublicKey === initialPublicKeyRef.current) {
      return;
    }
    const urlPanes = initialUrlRouteRef.current
      ? getUrlPanes(myPublicKey)
      : undefined;
    const savedPanes = loadPanesFromStorage(myPublicKey);
    const savedViews = loadViewsFromStorage(myPublicKey);
    if (urlPanes) {
      setPanes(urlPanes);
    } else if (savedPanes) {
      setPanes(savedPanes);
    } else {
      setPanes((current) =>
        current.map((p) => ({
          ...p,
          author: replaceUnauthenticatedUser(p.author, myPublicKey),
        }))
      );
    }
    if (savedViews) {
      setViews(savedViews);
    }
  }, [myPublicKey]);

  useEffect(() => {
    savePanesToStorage(myPublicKey, panes);
  }, [panes, myPublicKey]);

  useEffect(() => {
    saveViewsToStorage(myPublicKey, views);
  }, [views, myPublicKey]);

  return {
    panes,
    setPanes,
    views,
    setViews,
    publishStatus,
    setPublishStatus,
  };
}
