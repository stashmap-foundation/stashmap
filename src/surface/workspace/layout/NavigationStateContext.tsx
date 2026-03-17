import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { KnowledgeDBs } from "../../../graph/types";
import type { Pane } from "../../../session/types";
import { useData } from "../../app-shell/DataContext";
import { getNodeRouteTargetInfo } from "../../../graph/references";
import { buildNodeUrl } from "../../../graph/nodeUrl";
import { resolveSemanticStackToActualIDs } from "../../../graph/semanticResolution";
import { usePlanner } from "../../app-shell/PlannerContext";
import {
  buildNodeRouteUrl,
  type HistoryState,
  urlToPane,
} from "../../../session/navigation";

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

function paneToUrl(
  activePane: Pane,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): string | undefined {
  if (activePane.rootNodeId) {
    return buildNodeRouteUrl(activePane.rootNodeId, activePane.scrollToId);
  }

  if (activePane.stack.length > 0) {
    const resolved = resolveSemanticStackToActualIDs(
      knowledgeDBs,
      activePane.author,
      activePane.stack as ID[]
    );
    if (resolved?.node) {
      return buildNodeRouteUrl(resolved.node.id, activePane.scrollToId);
    }
  }

  return buildNodeUrl(
    activePane.stack,
    knowledgeDBs,
    myself,
    activePane.author
  );
}

export function NavigationStateProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { panes, knowledgeDBs, user } = useData();
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
    const needsResolution = panes.some(
      (p) => (p.rootNodeId && p.stack.length === 0) || p.stack.length > 0
    );
    if (!needsResolution) {
      return;
    }
    const resolved = panes.map((p) => {
      if (p.rootNodeId && p.stack.length === 0) {
        const nodeInfo = getNodeRouteTargetInfo(
          p.rootNodeId,
          knowledgeDBs,
          p.author
        );
        if (!nodeInfo) {
          return p;
        }
        return {
          ...p,
          stack: nodeInfo.stack,
          author: nodeInfo.author,
          rootNodeId: nodeInfo.rootNodeId,
        };
      }

      if (p.stack.length === 0) {
        return p;
      }
      const resolvedStack = resolveSemanticStackToActualIDs(
        knowledgeDBs,
        p.author,
        p.stack as ID[]
      )?.actualStack;
      if (!resolvedStack) {
        return p;
      }
      const stackChanged = resolvedStack.some(
        (id, index) => id !== p.stack[index]
      );
      return stackChanged ? { ...p, stack: resolvedStack } : p;
    });
    if (resolved.some((p, i) => p !== panes[i])) {
      setPanes(resolved);
    }
  }, [knowledgeDBs, panes, user.publicKey, setPanes]);

  useEffect(() => {
    const activePane = panes[safeActivePaneIndex];
    if (!activePane) {
      return;
    }
    const fullUrl = paneToUrl(activePane, knowledgeDBs, user.publicKey);

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
  }, [panes, safeActivePaneIndex, knowledgeDBs, user.publicKey]);

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
            user.publicKey
          ),
        ]);
        setActivePaneIndexState(0);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [user.publicKey, setPanes]);

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
