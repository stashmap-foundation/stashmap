import { getTextForSemanticID, hashText } from "./connections";

function stackToPath(
  stack: ID[],
  knowledgeDBs: KnowledgeDBs,
  author: PublicKey
): string | undefined {
  if (stack.length === 0) {
    return "/";
  }
  const segments = stack.reduce<string[] | undefined>((acc, semanticID) => {
    if (!acc) {
      return undefined;
    }
    const text = getTextForSemanticID(knowledgeDBs, semanticID, author);
    if (!text) {
      return undefined;
    }
    return [...acc, encodeURIComponent(text)];
  }, []);
  if (!segments) {
    return undefined;
  }
  return `/n/${segments.join("/")}`;
}

export function pathToStack(pathname: string): ID[] {
  if (!pathname.startsWith("/n/")) {
    return [];
  }
  const rest = pathname.slice(3);
  if (!rest) {
    return [];
  }
  return rest
    .split("/")
    .filter((seg) => seg.length > 0)
    .map((seg) => hashText(decodeURIComponent(seg)));
}

export function buildNodeUrl(
  stack: ID[],
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey,
  author?: PublicKey
): string | undefined {
  const effectiveAuthor = author || myself;
  const path = stackToPath(stack, knowledgeDBs, effectiveAuthor);
  if (!path) {
    return undefined;
  }
  if (author && author !== myself) {
    return `${path}?author=${author}`;
  }
  return path;
}

export function buildRelationUrl(
  rootRelation: LongID,
  scrollToId?: LongID | ID
): string {
  const base = `/r/${encodeURIComponent(rootRelation)}`;
  return scrollToId ? `${base}#${encodeURIComponent(scrollToId)}` : base;
}

export function parseRelationUrl(pathname: string): LongID | undefined {
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
