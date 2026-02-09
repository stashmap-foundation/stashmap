import { hashText } from "./connections";
import { getNodeFromID } from "./ViewContext";

function stackToPath(
  stack: ID[],
  knowledgeDBs: KnowledgeDBs,
  myself: PublicKey
): string | undefined {
  if (stack.length === 0) {
    return "/";
  }
  const segments = stack.reduce<string[] | undefined>((acc, nodeID) => {
    if (!acc) {
      return undefined;
    }
    const node = getNodeFromID(knowledgeDBs, nodeID, myself);
    if (!node?.text) {
      return undefined;
    }
    return [...acc, encodeURIComponent(node.text)];
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
  const path = stackToPath(stack, knowledgeDBs, myself);
  if (!path) {
    return undefined;
  }
  if (author && author !== myself) {
    return `${path}?author=${author}`;
  }
  return path;
}

export function buildRelationUrl(rootRelation: LongID): string {
  return `/r/${encodeURIComponent(rootRelation)}`;
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
