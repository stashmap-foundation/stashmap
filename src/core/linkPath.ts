export const ENTITY_SCHEME_RE = /^(asset:|wd:|isbn:|doi:)/u;

export function isEntityId(id: string): boolean {
  return ENTITY_SCHEME_RE.test(id);
}

export function isEntityLinkHref(href: string): boolean {
  return href.startsWith("#") && isEntityId(href.slice(1));
}

export function isMarkdownPath(href: string): boolean {
  if (href.startsWith("#")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
  return /\.md$/i.test(href);
}

// The typed document reference: `doc:<docId>` in href position. The payload
// is opaque; readers dispatch on the scheme, never on id shape.
export function docLinkId(href: string): string | undefined {
  return href.startsWith("doc:") ? href.slice("doc:".length) : undefined;
}

export function classifyLinkHref(href: string) {
  if (isEntityLinkHref(href)) return "entity";
  if (href.startsWith("#ical:")) return "calendar";
  if (href.startsWith("#") && href.length > 1) return "node";
  if (/^feed:https?:\/\//u.test(href)) return "feed";
  if (/^https?:\/\//u.test(href)) return "website";
  const fragmentIndex = href.indexOf("#");
  const path = fragmentIndex < 0 ? href : href.slice(0, fragmentIndex);
  if (docLinkId(path)) return "document";
  if (isMarkdownPath(path)) return "file";
  return "unsupported";
}

export function externalLinkUrl(href: string): string | undefined {
  const targetClass = classifyLinkHref(href);
  if (targetClass === "website") return href;
  return targetClass === "feed" ? href.slice("feed:".length) : undefined;
}

export function documentLinkHref(
  docId: string,
  filePath: string | undefined
): string {
  return filePath ?? `doc:${docId}`;
}

export function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}

function normalizeSegments(parts: string[]): string[] {
  return parts.reduce<string[]>((acc, part) => {
    if (part === "" || part === ".") return acc;
    if (part === "..") {
      if (acc.length > 0 && acc[acc.length - 1] !== "..") {
        return acc.slice(0, -1);
      }
      return [...acc, ".."];
    }
    return [...acc, part];
  }, []);
}

function dirnamePosix(p: string): string {
  const slash = p.lastIndexOf("/");
  if (slash < 0) return ".";
  if (slash === 0) return "/";
  return p.slice(0, slash);
}

function normalizePosix(p: string): string {
  const isAbsolute = p.startsWith("/");
  const segments = normalizeSegments(p.split("/"));
  const joined = segments.join("/");
  if (isAbsolute) return `/${joined}`;
  return joined === "" ? "." : joined;
}

export function resolveLinkPath(
  linkPath: string,
  sourceFilePath: string | undefined
): string {
  const link = toPosixPath(linkPath);
  if (!sourceFilePath) {
    return normalizePosix(link);
  }
  const sourceDir = dirnamePosix(toPosixPath(sourceFilePath));
  const combined = sourceDir === "." ? link : `${sourceDir}/${link}`;
  return normalizePosix(combined);
}

export function fileLinkIndexKey(
  author: SourceId,
  normalizedPath: string
): string {
  return `${author}:${normalizedPath}`;
}

export function fileLinkIndexPath(
  path: string,
  sourceFilePath: string | undefined
): string {
  return docLinkId(path) ?? resolveLinkPath(path, sourceFilePath);
}
