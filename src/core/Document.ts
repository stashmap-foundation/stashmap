import { Map as ImmutableMap } from "immutable";
import { shortID } from "./connections";
import { ensureKnowstrDocId } from "./knowstrFrontmatter";
import { parseMarkdown } from "./markdownTree";
import { WalkContext, materializeTree } from "./markdownNodes";
import { spansText } from "./nodeSpans";
import { LOG_ROOT_FILE, LOG_ROOT_ROLE } from "./systemRoots";

export type Document = {
  author: PublicKey;
  docId: string;
  rootShortId?: string;
  updatedMs: number;
  content: string;
  title: string;
  frontMatter?: FrontMatter;
  filePath?: string;
  relativePath?: string;
  systemRole?: RootSystemRole;
};

export type ParsedDocument = {
  document: Document;
  nodes: ImmutableMap<string, GraphNode>;
};

export type DocumentDelete = {
  author: PublicKey;
  docId: string;
  deletedAt: number;
};

export type ParseToDocumentOptions = {
  filePath?: string;
  relativePath?: string;
  fallbackTitle?: string;
  updatedMsOverride?: number;
  systemRoleOverride?: RootSystemRole;
  context?: WalkContext;
};

export type ParseToDocumentResult = {
  document: Document;
  nodes: ImmutableMap<string, GraphNode>;
  context: WalkContext;
};

export function documentKeyOf(author: PublicKey, docId: string): string {
  return `${author}:${docId}`;
}

export function systemRoleFromFilePath(
  filePath: string | undefined
): RootSystemRole | undefined {
  return filePath === LOG_ROOT_FILE ? LOG_ROOT_ROLE : undefined;
}

function firstTopLevelNodeText(
  tree: ReadonlyArray<{ spans: InlineSpan[]; hidden?: boolean }>
): string | undefined {
  const root = tree.find((node) => !node.hidden);
  if (!root) return undefined;
  const text = spansText(root.spans);
  return text || undefined;
}

export function parseToDocument(
  author: PublicKey,
  content: string,
  options: ParseToDocumentOptions = {}
): ParseToDocumentResult {
  const parsed = parseMarkdown(content);
  const ensured = ensureKnowstrDocId(parsed.frontMatter);

  const updatedMs = options.updatedMsOverride ?? Date.now();
  const systemRole =
    options.systemRoleOverride ?? systemRoleFromFilePath(options.filePath);

  const frontMatterTitle =
    typeof parsed.frontMatter?.title === "string"
      ? (parsed.frontMatter.title as string)
      : undefined;
  const title =
    frontMatterTitle ??
    options.fallbackTitle ??
    firstTopLevelNodeText(parsed.tree) ??
    "Untitled";

  const trees = parsed.tree.map((tree, index) =>
    index === 0
      ? {
          ...tree,
          docId: ensured.docId,
          ...(systemRole !== undefined && { systemRole }),
        }
      : tree
  );

  const result = materializeTree(trees, author, {
    context: options.context,
    updatedMs,
  });
  const rootLongId = result.topNodeIds[0];
  const rootShortId = rootLongId ? shortID(rootLongId) : undefined;
  const allNodes =
    result.context.knowledgeDBs.get(author)?.nodes ??
    ImmutableMap<string, GraphNode>();
  const nodes = rootLongId
    ? allNodes.filter((node) => node.root === rootLongId)
    : ImmutableMap<string, GraphNode>();

  const document: Document = {
    author,
    docId: ensured.docId,
    updatedMs,
    content,
    title,
    ...(rootShortId !== undefined && { rootShortId }),
    ...(ensured.frontMatter && { frontMatter: ensured.frontMatter }),
    ...(options.filePath !== undefined && { filePath: options.filePath }),
    ...(options.relativePath !== undefined && {
      relativePath: options.relativePath,
    }),
    ...(systemRole !== undefined && { systemRole }),
  };

  return {
    document,
    nodes,
    context: result.context,
  };
}
