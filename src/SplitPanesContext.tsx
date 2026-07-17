import React, { createContext, useContext } from "react";
import { LOCAL } from "./core/nodeRef";
import { planUpdatePanes, usePlanner } from "./planner";
import { useData } from "./DataContext";
import {
  parseAtFromSearch,
  parseCoordinateRouteUrl,
  parseDocumentRouteUrl,
  parseFallbackLabelFromSearch,
  parseNodeRouteUrl,
  parseStorageKeyFromHash,
  resolveAddress,
  routeCoordinateSourceId,
} from "./navigationUrl";
import { usePaneHistory } from "./PaneHistoryContext";

const PaneIndexContext = createContext<number>(0);

export function generatePaneId(): string {
  return `pane-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function PaneIndexProvider({
  children,
  index,
}: {
  children: React.ReactNode;
  index: number;
}): JSX.Element {
  return (
    <PaneIndexContext.Provider value={index}>
      {children}
    </PaneIndexContext.Provider>
  );
}

export function usePaneIndex(): number {
  return useContext(PaneIndexContext);
}

export function useCurrentPane(): Pane {
  const { panes } = useData();
  const paneIndex = usePaneIndex();
  return panes[paneIndex];
}

export function usePaneStack(): ID[] {
  return [];
}

type PaneOperations = {
  panes: Pane[];
  addPaneAt: (
    index: number,
    sourceId: SourceId,
    rootNodeId?: ID,
    scrollToId?: string,
    documentId?: string,
    fallbackLabel?: string
  ) => void;
  removePane: (paneId: string) => void;
  setPane: (pane: Pane) => void;
};

export function useSplitPanes(): PaneOperations {
  const { panes } = useData();
  const { createPlan, executePlan } = usePlanner();
  const paneHistory = usePaneHistory();

  const addPaneAt = (
    index: number,
    sourceId: SourceId,
    rootNodeId?: ID,
    scrollToId?: string,
    documentId?: string,
    fallbackLabel?: string
  ): void => {
    const newPane: Pane = {
      id: generatePaneId(),
      sourceId,
      documentId,
      rootNodeId,
      scrollToId,
      fallbackLabel,
    };
    const newPanes = [...panes.slice(0, index), newPane, ...panes.slice(index)];
    const plan = createPlan();
    executePlan(planUpdatePanes(plan, newPanes));
  };

  const removePane = (paneId: string): void => {
    if (panes.length <= 1) {
      return;
    }
    paneHistory?.cleanup(paneId);
    const newPanes = panes.filter((p) => p.id !== paneId);
    const plan = createPlan();
    executePlan(planUpdatePanes(plan, newPanes));
  };

  const setPane = (pane: Pane): void => {
    const paneIndex = panes.findIndex((p) => p.id === pane.id);
    if (paneIndex >= 0) {
      const plan = createPlan();
      const newPanes = panes.map((p) => (p.id === pane.id ? pane : p));
      executePlan(planUpdatePanes(plan, newPanes));
    }
  };

  return { panes, addPaneAt, removePane, setPane };
}

export function useNavigatePane(): (url: string) => void {
  const { setPane } = useSplitPanes();
  const pane = useCurrentPane();
  const { user } = useData();
  const paneHistory = usePaneHistory();

  return (url: string): void => {
    paneHistory?.push(pane.id, pane);
    window.history.pushState({}, "", url);
    const hashIndex = url.indexOf("#");
    const urlWithoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
    const questionMarkIndex = urlWithoutHash.indexOf("?");
    const pathname =
      questionMarkIndex >= 0
        ? urlWithoutHash.slice(0, questionMarkIndex)
        : urlWithoutHash;
    const search =
      questionMarkIndex >= 0 ? urlWithoutHash.slice(questionMarkIndex) : "";
    const fallbackLabel = parseFallbackLabelFromSearch(search);
    const at = parseAtFromSearch(search);
    const documentRoute = parseDocumentRouteUrl(pathname);
    if (documentRoute) {
      setPane({
        id: pane.id,
        sourceId: LOCAL,
        documentId: documentRoute.docId,
        scrollToId: at,
        fallbackLabel: undefined,
      });
      return;
    }
    const storageRoute = parseCoordinateRouteUrl(pathname, "storage");
    if (storageRoute) {
      const storageKey = parseStorageKeyFromHash(hash);
      setPane({
        id: pane.id,
        sourceId: resolveAddress(storageRoute.pubkey, user?.publicKey),
        routeCoordinate: storageRoute,
        ...(at === undefined
          ? { documentId: storageRoute.dTag }
          : { rootNodeId: at }),
        ...(storageKey !== undefined && { storageKey }),
      });
      return;
    }
    const depositRoute = parseCoordinateRouteUrl(pathname, "deposit");
    if (depositRoute) {
      setPane({
        id: pane.id,
        sourceId: routeCoordinateSourceId(depositRoute),
        routeCoordinate: depositRoute,
        ...(at === undefined
          ? { documentId: depositRoute.dTag }
          : { rootNodeId: at }),
      });
      return;
    }
    const nodeID = parseNodeRouteUrl(pathname);
    if (nodeID) {
      setPane({
        id: pane.id,
        sourceId: LOCAL,
        rootNodeId: nodeID,
        scrollToId: at,
        fallbackLabel,
      });
    } else {
      setPane({
        id: pane.id,
        sourceId: LOCAL,
        fallbackLabel: undefined,
      });
    }
  };
}
