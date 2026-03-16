import type { RowPath } from "./rowPaths";

export function generatePaneId(): string {
  return `pane-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

type HasPanes = {
  panes: Pane[];
};

export function getPane(plan: HasPanes, rowPath: RowPath): Pane {
  const paneIndex = rowPath[0];
  return plan.panes[paneIndex];
}

export function planUpdatePanes<T extends HasPanes>(plan: T, panes: Pane[]): T {
  return {
    ...plan,
    panes,
  };
}

export function defaultPane(author: PublicKey, rootItemID?: ID): Pane {
  return {
    id: generatePaneId(),
    stack: rootItemID ? [rootItemID] : [],
    author,
  };
}
