import React, { createContext, useContext } from "react";
import { clearViewsForPane } from "./ViewContext";
import { planUpdateViews, planUpdatePanes, usePlanner } from "./planner";
import { useData } from "./DataContext";

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
  return useCurrentPane().stack;
}

export function usePaneAuthor(): PublicKey {
  return useCurrentPane().author;
}

export function useIsViewingOtherUserContent(): boolean {
  const { user } = useData();
  const paneAuthor = usePaneAuthor();
  return paneAuthor !== user.publicKey;
}

export function useRoot(): ID {
  const pane = useCurrentPane();
  return pane.stack[pane.stack.length - 1] as ID;
}

type PaneOperations = {
  panes: Pane[];
  addPaneAt: (
    index: number,
    stack: ID[],
    author: PublicKey,
    rootRelation?: LongID
  ) => void;
  removePane: (paneId: string) => void;
  setPane: (pane: Pane) => void;
};

export function useSplitPanes(): PaneOperations {
  const { panes } = useData();
  const { createPlan, executePlan } = usePlanner();

  const addPaneAt = (
    index: number,
    stack: ID[],
    author: PublicKey,
    rootRelation?: LongID
  ): void => {
    const newPane: Pane = {
      id: generatePaneId(),
      stack,
      author,
      rootRelation,
    };
    const newPanes = [...panes.slice(0, index), newPane, ...panes.slice(index)];
    const plan = createPlan();
    executePlan(planUpdatePanes(plan, newPanes));
  };

  const removePane = (paneId: string): void => {
    if (panes.length <= 1) {
      return;
    }
    const newPanes = panes.filter((p) => p.id !== paneId);
    const plan = createPlan();
    executePlan(planUpdatePanes(plan, newPanes));
  };

  const setPane = (pane: Pane): void => {
    const paneIndex = panes.findIndex((p) => p.id === pane.id);
    if (paneIndex >= 0) {
      const plan = createPlan();
      const clearedViews = clearViewsForPane(plan.views, paneIndex);
      const planWithViews = planUpdateViews(plan, clearedViews);
      const newPanes = panes.map((p) => (p.id === pane.id ? pane : p));
      executePlan(planUpdatePanes(planWithViews, newPanes));
    }
  };

  return { panes, addPaneAt, removePane, setPane };
}
