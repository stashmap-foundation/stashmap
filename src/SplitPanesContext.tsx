import React, { createContext, useContext } from "react";
import { planUpdatePanes, usePlanner } from "./planner";
import { useData } from "./DataContext";
import {
  pathToStack,
  parseRelationUrl,
  parseAuthorFromSearch,
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
  return useCurrentPane().stack;
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
    rootRelation?: LongID,
    scrollToNodeId?: string
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
    stack: ID[],
    author: PublicKey,
    rootRelation?: LongID,
    scrollToNodeId?: string
  ): void => {
    const newPane: Pane = {
      id: generatePaneId(),
      stack,
      author,
      rootRelation,
      scrollToNodeId,
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
    const hashIndex = url.indexOf("#");
    const urlWithoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    const scrollToNodeId =
      hashIndex >= 0 ? decodeURIComponent(url.slice(hashIndex + 1)) : undefined;
    const questionMarkIndex = urlWithoutHash.indexOf("?");
    const pathname =
      questionMarkIndex >= 0
        ? urlWithoutHash.slice(0, questionMarkIndex)
        : urlWithoutHash;
    const search =
      questionMarkIndex >= 0 ? urlWithoutHash.slice(questionMarkIndex) : "";
    const author = parseAuthorFromSearch(search) || user.publicKey;
    const relationID = parseRelationUrl(pathname);
    if (relationID) {
      setPane({
        id: pane.id,
        stack: [],
        author,
        rootRelation: relationID,
        scrollToNodeId,
      });
    } else {
      setPane({
        id: pane.id,
        stack: pathToStack(pathname),
        author,
      });
    }
  };
}
