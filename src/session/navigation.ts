import { generatePaneId } from "./panes";

export type HistoryState = {
  panes: Pane[];
  activePaneIndex: number;
};

export function pathToStack(pathname: string): ID[] {
  if (!pathname.startsWith("/n/")) {
    return [];
  }
  const rest = pathname.slice(3);
  if (!rest) {
    return [];
  }
  return rest
    .split("/")
    .filter((seg) => seg.length > 0)
    .map((seg) => decodeURIComponent(seg) as ID);
}

export function buildNodeRouteUrl(rootNode: LongID, scrollToId?: ID): string {
  const base = `/r/${encodeURIComponent(rootNode)}`;
  return scrollToId ? `${base}#${encodeURIComponent(scrollToId)}` : base;
}

export function parseNodeRouteUrl(pathname: string): LongID | undefined {
  const match = pathname.match(/^\/r\/(.+)$/);
  if (!match) {
    return undefined;
  }
  return decodeURIComponent(match[1]) as LongID;
}

export function parseAuthorFromSearch(search: string): PublicKey | undefined {
  const params = new URLSearchParams(search);
  const author = params.get("author");
  return author ? (author as PublicKey) : undefined;
}

export function urlToPane(
  pathname: string,
  search: string,
  fallbackAuthor: PublicKey
): Pane {
  const author = parseAuthorFromSearch(search) || fallbackAuthor;
  const nodeID = parseNodeRouteUrl(pathname);
  if (nodeID) {
    return {
      id: generatePaneId(),
      stack: [],
      author: fallbackAuthor,
      rootNodeId: nodeID,
    };
  }
  return {
    id: generatePaneId(),
    stack: pathToStack(pathname),
    author,
  };
}
