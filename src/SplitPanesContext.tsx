import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { clearViewsForPane } from "./ViewContext";
import { planUpdateViews, usePlanner } from "./planner";
import { useData } from "./DataContext";
import { useWorkspaceContext } from "./WorkspaceContext";
import { UNAUTHENTICATED_USER_PK } from "./AppState";

export type Pane = {
  id: string;
  stack: (LongID | ID)[];
  author: PublicKey;
  rootRelation?: LongID;
};

type SplitPanesContextType = {
  panes: Pane[];
  addPaneAt: (
    index: number,
    stack: (LongID | ID)[],
    author: PublicKey,
    rootRelation?: LongID
  ) => void;
  removePane: (paneId: string) => void;
  setPane: (pane: Pane) => void;
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
  const { user } = useData();
  const { activeWorkspace } = useWorkspaceContext();
  const { createPlan, executePlan } = usePlanner();
  const [panes, setPanes] = useState<Pane[]>([
    { id: generatePaneId(), stack: [activeWorkspace], author: user.publicKey },
  ]);

  useEffect(() => {
    if (user.publicKey !== UNAUTHENTICATED_USER_PK) {
      setPanes((prev) =>
        prev.map((pane) =>
          pane.author === UNAUTHENTICATED_USER_PK
            ? { ...pane, author: user.publicKey }
            : pane
        )
      );
    }
  }, [user.publicKey]);

  const addPaneAt = useCallback(
    (
      index: number,
      stack: (LongID | ID)[],
      author: PublicKey,
      rootRelation?: LongID
    ) => {
      setPanes((prev) => {
        const newPane: Pane = {
          id: generatePaneId(),
          stack,
          author,
          rootRelation,
        };
        return [...prev.slice(0, index), newPane, ...prev.slice(index)];
      });
    },
    []
  );

  const removePane = useCallback((paneId: string) => {
    setPanes((prev) => {
      if (prev.length <= 1) {
        return prev;
      }
      return prev.filter((p) => p.id !== paneId);
    });
  }, []);

  const setPane = useCallback(
    (pane: Pane) => {
      const paneIndex = panes.findIndex((p) => p.id === pane.id);
      if (paneIndex >= 0) {
        const plan = createPlan();
        const clearedViews = clearViewsForPane(plan.views, paneIndex);
        executePlan(planUpdateViews(plan, clearedViews));
      }
      setPanes((prev) => prev.map((p) => (p.id === pane.id ? pane : p)));
    },
    [panes, createPlan, executePlan]
  );

  const value = React.useMemo(
    () => ({
      panes,
      addPaneAt,
      removePane,
      setPane,
    }),
    [panes, addPaneAt, removePane, setPane]
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

export function useCurrentPane(): Pane {
  const { panes } = useSplitPanes();
  const paneIndex = usePaneIndex();
  return panes[paneIndex];
}

export function usePaneStack(): (LongID | ID)[] {
  return useCurrentPane().stack;
}

export function usePaneAuthor(): PublicKey {
  return useCurrentPane().author;
}
