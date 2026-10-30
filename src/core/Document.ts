import { Map as ImmutableMap } from "immutable";
import { LOCAL, pathOf } from "./nodeRef";
import { parseMarkdown } from "./markdownTree";
import { WalkContext, materializeTree } from "./markdownNodes";
import { nodeText, spansText } from "./nodeSpans";
import { LOG_ROOT_FILE, LOG_ROOT_ROLE } from "./systemRoots";

export type Document = {
  sourceId: SourceId;
  docId: string;
  topNodeShortIds: string[];
  updatedMs: number;
  title: string;
  frontMatter?: FrontMatter;
  systemRole?: RootSystemRole;
  // Per-document storage encryption key (nostr storage only; filesystem
  // documents never carry one). Absent until the document first rides a
  // storage event.
  storageKey?: string;
};

export type ParsedDocument = {
  document: Document;
  nodes: ImmutableMap<string, GraphNode>;
};

export type DocumentDelete = {
  sourceId: SourceId;
  docId: string;
  deletedAt: number;
};

export type ParseToDocumentOptions = {
  path: string;
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

export function documentKeyOf(sourceId: SourceId, docId: string): string {
  return `${sourceId}:${docId}`;
}

export function workspaceDocumentKey(docId: string): string {
  return documentKeyOf(LOCAL, docId);
}

export function getDocumentForNode(
  documents: ImmutableMap<string, Document>,
  node: GraphNode,
  sourceId: SourceId
): Document | undefined {
  return documents.get(documentKeyOf(sourceId, pathOf(node.id)));
}

export function fileNameTitle(path: string): string {
  const pieces = path.split("/");
  const filename = pieces[pieces.length - 1] ?? path;
  return filename.endsWith(".md") ? filename.slice(0, -3) : filename;
}

export function documentDisplayName(document: Document): string {
  return document.title.trim() || fileNameTitle(document.docId);
}

function slugify(text: string): string {
  const slug = text
    .normalize("NFC")
    .toLowerCase()
    .replace(/<!--.*?-->/gu, "")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-");
  return slug.length > 0 ? slug : "document";
}

export function newDocumentPath(
  documents: ImmutableMap<string, Document>,
  title: string
): string {
  const taken = new Set(
    documents
      .valueSeq()
      .filter((document) => document.sourceId === LOCAL)
      .map((document) => document.docId.toLowerCase())
      .toArray()
  );
  const slug = slugify(title);
  const candidate = (suffix: number): string =>
    suffix === 1 ? `${slug}.md` : `${slug}-${suffix}.md`;
  const firstFree = (suffix: number): string =>
    taken.has(candidate(suffix)) ? firstFree(suffix + 1) : candidate(suffix);
  return firstFree(1);
}

export function createDocumentFromRootNode(rootNode: GraphNode): Document {
  return {
    sourceId: LOCAL,
    docId: pathOf(rootNode.id),
    topNodeShortIds: [rootNode.id],
    updatedMs: rootNode.updated,
    title: nodeText(rootNode) || "Untitled",
    ...(rootNode.systemRole !== undefined && {
      systemRole: rootNode.systemRole,
    }),
  };
}

export function systemRoleFromFilePath(
  filePath: string
): RootSystemRole | undefined {
  return filePath === LOG_ROOT_FILE ? LOG_ROOT_ROLE : undefined;
}

function firstTopLevelNodeText(
  tree: ReadonlyArray<{ spans: InlineSpan[] }>
): string | undefined {
  const root = tree[0];
  if (!root) return undefined;
  const text = spansText(root.spans);
  return text || undefined;
}

export function parseToDocument(
  author: SourceId,
  content: string,
  options: ParseToDocumentOptions
): ParseToDocumentResult {
  const parsed = parseMarkdown(content);
  const { path } = options;
  const updatedMs = options.updatedMsOverride ?? Date.now();
  const systemRole = options.systemRoleOverride ?? systemRoleFromFilePath(path);

  const frontMatterTitleValue = parsed.frontMatter?.title;
  const frontMatterTitle =
    typeof frontMatterTitleValue === "string"
      ? frontMatterTitleValue
      : undefined;
  const title =
    frontMatterTitle ??
    options.fallbackTitle ??
    firstTopLevelNodeText(parsed.tree) ??
    "Untitled";

  const trees = parsed.tree.map((tree, index) => ({
    ...tree,
    ...(index === 0 && systemRole !== undefined && { systemRole }),
  }));

  const result = materializeTree(trees, author, path, {
    context: options.context,
    updatedMs,
  });
  const allNodes =
    result.context.knowledgeDBs.get(author)?.nodes ??
    ImmutableMap<string, GraphNode>();
  const nodes = allNodes.filter((node) => pathOf(node.id) === path);

  const document: Document = {
    sourceId: author,
    docId: path,
    topNodeShortIds: result.topNodeIds,
    updatedMs,
    title,
    ...(parsed.frontMatter && { frontMatter: parsed.frontMatter }),
    ...(systemRole !== undefined && { systemRole }),
  };

  return {
    document,
    nodes,
    context: result.context,
  };
}
