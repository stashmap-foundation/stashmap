import React, { createContext, useContext, useState, useCallback } from "react";
import { clearViewsForPane } from "./ViewContext";
import { planUpdateViews, usePlanner } from "./planner";

export type Pane = {
  id: string;
  initialStack?: (LongID | ID)[];
};

type SplitPanesContextType = {
  panes: Pane[];
  addPane: () => void;
  addPaneAt: (index: number, stack: (LongID | ID)[]) => void;
  removePane: (paneId: string) => void;
};

const SplitPanesContext = createContext<SplitPanesContextType | undefined>(
  undefined
);

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

  const addPaneAt = useCallback((index: number, stack: (LongID | ID)[]) => {
    setPanes((prev) => {
      const newPane = { id: generatePaneId(), initialStack: stack };
      return [...prev.slice(0, index), newPane, ...prev.slice(index)];
    });
  }, []);

  const removePane = useCallback((paneId: string) => {
    setPanes((prev) => {
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
  popTo: (index: number) => void;
  setStack: (path: (LongID | ID)[]) => void;
};

const PaneNavigationContext = createContext<
  PaneNavigationContextType | undefined
>(undefined);

export function PaneNavigationProvider({
  children,
  initialWorkspace,
  initialStack,
}: {
  children: React.ReactNode;
  initialWorkspace: LongID | ID;
  initialStack?: (LongID | ID)[];
}): JSX.Element {
  const [stack, setStack] = useState<(LongID | ID)[]>(
    initialStack || [initialWorkspace]
  );
  const paneIndex = usePaneIndex();
  const { createPlan, executePlan } = usePlanner();

  // activeWorkspace is always the last element of the stack
  const activeWorkspace = stack[stack.length - 1];

  const popTo = useCallback((index: number): void => {
    setStack((prev) =>
      index >= 0 && index < prev.length ? prev.slice(0, index + 1) : prev
    );
  }, []);

  const setStackFn = useCallback(
    (path: (LongID | ID)[]): void => {
      if (path.length === 0) return;
      // Clear views for this pane when navigating
      const plan = createPlan();
      const clearedViews = clearViewsForPane(plan.views, paneIndex);
      executePlan(planUpdateViews(plan, clearedViews));
      setStack(path);
    },
    [createPlan, executePlan, paneIndex]
  );

  const value = React.useMemo(
    () => ({
      stack,
      activeWorkspace,
      popTo,
      setStack: setStackFn,
    }),
    [stack, activeWorkspace, popTo, setStackFn]
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

export function usePaneStack(): (LongID | ID)[] {
  return usePaneNavigation().stack;
}
