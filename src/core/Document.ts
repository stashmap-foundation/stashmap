import { Map as ImmutableMap } from "immutable";
import { LOCAL } from "./nodeRef";
import { getNode } from "./connections";
import { ensureKnowstrDocId } from "./knowstrFrontmatter";
import { MarkdownTreeNode, parseMarkdown } from "./markdownTree";
import {
  MaterializeOptions,
  MaterializeResult,
  WalkContext,
  materializeTree,
  materializeTreePreservingExplicitIds,
} from "./markdownNodes";
import { nodeText, spansText } from "./nodeSpans";
import { LOG_ROOT_FILE, LOG_ROOT_ROLE } from "./systemRoots";

export type Document = {
  author: SourceId;
  docId: string;
  topNodeShortIds: string[];
  updatedMs: number;
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
  author: SourceId;
  docId: string;
  deletedAt: number;
};

export type ParseToDocumentOptions = {
  filePath?: string;
  relativePath?: string;
  fallbackTitle?: string;
  // Used when the parsed content has no knowstr_doc_id in frontmatter.
  // The filesystem watcher passes the existing doc's id so that an edit
  // which strips the frontmatter does not change the document's identity.
  // If frontmatter already has knowstr_doc_id, it wins.
  docIdFallback?: string;
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

export function getDocumentByIdOrFilePath(
  documents: ImmutableMap<string, Document>,
  documentByFilePath: ImmutableMap<string, Document>,
  author: SourceId,
  idOrFilePath: string
): Document | undefined {
  const documentById = documents.get(documentKeyOf(author, idOrFilePath));
  if (documentById) {
    return documentById;
  }
  const documentByPath = documentByFilePath.get(idOrFilePath);
  return documentByPath?.author === author ? documentByPath : undefined;
}

export function getDocumentForNode(
  knowledgeDBs: KnowledgeDBs,
  documents: ImmutableMap<string, Document>,
  node: GraphNode,
  sourceId: SourceId
): Document | undefined {
  const rootNode =
    node.id === node.root ? node : getNode(knowledgeDBs, node.root, sourceId);
  const docId = node.docId ?? rootNode?.docId;
  return docId ? documents.get(documentKeyOf(sourceId, docId)) : undefined;
}

function basenameWithoutMarkdownExtension(path: string): string {
  const pieces = path.split(/[\\/]/u);
  const filename = pieces[pieces.length - 1] ?? path;
  return filename.endsWith(".md") ? filename.slice(0, -3) : filename;
}

export function documentDisplayName(document: Document): string {
  const title = document.title.trim();
  if (title) {
    return title;
  }
  const filePathName = document.filePath
    ? basenameWithoutMarkdownExtension(document.filePath)
    : undefined;
  if (filePathName) {
    return filePathName;
  }
  return `Document ${document.docId.slice(0, 8)}`;
}

export function documentLinkPath(document: Document): string {
  return document.filePath ?? document.docId;
}

export function createDocumentFromRootNode(rootNode: GraphNode): Document {
  const docId = rootNode.docId ?? rootNode.id;
  return {
    author: LOCAL,
    docId,
    topNodeShortIds: [rootNode.id],
    updatedMs: rootNode.updated,
    title: nodeText(rootNode) || "Untitled",
    frontMatter: { knowstr_doc_id: docId },
    ...(rootNode.systemRole !== undefined && {
      systemRole: rootNode.systemRole,
    }),
  };
}

export function systemRoleFromFilePath(
  filePath: string | undefined
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

type TreeMaterializer = (
  trees: MarkdownTreeNode[],
  author: SourceId,
  options: MaterializeOptions
) => MaterializeResult;

function parseToDocumentWithMaterializer(
  author: SourceId,
  content: string,
  options: ParseToDocumentOptions,
  materialize: TreeMaterializer
): ParseToDocumentResult {
  const parsed = parseMarkdown(content);
  const ensured = ensureKnowstrDocId(parsed.frontMatter, options.docIdFallback);

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

  const visibleRoots = parsed.tree;
  const trees = visibleRoots.map((tree, index) => ({
    ...tree,
    docId: ensured.docId,
    ...(index === 0 && systemRole !== undefined && { systemRole }),
  }));

  const result = materialize(trees, author, {
    context: options.context,
    updatedMs,
  });
  const topNodeLongIds = result.topNodeIds;
  const topNodeShortIds = topNodeLongIds;
  const allNodes =
    result.context.knowledgeDBs.get(author)?.nodes ??
    ImmutableMap<string, GraphNode>();
  const topNodeLongIdSet = new Set(topNodeLongIds);
  const nodes =
    topNodeLongIdSet.size > 0
      ? allNodes.filter((node) => topNodeLongIdSet.has(node.root))
      : ImmutableMap<string, GraphNode>();

  const document: Document = {
    author,
    docId: ensured.docId,
    topNodeShortIds,
    updatedMs,
    title,
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

export function parseToDocument(
  author: SourceId,
  content: string,
  options: ParseToDocumentOptions = {}
): ParseToDocumentResult {
  return parseToDocumentWithMaterializer(
    author,
    content,
    options,
    materializeTree
  );
}

export function parseToDocumentPreservingExplicitIds(
  author: SourceId,
  content: string,
  options: ParseToDocumentOptions
): ParseToDocumentResult {
  return parseToDocumentWithMaterializer(
    author,
    content,
    options,
    materializeTreePreservingExplicitIds
  );
}
