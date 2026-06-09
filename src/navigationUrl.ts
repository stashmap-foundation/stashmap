export function buildNodeRouteUrl(
  rootNode: LongID,
  sourceId: SourceId,
  scrollToId?: ID
): string {
  const base = `/r/${encodeURIComponent(rootNode)}?source=${encodeURIComponent(
    sourceId
  )}`;
  return scrollToId ? `${base}#${encodeURIComponent(scrollToId)}` : base;
}

export function buildDocumentRouteUrl(
  author: PublicKey,
  docId: string,
  scrollToId?: string
): string {
  const base = `/d/${encodeURIComponent(author)}/${encodeURIComponent(docId)}`;
  return scrollToId ? `${base}#${encodeURIComponent(scrollToId)}` : base;
}

export function parseNodeRouteUrl(pathname: string): LongID | undefined {
  const match = pathname.match(/^\/r\/(.+)$/);
  if (!match) {
    return undefined;
  }
  return decodeURIComponent(match[1]) as LongID;
}

export function parseDocumentRouteUrl(
  pathname: string
): { author: PublicKey; docId: string } | undefined {
  const match = pathname.match(/^\/d\/([^/]+)\/(.+)$/);
  if (!match) {
    return undefined;
  }
  return {
    author: decodeURIComponent(match[1] as string) as PublicKey,
    docId: decodeURIComponent(match[2] as string),
  };
}

export function parseSourceFromSearch(search: string): SourceId | undefined {
  const params = new URLSearchParams(search);
  const sourceId = params.get("source");
  return sourceId || undefined;
}
