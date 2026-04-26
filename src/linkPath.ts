import * as path from "path";

export function isMarkdownPath(href: string): boolean {
  if (href.startsWith("#")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
  return /\.md$/i.test(href);
}

export function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

export function resolveLinkPath(
  linkPath: string,
  sourceFilePath: string | undefined
): string {
  const link = toPosixPath(linkPath);
  if (!sourceFilePath) {
    return path.posix.normalize(link);
  }
  const sourceDir = path.posix.dirname(toPosixPath(sourceFilePath));
  return path.posix.normalize(path.posix.join(sourceDir, link));
}

export function fileLinkIndexKey(
  author: PublicKey,
  normalizedPath: string
): string {
  return `${author}:${normalizedPath}`;
}
