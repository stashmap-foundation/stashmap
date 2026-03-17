import React, { createContext, useContext, useRef, useCallback } from "react";

const MAX_HISTORY = 50;

type PaneHistoryAPI = {
  push: (paneId: string, pane: Pane) => void;
  pop: (paneId: string) => Pane | undefined;
  canGoBack: (paneId: string) => boolean;
  cleanup: (paneId: string) => void;
};

const PaneHistoryContext = createContext<PaneHistoryAPI | undefined>(undefined);

export function PaneHistoryProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const historyRef = useRef<Record<string, Pane[]>>({});

  const push = useCallback((paneId: string, pane: Pane): void => {
    const history = historyRef.current;
    const stack = history[paneId] || [];
    const trimmed = stack.length >= MAX_HISTORY ? stack.slice(1) : stack;
    // eslint-disable-next-line functional/immutable-data
    history[paneId] = [...trimmed, pane];
  }, []);

  const pop = useCallback((paneId: string): Pane | undefined => {
    const history = historyRef.current;
    const stack = history[paneId];
    if (!stack || stack.length === 0) {
      return undefined;
    }
    const pane = stack[stack.length - 1];
    // eslint-disable-next-line functional/immutable-data
    history[paneId] = stack.slice(0, -1);
    return pane;
  }, []);

  const canGoBack = useCallback((paneId: string): boolean => {
    const stack = historyRef.current[paneId];
    return !!stack && stack.length > 0;
  }, []);

  const cleanup = useCallback((paneId: string): void => {
    // eslint-disable-next-line functional/immutable-data
    delete historyRef.current[paneId];
  }, []);

  const api: PaneHistoryAPI = { push, pop, canGoBack, cleanup };

  return (
    <PaneHistoryContext.Provider value={api}>
      {children}
    </PaneHistoryContext.Provider>
  );
}

export function usePaneHistory(): PaneHistoryAPI | undefined {
  return useContext(PaneHistoryContext);
}
