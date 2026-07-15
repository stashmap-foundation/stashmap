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

export type NodeRouteOptions = {
  scrollToId: ID | undefined;
  fallbackLabel: string | undefined;
};

export function buildNodeRouteUrl(
  rootNode: ID,
  sourceId: SourceId,
  options: NodeRouteOptions
): string {
  const params = new URLSearchParams();
  params.set("source", sourceId);
  if (options.fallbackLabel !== undefined && options.fallbackLabel !== "") {
    params.set("fallbackLabel", options.fallbackLabel);
  }
  const base = `/r/${encodeURIComponent(rootNode)}?${params.toString()}`;
  return options.scrollToId
    ? `${base}#${encodeURIComponent(options.scrollToId)}`
    : base;
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
): { address: SourceId; docId: string } | undefined {
  const match = pathname.match(/^\/d\/([^/]+)\/(.+)$/);
  if (!match) {
    return undefined;
  }
  return {
    address: decodeURIComponent(match[1] as string),
    docId: decodeURIComponent(match[2] as string),
  };
}

export function parseSourceFromSearch(search: string): SourceId | undefined {
  const params = new URLSearchParams(search);
  const sourceId = params.get("source");
  return sourceId || undefined;
}

export function parseFallbackLabelFromSearch(
  search: string
): string | undefined {
  const params = new URLSearchParams(search);
  const fallbackLabel = params.get("fallbackLabel");
  return fallbackLabel || undefined;
}

// Capability links carry the document's storage key in the fragment so it
// never leaves the browser: `/d/<author>/<docId>#key=<storage key>`. A
// fragment not starting with `key=` remains a scroll target.
export function parseStorageKeyFromHash(hash: string): string | undefined {
  const match = hash.match(/^#key=(.+)$/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export function buildShareRouteUrl(
  author: SourceId,
  docId: string,
  storageKey: string
): string {
  return `${buildDocumentRouteUrl(author, docId)}#key=${encodeURIComponent(
    storageKey
  )}`;
}
