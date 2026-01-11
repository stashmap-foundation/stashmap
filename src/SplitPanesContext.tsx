import React, { createContext, useContext, useState, useCallback } from "react";
import { ROOT } from "./types";

export type Pane = {
  id: string;
  initialNode?: LongID | ID;
};

type SplitPanesContextType = {
  panes: Pane[];
  addPane: () => void;
  addPaneAt: (index: number, nodeID: LongID | ID) => void;
  removePane: (paneId: string) => void;
};

const SplitPanesContext = createContext<SplitPanesContextType | undefined>(
  undefined
);

// Context to track which pane we're currently in
const PaneIndexContext = createContext<number>(0);

function generatePaneId(): string {
  return `pane-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function SplitPanesProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [panes, setPanes] = useState<Pane[]>([{ id: generatePaneId() }]);

  const addPane = useCallback(() => {
    setPanes((prev) => [...prev, { id: generatePaneId() }]);
  }, []);

  const addPaneAt = useCallback((index: number, nodeID: LongID | ID) => {
    setPanes((prev) => {
      const newPane = { id: generatePaneId(), initialNode: nodeID };
      return [...prev.slice(0, index), newPane, ...prev.slice(index)];
    });
  }, []);

  const removePane = useCallback((paneId: string) => {
    setPanes((prev) => {
      // Don't remove if it's the last pane
      if (prev.length <= 1) {
        return prev;
      }
      return prev.filter((p) => p.id !== paneId);
    });
  }, []);

  const value = React.useMemo(
    () => ({
      panes,
      addPane,
      addPaneAt,
      removePane,
    }),
    [panes, addPane, addPaneAt, removePane]
  );

  return (
    <SplitPanesContext.Provider value={value}>
      {children}
    </SplitPanesContext.Provider>
  );
}

export function useSplitPanes(): SplitPanesContextType {
  const context = useContext(SplitPanesContext);
  if (!context) {
    throw new Error("useSplitPanes must be used within SplitPanesProvider");
  }
  return context;
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

// Pane-specific navigation (not URL-coupled)
type PaneNavigationContextType = {
  stack: (LongID | ID)[];
  activeWorkspace: LongID | ID;
  push: (nodeID: LongID | ID) => void;
  pop: () => void;
  popTo: (index: number) => void;
  replace: (nodeID: LongID | ID) => void;
};

const PaneNavigationContext = createContext<
  PaneNavigationContextType | undefined
>(undefined);

export function PaneNavigationProvider({
  children,
  initialWorkspace,
}: {
  children: React.ReactNode;
  initialWorkspace: LongID | ID;
}): JSX.Element {
  const [stack, setStack] = useState<(LongID | ID)[]>([ROOT]);
  const [activeWorkspace, setActiveWorkspace] = useState<LongID | ID>(
    initialWorkspace
  );

  const push = useCallback((nodeID: LongID | ID): void => {
    setStack((prev) => [...prev, nodeID]);
    setActiveWorkspace(nodeID);
  }, []);

  const pop = useCallback((): void => {
    setStack((prev) => {
      if (prev.length > 1) {
        const newStack = prev.slice(0, -1);
        setActiveWorkspace(newStack[newStack.length - 1]);
        return newStack;
      }
      return prev;
    });
  }, []);

  const popTo = useCallback((index: number): void => {
    setStack((prev) => {
      if (index >= 0 && index < prev.length) {
        const newStack = prev.slice(0, index + 1);
        setActiveWorkspace(newStack[newStack.length - 1]);
        return newStack;
      }
      return prev;
    });
  }, []);

  const replace = useCallback((nodeID: LongID | ID): void => {
    setStack([nodeID]);
    setActiveWorkspace(nodeID);
  }, []);

  // Compute the full stack including activeWorkspace
  const fullStack =
    stack[stack.length - 1] !== activeWorkspace
      ? [...stack, activeWorkspace]
      : stack;

  const value = React.useMemo(
    () => ({
      stack: fullStack,
      activeWorkspace,
      push,
      pop,
      popTo,
      replace,
    }),
    [fullStack, activeWorkspace, push, pop, popTo, replace]
  );

  return (
    <PaneNavigationContext.Provider value={value}>
      {children}
    </PaneNavigationContext.Provider>
  );
}

export function usePaneNavigation(): PaneNavigationContextType {
  const context = useContext(PaneNavigationContext);
  if (!context) {
    throw new Error(
      "usePaneNavigation must be used within PaneNavigationProvider"
    );
  }
  return context;
}

// Alias for compatibility - components can use this instead of useNavigationStack
export function usePaneStack(): (LongID | ID)[] {
  return usePaneNavigation().stack;
}
