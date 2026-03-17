import React from "react";
import { List, Map } from "immutable";
import type { GraphNode } from "../../graph/types";
import type { View } from "../../session/types";
import { isSearchId } from "../../graph/context";
import { getNode } from "../../graph/queries";
import { resolveSemanticNodeInCurrentTree } from "../../graph/semanticResolution";
import { useData } from "../app-shell/DataContext";
import { usePaneStack } from "../navigation/SplitPanesContext";
import { getDisplayTextForView } from "../../rows/display";
import {
  addNodeToPath,
  getContextFromStack,
  getCurrentEdgeForView,
  getEffectiveAuthor,
  getNodeForView,
  getNodeIndexForView,
  getPreviousSibling,
  getRowIDFromView,
  type SiblingInfo,
} from "../../rows/resolveRow";
import {
  isRoot,
  getParentRowPath,
  type RowPath,
  rowPathToString,
} from "../../rows/rowPaths";
import type { VirtualRowsMap } from "../../rows/types";
import { isExpanded } from "../../session/views";

export const ViewContext = React.createContext<RowPath | undefined>(undefined);

export function useRowPath(): RowPath {
  const context = React.useContext(ViewContext);
  if (!context) {
    throw new Error("ViewContext not provided");
  }
  return context;
}

const VirtualRowsContext = React.createContext<VirtualRowsMap>(
  Map<string, GraphNode>()
);

export const VirtualRowsProvider = VirtualRowsContext.Provider;

export function useVirtualRowsMap(): VirtualRowsMap {
  return React.useContext(VirtualRowsContext);
}

export function useSearchDepth(): number | undefined {
  const data = useData();
  const rowPath = useRowPath();

  const loop = (
    currentPath: RowPath | undefined,
    depth: number
  ): number | undefined => {
    if (!currentPath) return undefined;
    const [rowID] = getRowIDFromView(data, currentPath);
    if (isSearchId(rowID as ID)) {
      return depth;
    }
    return loop(getParentRowPath(currentPath), depth + 1);
  };

  return loop(getParentRowPath(rowPath), 1);
}

export function useIsInSearchView(): boolean {
  return useSearchDepth() !== undefined;
}

export function useEffectiveAuthor(): PublicKey {
  const data = useData();
  const rowPath = useRowPath();
  return getEffectiveAuthor(data, rowPath);
}

export function useCurrentNode(): GraphNode | undefined {
  const data = useData();
  const rowPath = useRowPath();
  const stack = usePaneStack();
  return getNodeForView(data, rowPath, stack);
}

export function useIsViewingOtherUserContent(): boolean {
  const { user } = useData();
  const effectiveAuthor = useEffectiveAuthor();
  return effectiveAuthor !== user.publicKey;
}

export function useNodeIndex(): number | undefined {
  const rowPath = useRowPath();
  const data = useData();
  return getNodeIndexForView(data, rowPath);
}

export function useCurrentEdge(): GraphNode | undefined {
  const virtualRows = React.useContext(VirtualRowsContext);
  const data = useData();
  const rowPath = useRowPath();
  const viewKey = rowPathToString(rowPath);
  const virtualRow = virtualRows.get(viewKey);
  if (virtualRow) {
    return virtualRow;
  }
  return getCurrentEdgeForView(data, rowPath);
}

export function usePreviousSibling(): SiblingInfo | undefined {
  const data = useData();
  const rowPath = useRowPath();
  const stack = usePaneStack();
  return getPreviousSibling(data, rowPath, stack);
}

export function RootViewContextProvider({
  children,
  root,
  paneIndex = 0,
  indices,
}: {
  children: React.ReactNode;
  root: ID;
  paneIndex?: number;
  indices?: List<number>;
}): JSX.Element {
  const data = useData();
  const stack = usePaneStack();
  const pane = data.panes[paneIndex];
  const rootContext = getContextFromStack(stack);
  const resolvedRootNode = pane?.rootNodeId
    ? getNode(data.knowledgeDBs, pane.rootNodeId, data.user.publicKey)
    : resolveSemanticNodeInCurrentTree(
        data.knowledgeDBs,
        pane?.author || data.user.publicKey,
        root,
        rootContext,
        undefined,
        true
      );
  const startPath: RowPath = [paneIndex, resolvedRootNode?.id || root];
  const finalPath = (indices || List<number>()).reduce(
    (acc, index) => addNodeToPath(data, acc, index, stack),
    startPath
  );
  return (
    <ViewContext.Provider value={finalPath}>{children}</ViewContext.Provider>
  );
}

export function useCurrentRowID(): [ID, View] {
  const data = useData();
  const rowPath = useRowPath();
  return getRowIDFromView(data, rowPath);
}

export function useDisplayText(): string {
  const data = useData();
  const rowPath = useRowPath();
  const stack = usePaneStack();
  const currentRow = useCurrentEdge();
  const virtualType = currentRow?.virtualType;
  return getDisplayTextForView(data, rowPath, stack, virtualType, currentRow);
}

export function useViewKey(): string {
  return rowPathToString(useRowPath());
}

export function useIsExpanded(): boolean {
  const data = useData();
  const viewKey = useViewKey();
  return isExpanded(data, viewKey);
}

export function useIsRoot(): boolean {
  return isRoot(useRowPath());
}
