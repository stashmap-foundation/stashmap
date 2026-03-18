import type { Pane } from "./types";

export function generatePaneId(): string {
  return `pane-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

type HasPanes<TPane> = {
  panes: TPane[];
};

export function getPane<TPane>(
  plan: HasPanes<TPane>,
  paneIndex: number
): TPane {
  return plan.panes[paneIndex];
}

export function planUpdatePanes<T extends HasPanes<Pane>>(
  plan: T,
  panes: Pane[]
): T {
  return {
    ...plan,
    panes,
  };
}

export function defaultPane(author: PublicKey, rootNodeID?: ID): Pane {
  return {
    id: generatePaneId(),
    stack: rootNodeID ? [rootNodeID] : [],
    author,
  };
}
