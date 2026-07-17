import { nip19 } from "nostr-tools";
import { LOCAL } from "./core/nodeRef";
import {
  decodePublicKeyInputSync,
  encodePublicKeyAddress,
} from "./infra/nostr/publicKeys";
import { KIND_KNOWLEDGE_DEPOSIT, KIND_KNOWLEDGE_DOCUMENT } from "./nostr";
import { sanitizeRelayUrl } from "./relayUtils";

export const MAX_ROUTE_RELAY_HINTS = 3;

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

function normalizedRelayHints(relays: readonly string[]): string[] {
  return [
    ...new Set(
      relays
        .map((relay) => sanitizeRelayUrl(relay))
        .filter((relay): relay is string => relay !== undefined)
    ),
  ].slice(0, MAX_ROUTE_RELAY_HINTS);
}

export function routeCoordinateSourceId(coordinate: RouteCoordinate): SourceId {
  return `${coordinate.eventKind}:${coordinate.pubkey}:${coordinate.dTag}`;
}

function sourceCoordinate(sourceId: SourceId): RouteCoordinate | undefined {
  const [kindText, pubkeyText, ...dParts] = sourceId.split(":");
  const dTag = dParts.join(":");
  const kind = Number(kindText);
  if (
    (kind !== KIND_KNOWLEDGE_DOCUMENT && kind !== KIND_KNOWLEDGE_DEPOSIT) ||
    !dTag
  ) {
    return undefined;
  }
  const pubkey = decodePublicKeyInputSync(pubkeyText);
  if (!pubkey) {
    return undefined;
  }
  return { eventKind: kind, pubkey, dTag, relays: [] };
}

export function buildCoordinateRouteUrl(
  prefix: "storage" | "deposit",
  coordinate: RouteCoordinate,
  at: ID | undefined,
  storageKey: string | undefined
): string {
  const naddr = nip19.naddrEncode({
    kind: coordinate.eventKind,
    pubkey: coordinate.pubkey,
    identifier: coordinate.dTag,
    relays: normalizedRelayHints(coordinate.relays),
  });
  const params = new URLSearchParams();
  if (at !== undefined) {
    params.set("at", at);
  }
  const query = params.toString();
  const fragment = storageKey ? `#key=${encodeURIComponent(storageKey)}` : "";
  return `/${prefix}/${naddr}${query ? `?${query}` : ""}${fragment}`;
}

function storageCoordinate(
  author: SourceId,
  docId: string
): RouteCoordinate | undefined {
  const pubkey = decodePublicKeyInputSync(author);
  if (!pubkey) {
    return undefined;
  }
  return {
    eventKind: KIND_KNOWLEDGE_DOCUMENT,
    pubkey,
    dTag: docId,
    relays: [],
  };
}

export function buildNodeRouteUrl(
  rootNode: ID,
  sourceId: SourceId,
  options: NodeRouteOptions
): string {
  if (sourceId === LOCAL) {
    const params = new URLSearchParams();
    if (options.scrollToId !== undefined) {
      params.set("at", options.scrollToId);
    }
    if (options.fallbackLabel !== undefined && options.fallbackLabel !== "") {
      params.set("label", options.fallbackLabel);
    }
    const query = params.toString();
    return `/local/n/${encodeURIComponent(rootNode)}${
      query ? `?${query}` : ""
    }`;
  }
  const coordinate =
    sourceCoordinate(sourceId) ?? storageCoordinate(sourceId, rootNode);
  if (!coordinate) {
    return `/local/n/${encodeURIComponent(rootNode)}`;
  }
  const prefix =
    coordinate.eventKind === KIND_KNOWLEDGE_DEPOSIT ? "deposit" : "storage";
  return buildCoordinateRouteUrl(prefix, coordinate, rootNode, undefined);
}

export function buildDocumentRouteUrl(
  author: SourceId,
  docId: string,
  scrollToId?: string
): string {
  if (author === LOCAL) {
    const params = new URLSearchParams();
    if (scrollToId !== undefined) {
      params.set("at", scrollToId);
    }
    const query = params.toString();
    return `/local/d/${encodeURIComponent(docId)}${query ? `?${query}` : ""}`;
  }
  const coordinate =
    sourceCoordinate(author) ?? storageCoordinate(author, docId);
  if (!coordinate) {
    return `/local/d/${encodeURIComponent(docId)}`;
  }
  const prefix =
    coordinate.eventKind === KIND_KNOWLEDGE_DEPOSIT ? "deposit" : "storage";
  return buildCoordinateRouteUrl(prefix, coordinate, scrollToId, undefined);
}

export function parseNodeRouteUrl(pathname: string): ID | undefined {
  const match = pathname.match(/^\/local\/n\/(.+)$/u);
  if (!match) {
    return undefined;
  }
  return decodeURIComponent(match[1]);
}

export function parseDocumentRouteUrl(
  pathname: string
): { address: SourceId; docId: string } | undefined {
  const match = pathname.match(/^\/local\/d\/(.+)$/u);
  if (!match) {
    return undefined;
  }
  return {
    address: LOCAL,
    docId: decodeURIComponent(match[1]),
  };
}

export function parseCoordinateRouteUrl(
  pathname: string,
  prefix: "storage" | "deposit"
): RouteCoordinate | undefined {
  const match = pathname.match(new RegExp(`^/${prefix}/(.+)$`, "u"));
  if (!match) {
    return undefined;
  }
  try {
    const decoded = nip19.decode(decodeURIComponent(match[1]));
    if (decoded.type !== "naddr") {
      return undefined;
    }
    const expectedKind =
      prefix === "storage" ? KIND_KNOWLEDGE_DOCUMENT : KIND_KNOWLEDGE_DEPOSIT;
    if (decoded.data.kind !== expectedKind) {
      return undefined;
    }
    const pubkey = decodePublicKeyInputSync(decoded.data.pubkey);
    if (!pubkey || decoded.data.identifier === "") {
      return undefined;
    }
    return {
      eventKind: decoded.data.kind,
      pubkey,
      dTag: decoded.data.identifier,
      relays: normalizedRelayHints(decoded.data.relays ?? []),
    };
  } catch {
    return undefined;
  }
}

export function parseSourceFromSearch(search: string): SourceId | undefined {
  return search === "" ? undefined : undefined;
}

export function parseFallbackLabelFromSearch(
  search: string
): string | undefined {
  const params = new URLSearchParams(search);
  const fallbackLabel = params.get("label");
  return fallbackLabel || undefined;
}

export function parseAtFromSearch(search: string): ID | undefined {
  const params = new URLSearchParams(search);
  const at = params.get("at");
  return at || undefined;
}

export function parseStorageKeyFromHash(hash: string): string | undefined {
  const match = hash.match(/^#key=(.+)$/u);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export function buildShareRouteUrl(
  author: SourceId,
  docId: string,
  storageKey: string
): string {
  const coordinate = storageCoordinate(author, docId);
  if (!coordinate) {
    return `/local/d/${encodeURIComponent(docId)}#key=${encodeURIComponent(
      storageKey
    )}`;
  }
  return buildCoordinateRouteUrl("storage", coordinate, undefined, storageKey);
}
