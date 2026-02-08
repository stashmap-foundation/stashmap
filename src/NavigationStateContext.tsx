import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useData } from "./DataContext";
import { createConcreteRefId, getRefTargetInfo } from "./connections";
import {
  stackToPath,
  pathToStack,
  buildRelationUrl,
  parseRelationUrl,
} from "./navigationUrl";
import { usePlanner } from "./planner";
import { generatePaneId } from "./SplitPanesContext";

type NavigationStateContextType = {
  activePaneIndex: number;
  setActivePaneIndex: (index: number) => void;
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

function paneToUrl(
  activePane: Pane,
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): string | undefined {
  if (activePane.rootRelation) {
    return buildRelationUrl(activePane.rootRelation);
  }
  return stackToPath(activePane.stack, knowledgeDBs, myself);
}

function urlToPane(pathname: string, fallbackAuthor: PublicKey): Pane {
  const relationID = parseRelationUrl(pathname);
  if (relationID) {
    return {
      id: generatePaneId(),
      stack: [],
      author: fallbackAuthor,
      rootRelation: relationID,
    };
  }
  return {
    id: generatePaneId(),
    stack: pathToStack(pathname),
    author: fallbackAuthor,
  };
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
      (p) => p.rootRelation && p.stack.length === 0
    );
    if (!needsResolution) {
      return;
    }
    const resolved = panes.map((p) => {
      if (!p.rootRelation || p.stack.length > 0) {
        return p;
      }
      const crefId = createConcreteRefId(p.rootRelation);
      const refInfo = getRefTargetInfo(crefId, knowledgeDBs, user.publicKey);
      if (!refInfo) {
        return p;
      }
      return {
        ...p,
        stack: refInfo.stack,
        author: refInfo.author,
        rootRelation: refInfo.rootRelation,
      };
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

    if (prevUrlRef.current === "") {
      window.history.replaceState(historyState, "", fullUrl);
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
        setPanes([urlToPane(window.location.pathname, user.publicKey)]);
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
      }}
    >
      {children}
    </NavigationStateContext.Provider>
  );
}
