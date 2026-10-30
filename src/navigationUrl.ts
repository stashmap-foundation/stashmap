import { nip19 } from "nostr-tools";
import { LOCAL, pathOf, rowIdOf, rowKey } from "./core/nodeRef";
import { isThingAddress } from "./core/linkPath";
import {
  decodePublicKeyInputSync,
  encodePublicKeyAddress,
} from "./infra/nostr/publicKeys";
import { KIND_KNOWLEDGE_DEPOSIT, KIND_KNOWLEDGE_DOCUMENT } from "./nostr";
import { normalizeRelayHintUrl } from "./workspaceConfig";

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
        .map((relay) => normalizeRelayHintUrl(relay))
        .filter((relay): relay is string => relay !== undefined)
    ),
  ].slice(0, MAX_ROUTE_RELAY_HINTS);
}

export function routeCoordinateSourceId(coordinate: RouteCoordinate): SourceId {
  return `${coordinate.eventKind}:${coordinate.pubkey}:${coordinate.dTag}`;
}

export function sourceCoordinate(
  sourceId: SourceId
): RouteCoordinate | undefined {
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
    params.set("at", rowIdOf(at));
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

function fileCoordinate(
  author: SourceId,
  path: string,
  routeCoordinate: RouteCoordinate | undefined
): RouteCoordinate | undefined {
  const known = routeCoordinate ?? sourceCoordinate(author);
  if (known) {
    return { ...known, dTag: path };
  }
  const pubkey = decodePublicKeyInputSync(author);
  return pubkey
    ? { eventKind: KIND_KNOWLEDGE_DEPOSIT, pubkey, dTag: path, relays: [] }
    : undefined;
}

function coordinatePrefix(coordinate: RouteCoordinate): "deposit" | "storage" {
  return coordinate.eventKind === KIND_KNOWLEDGE_DEPOSIT
    ? "deposit"
    : "storage";
}

export function buildDocumentRouteUrl(
  author: SourceId,
  docId: string,
  routeCoordinate?: RouteCoordinate
): string {
  const coordinate =
    author === LOCAL
      ? undefined
      : fileCoordinate(author, docId, routeCoordinate);
  return coordinate
    ? buildCoordinateRouteUrl(
        coordinatePrefix(coordinate),
        coordinate,
        undefined,
        undefined
      )
    : `/local/d/${encodeURIComponent(docId)}`;
}

export function buildNodeRouteUrl(
  rootNode: ID,
  sourceId: SourceId,
  options: NodeRouteOptions,
  routeCoordinate?: RouteCoordinate
): string {
  if (isThingAddress(rootNode)) {
    const label =
      options.fallbackLabel !== undefined && options.fallbackLabel !== ""
        ? `?${new URLSearchParams({ label: options.fallbackLabel }).toString()}`
        : "";
    return `/local/n/${encodeURIComponent(rootNode)}${label}`;
  }
  const coordinate =
    sourceId === LOCAL
      ? undefined
      : fileCoordinate(sourceId, pathOf(rootNode), routeCoordinate);
  if (!coordinate) {
    return `/local/d/${encodeURIComponent(
      pathOf(rootNode)
    )}?${new URLSearchParams({ at: rowIdOf(rootNode) }).toString()}`;
  }
  return buildCoordinateRouteUrl(
    coordinatePrefix(coordinate),
    coordinate,
    options.scrollToId ?? rootNode,
    undefined
  );
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
  storageKey: string,
  relays: readonly string[]
): string {
  const rawCoordinate = storageCoordinate(author, docId);
  const coordinate = rawCoordinate
    ? { ...rawCoordinate, relays: normalizedRelayHints(relays) }
    : undefined;
  if (!coordinate) {
    return `/local/d/${encodeURIComponent(docId)}#key=${encodeURIComponent(
      storageKey
    )}`;
  }
  return buildCoordinateRouteUrl("storage", coordinate, undefined, storageKey);
}

function parseThingRouteUrl(pathname: string): ID | undefined {
  const match = pathname.match(/^\/local\/n\/(.+)$/u);
  const thing = match ? decodeURIComponent(match[1]) : undefined;
  return thing !== undefined && isThingAddress(thing) ? thing : undefined;
}

function parseDocumentRouteUrl(pathname: string): string | undefined {
  const match = pathname.match(/^\/local\/d\/(.+)$/u);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function coordinatePane(
  coordinate: RouteCoordinate,
  sourceId: SourceId,
  at: string | undefined
): Omit<Pane, "id"> {
  return {
    sourceId,
    routeCoordinate: coordinate,
    ...(at === undefined
      ? { documentId: coordinate.dTag }
      : { rootNodeId: rowKey(coordinate.dTag, at) }),
  };
}

export function routePane(
  url: { pathname: string; search: string; hash: string },
  myPublicKey: PublicKey | undefined
): Omit<Pane, "id"> | undefined {
  const at = parseAtFromSearch(url.search);
  const path = parseDocumentRouteUrl(url.pathname);
  if (path !== undefined) {
    return at === undefined
      ? { sourceId: LOCAL, documentId: path }
      : { sourceId: LOCAL, rootNodeId: rowKey(path, at) };
  }
  const storageRoute = parseCoordinateRouteUrl(url.pathname, "storage");
  if (storageRoute) {
    const storageKey = parseStorageKeyFromHash(url.hash);
    return {
      ...coordinatePane(
        storageRoute,
        resolveAddress(storageRoute.pubkey, myPublicKey),
        at
      ),
      ...(storageKey !== undefined && { storageKey }),
    };
  }
  const depositRoute = parseCoordinateRouteUrl(url.pathname, "deposit");
  if (depositRoute) {
    return coordinatePane(
      depositRoute,
      routeCoordinateSourceId(depositRoute),
      at
    );
  }
  const thing = parseThingRouteUrl(url.pathname);
  if (thing !== undefined) {
    const fallbackLabel = parseFallbackLabelFromSearch(url.search);
    return {
      sourceId: LOCAL,
      rootNodeId: thing,
      ...(fallbackLabel !== undefined && { fallbackLabel }),
    };
  }
  return undefined;
}
