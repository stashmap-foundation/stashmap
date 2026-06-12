import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { List, Map, Set, OrderedSet } from "immutable";
import { UNAUTHENTICATED_USER_PK } from "./NostrAuthContext";
import { LOCAL } from "./core/nodeRef";
import { generatePaneId } from "./SplitPanesContext";
import {
  jsonToPanes,
  jsonToViews,
  paneToJSON,
  Serializable,
  viewDataToJSON,
} from "./serializer";
import {
  parseDocumentRouteUrl,
  parseNodeRouteUrl,
  parseSourceFromSearch,
  resolveAddress,
} from "./navigationUrl";

export const defaultPane = (author: SourceId = LOCAL): Pane => ({
  id: generatePaneId(),
  author,
  sourceId: author,
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

function getUrlPanes(myPublicKey: PublicKey): Pane[] | undefined {
  const documentRoute = parseDocumentRouteUrl(window.location.pathname);
  if (documentRoute) {
    const docSource = resolveAddress(documentRoute.author, myPublicKey);
    return [
      {
        id: generatePaneId(),
        author: docSource,
        sourceId: docSource,
        documentId: documentRoute.docId,
      },
    ];
  }
  const nodeID = parseNodeRouteUrl(window.location.pathname);
  if (nodeID) {
    const nodeSource = resolveAddress(
      parseSourceFromSearch(window.location.search),
      myPublicKey
    );
    return [
      {
        id: generatePaneId(),
        author: nodeSource,
        sourceId: nodeSource,
        rootNodeId: nodeID,
      },
    ];
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
  return [defaultPane()];
}

function replacePaneUser(pane: Pane, publicKey: PublicKey): Pane {
  return {
    ...pane,
    author: pane.author === UNAUTHENTICATED_USER_PK ? publicKey : pane.author,
    sourceId:
      pane.sourceId === UNAUTHENTICATED_USER_PK ? publicKey : pane.sourceId,
  };
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
  const isMountedRef = useRef(false);
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
    temporaryView: DEFAULT_TEMPORARY_VIEW,
    temporaryEvents: List(),
  });

  const initialUrlRouteRef = useRef(getUrlPanes(myPublicKey) !== undefined);
  const initialPublicKeyRef = useRef(myPublicKey);
  useEffect(() => {
    // eslint-disable-next-line functional/immutable-data
    isMountedRef.current = true;
    return () => {
      // eslint-disable-next-line functional/immutable-data
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (myPublicKey === initialPublicKeyRef.current) {
      return;
    }
    const savedViews = loadViewsFromStorage(myPublicKey);
    const urlPanes = initialUrlRouteRef.current
      ? getUrlPanes(myPublicKey)
      : undefined;
    const savedPanes = initialUrlRouteRef.current
      ? undefined
      : loadPanesFromStorage(myPublicKey);
    const nextPanes = urlPanes ?? savedPanes;
    if (nextPanes) {
      setPanes(nextPanes);
    } else {
      setPanes((current) =>
        current.map((p) => replacePaneUser(p, myPublicKey))
      );
    }
    if (savedViews) {
      setViews(savedViews);
    }
  }, [myPublicKey]);

  useEffect(() => {
    if (!isMountedRef.current) {
      return;
    }
    savePanesToStorage(myPublicKey, panes);
  }, [panes, myPublicKey]);

  useEffect(() => {
    if (!isMountedRef.current) {
      return;
    }
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
