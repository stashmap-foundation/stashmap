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
