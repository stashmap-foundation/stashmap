export function isMarkdownPath(href: string): boolean {
  if (href.startsWith("#")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
  return /\.md$/i.test(href);
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
  author: PublicKey,
  normalizedPath: string
): string {
  return `${author}:${normalizedPath}`;
}
