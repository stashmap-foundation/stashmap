import { LOCAL } from "./core/nodeRef";
import {
  decodePublicKeyInputSync,
  encodePublicKeyAddress,
} from "./infra/nostr/publicKeys";

export function resolveAddress(
  address: SourceId | undefined,
  myPublicKey: PublicKey | undefined
): SourceId {
  if (!address || address === LOCAL) {
    return LOCAL;
  }
  const normalized = decodePublicKeyInputSync(address) ?? address;
  if (myPublicKey !== undefined && normalized === myPublicKey) {
    return LOCAL;
  }
  return normalized;
}

export function addressForSource(
  sourceId: SourceId,
  myPublicKey: PublicKey | undefined
): string | undefined {
  if (sourceId !== LOCAL) {
    return sourceId;
  }
  return myPublicKey ? encodePublicKeyAddress(myPublicKey) : undefined;
}

export function buildNodeRouteUrl(
  rootNode: ID,
  sourceId: SourceId,
  scrollToId?: ID
): string {
  const base = `/r/${encodeURIComponent(rootNode)}?source=${encodeURIComponent(
    sourceId
  )}`;
  return scrollToId ? `${base}#${encodeURIComponent(scrollToId)}` : base;
}

export function buildDocumentRouteUrl(
  author: SourceId,
  docId: string,
  scrollToId?: string
): string {
  const base = `/d/${encodeURIComponent(author)}/${encodeURIComponent(docId)}`;
  return scrollToId ? `${base}#${encodeURIComponent(scrollToId)}` : base;
}

export function parseNodeRouteUrl(pathname: string): ID | undefined {
  const match = pathname.match(/^\/r\/(.+)$/);
  if (!match) {
    return undefined;
  }
  return decodeURIComponent(match[1]) as ID;
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
