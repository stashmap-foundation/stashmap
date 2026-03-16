import { getTextForSemanticID } from "./semanticProjection";

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

export {
  buildNodeRouteUrl,
  parseAuthorFromSearch,
  parseNodeRouteUrl,
  pathToStack,
} from "./session/navigation";

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
