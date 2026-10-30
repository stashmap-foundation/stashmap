import { bech32, hex } from "@scure/base";
import { LOCAL, pathOf, rowIdOf, rowKey, sourceAuthor } from "./nodeRef";

const SAME_AUTHOR = "_";
const ADDRESS_SCHEME = "knowstr:";
const THING_SCHEMES = ["wikidata:", "rgb:"];
const WEBSITE_SCHEMES = ["https:", "http:"];
const WEBCAL_SCHEME = "webcal:";

const ROW_ID_RE = /^[A-Za-z0-9._-]+$/u;
const FORBIDDEN_PATH_CHARS_RE = /[:#?%\\]/u;

export function isValidRowId(id: string): boolean {
  return ROW_ID_RE.test(id) && !id.includes("--");
}

export function isValidPath(path: string): boolean {
  const segments = path.split("/");
  return (
    path.endsWith(".md") &&
    path.normalize("NFC") === path &&
    !FORBIDDEN_PATH_CHARS_RE.test(path) &&
    segments.every(
      (segment) => segment !== "" && segment !== "." && segment !== ".."
    )
  );
}

export function isThingAddress(id: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/iu.test(pathOf(id));
}

function parseAddress(href: string, fromPath: string): URL | undefined {
  try {
    return new URL(href, `${ADDRESS_SCHEME}//${SAME_AUTHOR}/${fromPath}`);
  } catch {
    return undefined;
  }
}

type AddressParts = {
  author: string;
  path: string;
  rowId: string | undefined;
};

function decodedPath(pathname: string): string | undefined {
  try {
    return decodeURIComponent(pathname.replace(/^\//u, "")).normalize("NFC");
  } catch {
    return undefined;
  }
}

function addressParts(url: URL): AddressParts | undefined {
  if (url.protocol !== ADDRESS_SCHEME || url.search !== "") {
    return undefined;
  }
  const path = decodedPath(url.pathname);
  const rowId = url.hash === "" ? undefined : url.hash.slice(1);
  if (path === undefined || (rowId !== undefined && !isValidRowId(rowId))) {
    return undefined;
  }
  return { author: url.host, path, rowId };
}

export function classifyLinkHref(
  href: string
):
  | "node"
  | "file"
  | "person"
  | "thing"
  | "calendar"
  | "feed"
  | "website"
  | "unsupported" {
  const url = parseAddress(href, "x.md");
  if (!url || href.trim() !== href || href === "") return "unsupported";
  if (THING_SCHEMES.includes(url.protocol)) {
    return url.pathname === "" ? "unsupported" : "thing";
  }
  if (WEBSITE_SCHEMES.includes(url.protocol)) return "website";
  if (url.protocol === WEBCAL_SCHEME) {
    return url.hash === "" ? "feed" : "calendar";
  }
  const parts = addressParts(url);
  if (!parts || (href.startsWith("#") && parts.rowId === undefined)) {
    return "unsupported";
  }
  if (parts.path === "" && parts.author !== SAME_AUTHOR) {
    return parts.rowId === undefined ? "person" : "unsupported";
  }
  if (!isValidPath(parts.path)) return "unsupported";
  return parts.rowId === undefined ? "file" : "node";
}

export function isEmbeddableHref(href: string): boolean {
  const targetClass = classifyLinkHref(href);
  return (
    targetClass === "node" ||
    targetClass === "file" ||
    targetClass === "calendar" ||
    targetClass === "feed"
  );
}

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/u;

export function authorPubkeyOf(sourceId: SourceId): string | undefined {
  const author = sourceAuthor(sourceId);
  return HEX_PUBKEY_RE.test(author) ? author : undefined;
}

function npubAuthor(npub: string): string | undefined {
  const decoded = bech32.decodeUnsafe(npub, 90);
  const bytes = decoded ? bech32.fromWordsUnsafe(decoded.words) : undefined;
  return decoded?.prefix === "npub" && bytes?.length === 32
    ? hex.encode(bytes)
    : undefined;
}

function authorNpub(pubkey: string): string {
  return bech32.encode("npub", bech32.toWords(hex.decode(pubkey)), 90);
}

function authorSourceId(
  author: string,
  from: NodeRef,
  path: string
): SourceId | undefined {
  if (author === SAME_AUTHOR) {
    return path === pathOf(from.id)
      ? from.sourceId
      : sourceAuthor(from.sourceId);
  }
  return npubAuthor(author);
}

export function resolveLink(href: string, from: NodeRef): NodeRef | undefined {
  const targetClass = classifyLinkHref(href);
  if (targetClass === "thing" || targetClass === "calendar") {
    return { sourceId: LOCAL, id: href };
  }
  if (targetClass !== "node" && targetClass !== "file") {
    return undefined;
  }
  const url = parseAddress(href, pathOf(from.id));
  const parts = url ? addressParts(url) : undefined;
  if (!parts) return undefined;
  const sourceId = authorSourceId(parts.author, from, parts.path);
  if (!sourceId) return undefined;
  return {
    sourceId,
    id:
      parts.rowId === undefined ? parts.path : rowKey(parts.path, parts.rowId),
  };
}

export function thingTagOf(href: string): string | undefined {
  const targetClass = classifyLinkHref(href);
  if (targetClass === "thing") return href;
  if (
    targetClass !== "website" &&
    targetClass !== "feed" &&
    targetClass !== "calendar"
  ) {
    return undefined;
  }
  const url = new URL(href);
  return `${url.protocol}//${url.host}${url.pathname}${url.search}`;
}

function relativePath(fromPath: string, toPath: string): string {
  const fromDirs = fromPath.split("/").slice(0, -1);
  const toParts = toPath.split("/");
  const shared = fromDirs.findIndex((dir, index) => toParts[index] !== dir);
  const common =
    shared < 0 ? Math.min(fromDirs.length, toParts.length - 1) : shared;
  return [
    ...fromDirs.slice(common).map(() => ".."),
    ...toParts.slice(common),
  ].join("/");
}

function encodePath(path: string): string {
  return path.replace(/[\s()<>]/gu, (char) => encodeURIComponent(char));
}

export function linkHref(target: NodeRef, from: NodeRef): string {
  if (isThingAddress(target.id)) {
    return target.id;
  }
  const targetPath = pathOf(target.id);
  const fragment = target.id.includes("#") ? `#${rowIdOf(target.id)}` : "";
  const targetAuthor = authorPubkeyOf(target.sourceId);
  const sameAuthor =
    target.sourceId === from.sourceId ||
    (targetAuthor !== undefined &&
      targetAuthor === authorPubkeyOf(from.sourceId));
  if (!sameAuthor && targetAuthor !== undefined) {
    return `//${authorNpub(targetAuthor)}/${encodePath(targetPath)}${fragment}`;
  }
  if (targetPath === pathOf(from.id) && fragment !== "") {
    return fragment;
  }
  return `${encodePath(relativePath(pathOf(from.id), targetPath))}${fragment}`;
}

export function feedHttpsUrl(href: string): string {
  return href.replace(/^webcal:\/\//iu, "https://");
}

export function externalLinkUrl(href: string): string | undefined {
  const targetClass = classifyLinkHref(href);
  if (targetClass === "website") return href;
  return targetClass === "feed" ? feedHttpsUrl(href) : undefined;
}
