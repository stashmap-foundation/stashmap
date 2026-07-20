import { Map as ImmutableMap } from "immutable";
import { LOCAL } from "./nodeRef";
import { getNode } from "./connections";
import {
  ensureKnowstrDocId,
  withoutPublishEntities,
} from "./knowstrFrontmatter";
import { isCanonicalId } from "./entityRecognition";
import { docLinkId, documentLinkHref, resolveLinkPath } from "./linkPath";
import { MarkdownTreeNode, parseMarkdown } from "./markdownTree";
import {
  MaterializeOptions,
  MaterializeResult,
  WalkContext,
  materializeTree,
  materializeTreePreservingExplicitIds,
} from "./markdownNodes";
import { getAllFileLinks, getAllLinks, nodeText, spansText } from "./nodeSpans";
import { LOG_ROOT_FILE, LOG_ROOT_ROLE } from "./systemRoots";

export type Document = {
  sourceId: SourceId;
  docId: string;
  topNodeShortIds: string[];
  updatedMs: number;
  title: string;
  frontMatter?: FrontMatter;
  filePath?: string;
  relativePath?: string;
  systemRole?: RootSystemRole;
  realWorldEntities: string[];
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
  return documentByPath?.sourceId === author ? documentByPath : undefined;
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

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function linkDocumentPath(path: string): string {
  const hashIndex = path.lastIndexOf("#");
  return hashIndex < 0 ? path : path.slice(0, hashIndex);
}

function sourceFilePath(
  knowledgeDBs: KnowledgeDBs,
  documents: ImmutableMap<string, Document>,
  source: GraphNode,
  sourceId: SourceId
): string | undefined {
  return getDocumentForNode(knowledgeDBs, documents, source, sourceId)
    ?.filePath;
}

export function resolveDocumentTarget(
  data: Pick<Data, "knowledgeDBs" | "documents" | "documentByFilePath">,
  source: GraphNode,
  sourceId: SourceId,
  path: string
): Document | undefined {
  const documentPath = linkDocumentPath(path);
  const docId = docLinkId(documentPath);
  if (docId !== undefined) {
    return data.documents.get(documentKeyOf(sourceId, docId));
  }
  const resolvedPath = resolveLinkPath(
    documentPath,
    sourceFilePath(data.knowledgeDBs, data.documents, source, sourceId)
  );
  return data.documentByFilePath.get(resolvedPath);
}

function linkTargetContainerRoot(
  knowledgeDBs: KnowledgeDBs,
  targetID: ID,
  sourceId: SourceId
): ID | undefined {
  const target = getNode(knowledgeDBs, targetID, sourceId);
  if (target) {
    return target.root;
  }
  return isCanonicalId(targetID) ? targetID : undefined;
}

export function nodeLinkContainerTags(
  knowledgeDBs: KnowledgeDBs,
  documents: ImmutableMap<string, Document>,
  documentByFilePath: ImmutableMap<string, Document>,
  node: GraphNode,
  sourceId: SourceId
): string[] {
  return sortedUnique([
    ...getAllLinks(node).flatMap((link) => {
      const root = linkTargetContainerRoot(
        knowledgeDBs,
        link.targetID,
        sourceId
      );
      return root ? [root] : [];
    }),
    ...getAllFileLinks(node).flatMap((link) => {
      const target = resolveDocumentTarget(
        { knowledgeDBs, documents, documentByFilePath },
        node,
        sourceId,
        link.path
      );
      return target ? target.topNodeShortIds : [];
    }),
  ]);
}

export function documentRealWorldEntities(
  knowledgeDBs: KnowledgeDBs,
  documents: ImmutableMap<string, Document>,
  documentByFilePath: ImmutableMap<string, Document>,
  document: Document
): string[] {
  const nodes = knowledgeDBs.get(document.sourceId)?.nodes;
  if (!nodes) {
    return [];
  }
  const rootIds = new Set(document.topNodeShortIds);
  const walk = (nodeId: ID): string[] => {
    const node = nodes.get(nodeId);
    if (!node) {
      return [];
    }
    return [
      ...nodeLinkContainerTags(
        knowledgeDBs,
        documents,
        documentByFilePath,
        node,
        document.sourceId
      ).filter((tag) => !rootIds.has(tag)),
      ...node.children.toArray().flatMap((childId) => walk(childId)),
    ];
  };
  return sortedUnique(document.topNodeShortIds.flatMap((id) => walk(id)));
}

export function documentAudienceTags(document: Document): string[] {
  return sortedUnique([
    ...document.topNodeShortIds,
    ...document.realWorldEntities,
  ]);
}

export function withDocumentRealWorldEntities(
  knowledgeDBs: KnowledgeDBs,
  documents: ImmutableMap<string, Document>,
  documentByFilePath: ImmutableMap<string, Document>,
  document: Document
): Document {
  return {
    ...document,
    realWorldEntities: documentRealWorldEntities(
      knowledgeDBs,
      documents,
      documentByFilePath,
      document
    ),
  };
}

export function withRealWorldEntitiesForDocuments(
  knowledgeDBs: KnowledgeDBs,
  documents: ImmutableMap<string, Document>,
  documentByFilePath: ImmutableMap<string, Document>
): {
  documents: ImmutableMap<string, Document>;
  documentByFilePath: ImmutableMap<string, Document>;
} {
  const nextDocuments = documents
    .entrySeq()
    .reduce(
      (acc, [key, document]) =>
        acc.set(
          key,
          withDocumentRealWorldEntities(
            knowledgeDBs,
            documents,
            documentByFilePath,
            document
          )
        ),
      ImmutableMap<string, Document>()
    );
  const nextDocumentByFilePath = nextDocuments
    .valueSeq()
    .reduce(
      (acc, document) =>
        document.filePath ? acc.set(document.filePath, document) : acc,
      ImmutableMap<string, Document>()
    );
  return {
    documents: nextDocuments,
    documentByFilePath: nextDocumentByFilePath,
  };
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
  return documentLinkHref(document.docId, document.filePath);
}

export function createDocumentFromRootNode(rootNode: GraphNode): Document {
  const docId = rootNode.docId ?? rootNode.id;
  return {
    sourceId: LOCAL,
    docId,
    topNodeShortIds: [rootNode.id],
    updatedMs: rootNode.updated,
    title: nodeText(rootNode) || "Untitled",
    realWorldEntities: [],
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
  const frontMatter = withoutPublishEntities(ensured.frontMatter);

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
    sourceId: author,
    docId: ensured.docId,
    topNodeShortIds,
    updatedMs,
    title,
    realWorldEntities: [],
    ...(frontMatter && { frontMatter }),
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
