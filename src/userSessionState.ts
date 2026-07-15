import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { List, Map, Set, OrderedSet } from "immutable";
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
  parseFallbackLabelFromSearch,
  parseNodeRouteUrl,
  parseSourceFromSearch,
  parseStorageKeyFromHash,
  resolveAddress,
} from "./navigationUrl";

export const defaultPane = (): Pane => ({
  id: generatePaneId(),
  sourceId: LOCAL,
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

function loadPanesFromStorage(
  publicKey: PublicKey | undefined
): Pane[] | undefined {
  if (publicKey === undefined) {
    return undefined;
  }
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

function savePanesToStorage(
  publicKey: PublicKey | undefined,
  panes: Pane[]
): void {
  if (publicKey === undefined) {
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

function loadViewsFromStorage(
  publicKey: PublicKey | undefined
): Views | undefined {
  if (publicKey === undefined) {
    return undefined;
  }
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

function saveViewsToStorage(
  publicKey: PublicKey | undefined,
  views: Views
): void {
  if (publicKey === undefined) {
    return;
  }
  try {
    localStorage.setItem(
      viewsStorageKey(publicKey),
      JSON.stringify(viewDataToJSON(views, []))
    );
  } catch {
    // ignore storage errors
  }
}

function getUrlPanes(myPublicKey: PublicKey | undefined): Pane[] | undefined {
  const documentRoute = parseDocumentRouteUrl(window.location.pathname);
  if (documentRoute) {
    const docSource = resolveAddress(documentRoute.address, myPublicKey);
    const storageKey = parseStorageKeyFromHash(window.location.hash);
    return [
      {
        id: generatePaneId(),
        sourceId: docSource,
        documentId: documentRoute.docId,
        ...(storageKey !== undefined && { storageKey }),
      },
    ];
  }
  const nodeID = parseNodeRouteUrl(window.location.pathname);
  if (nodeID) {
    const nodeSource = resolveAddress(
      parseSourceFromSearch(window.location.search),
      myPublicKey
    );
    const fallbackLabel = parseFallbackLabelFromSearch(window.location.search);
    const storageKey = parseStorageKeyFromHash(window.location.hash);
    return [
      {
        id: generatePaneId(),
        sourceId: nodeSource,
        rootNodeId: nodeID,
        ...(fallbackLabel !== undefined && { fallbackLabel }),
        ...(storageKey !== undefined && { storageKey }),
      },
    ];
  }
  return undefined;
}

function getInitialPanes(publicKey: PublicKey | undefined): Pane[] {
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

export type UserSessionState = {
  panes: Pane[];
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  views: Views;
  setViews: Dispatch<SetStateAction<Views>>;
  publishStatus: EventState;
  setPublishStatus: Dispatch<SetStateAction<EventState>>;
};

export function useUserSessionState(user: User | undefined): UserSessionState {
  const myPublicKey = user?.publicKey;
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
