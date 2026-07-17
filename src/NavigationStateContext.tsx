import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useData } from "./DataContext";
import { LOCAL } from "./core/nodeRef";
import {
  buildCoordinateRouteUrl,
  buildDocumentRouteUrl,
  buildNodeRouteUrl,
  parseAtFromSearch,
  parseCoordinateRouteUrl,
  parseDocumentRouteUrl,
  parseFallbackLabelFromSearch,
  parseNodeRouteUrl,
  parseStorageKeyFromHash,
  resolveAddress,
  routeCoordinateSourceId,
} from "./navigationUrl";
import { usePlanner } from "./planner";
import { generatePaneId } from "./SplitPanesContext";

type NavigationStateContextType = {
  activePaneIndex: number;
  setActivePaneIndex: (index: number) => void;
  replaceNextNavigation: () => void;
};

const NavigationStateContext = createContext<
  NavigationStateContextType | undefined
>(undefined);

export function useNavigationState(): NavigationStateContextType {
  const context = useContext(NavigationStateContext);
  if (!context) {
    throw new Error(
      "useNavigationState must be used within NavigationStateProvider"
    );
  }
  return context;
}

type HistoryState = {
  panes: Pane[];
  activePaneIndex: number;
};

function paneToUrl(activePane: Pane): string | undefined {
  const withStorageKey = (url: string): string =>
    activePane.storageKey === undefined || !url.startsWith("/storage/")
      ? url
      : `${url}#key=${encodeURIComponent(activePane.storageKey)}`;
  if (activePane.routeCoordinate) {
    const prefix =
      activePane.routeCoordinate.eventKind === 34774 ? "deposit" : "storage";
    return withStorageKey(
      buildCoordinateRouteUrl(
        prefix,
        activePane.routeCoordinate,
        activePane.scrollToId ?? activePane.rootNodeId,
        undefined
      )
    );
  }
  if (activePane.documentId) {
    return withStorageKey(
      buildDocumentRouteUrl(
        activePane.sourceId,
        activePane.documentId,
        activePane.scrollToId
      )
    );
  }
  if (activePane.rootNodeId) {
    return withStorageKey(
      buildNodeRouteUrl(activePane.rootNodeId, activePane.sourceId, {
        scrollToId: activePane.scrollToId,
        fallbackLabel: activePane.fallbackLabel,
      })
    );
  }

  return "/";
}

function urlToPane(
  pathname: string,
  search: string,
  hash: string,
  myPublicKey: PublicKey | undefined
): Pane {
  const fallbackLabel = parseFallbackLabelFromSearch(search);
  const at = parseAtFromSearch(search);
  const storageKey = parseStorageKeyFromHash(hash);
  const documentRoute = parseDocumentRouteUrl(pathname);
  if (documentRoute) {
    return {
      id: generatePaneId(),
      sourceId: LOCAL,
      documentId: documentRoute.docId,
      scrollToId: at,
    };
  }
  const storageRoute = parseCoordinateRouteUrl(pathname, "storage");
  if (storageRoute) {
    return {
      id: generatePaneId(),
      sourceId: resolveAddress(storageRoute.pubkey, myPublicKey),
      routeCoordinate: storageRoute,
      ...(at === undefined
        ? { documentId: storageRoute.dTag }
        : { rootNodeId: at }),
      ...(storageKey !== undefined && { storageKey }),
    };
  }
  const depositRoute = parseCoordinateRouteUrl(pathname, "deposit");
  if (depositRoute) {
    return {
      id: generatePaneId(),
      sourceId: routeCoordinateSourceId(depositRoute),
      routeCoordinate: depositRoute,
      ...(at === undefined
        ? { documentId: depositRoute.dTag }
        : { rootNodeId: at }),
    };
  }
  const nodeID = parseNodeRouteUrl(pathname);
  if (nodeID) {
    return {
      id: generatePaneId(),
      sourceId: LOCAL,
      rootNodeId: nodeID,
      scrollToId: at,
      ...(fallbackLabel !== undefined && { fallbackLabel }),
    };
  }
  return {
    id: generatePaneId(),
    sourceId: LOCAL,
  };
}

export function NavigationStateProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { panes, user } = useData();
  const { setPanes } = usePlanner();
  const [activePaneIndex, setActivePaneIndexState] = useState(
    () =>
      (window.history.state as { activePaneIndex?: number } | null)
        ?.activePaneIndex ?? 0
  );
  const isPopstateRef = useRef(false);
  const prevUrlRef = useRef<string>("");
  const replaceNextRef = useRef(false);

  const replaceNextNavigation = (): void => {
    // eslint-disable-next-line functional/immutable-data
    replaceNextRef.current = true;
  };

  const safeActivePaneIndex = Math.min(activePaneIndex, panes.length - 1);

  const setActivePaneIndex = (index: number): void => {
    const clamped = Math.min(index, panes.length - 1);
    if (clamped === safeActivePaneIndex) {
      return;
    }
    setActivePaneIndexState(clamped);
  };

  useEffect(() => {
    const activePane = panes[safeActivePaneIndex];
    if (!activePane) {
      return;
    }
    const fullUrl = paneToUrl(activePane);

    if (fullUrl === undefined) {
      return;
    }

    if (isPopstateRef.current) {
      // eslint-disable-next-line functional/immutable-data
      isPopstateRef.current = false;
      // eslint-disable-next-line functional/immutable-data
      prevUrlRef.current = fullUrl;
      return;
    }

    if (fullUrl === prevUrlRef.current) {
      const state: HistoryState = {
        panes,
        activePaneIndex: safeActivePaneIndex,
      };
      window.history.replaceState(state, "", fullUrl);
      return;
    }

    const historyState: HistoryState = {
      panes,
      activePaneIndex: safeActivePaneIndex,
    };

    if (prevUrlRef.current === "" || replaceNextRef.current) {
      window.history.replaceState(historyState, "", fullUrl);
      // eslint-disable-next-line functional/immutable-data
      replaceNextRef.current = false;
    } else {
      window.history.pushState(historyState, "", fullUrl);
    }
    // eslint-disable-next-line functional/immutable-data
    prevUrlRef.current = fullUrl;
  }, [panes, safeActivePaneIndex, user?.publicKey]);

  useEffect(() => {
    const onPopState = (e: PopStateEvent): void => {
      // eslint-disable-next-line functional/immutable-data
      isPopstateRef.current = true;
      const state = e.state as HistoryState | null;
      if (state?.panes) {
        setPanes(state.panes);
        setActivePaneIndexState(state.activePaneIndex ?? 0);
      } else {
        setPanes([
          urlToPane(
            window.location.pathname,
            window.location.search,
            window.location.hash,
            user?.publicKey
          ),
        ]);
        setActivePaneIndexState(0);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [user?.publicKey, setPanes]);

  return (
    <NavigationStateContext.Provider
      value={{
        activePaneIndex: safeActivePaneIndex,
        setActivePaneIndex,
        replaceNextNavigation,
      }}
    >
      {children}
    </NavigationStateContext.Provider>
  );
}
