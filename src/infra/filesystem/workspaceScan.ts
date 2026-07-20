import fs from "fs/promises";
import path from "path";
import { List, Map as ImmutableMap } from "immutable";
import ignore, { Ignore } from "ignore";
import { LOCAL } from "../../core/nodeRef";
import {
  Document,
  documentKeyOf,
  parseToDocumentPreservingExplicitIds,
  withRealWorldEntitiesForDocuments,
} from "../../core/Document";
import { WalkContext } from "../../core/markdownNodes";
import { MarkdownTreeNode, parseMarkdown } from "../../core/markdownTree";
import { isValidSnapshotId } from "../../nodesDocumentEvent";

export type WorkspaceSaveProfile = {
  pubkey: PublicKey;
  workspaceDir: string;
};

export type ScannedWorkspaceDocument = Document & {
  filePath: string;
  relativePath: string;
  currentContent: string;
  nodes: ImmutableMap<string, GraphNode>;
};

export type WorkspaceScanResult = {
  documents: ScannedWorkspaceDocument[];
  knowledgeDBs: KnowledgeDBs;
};

const ALWAYS_IGNORED = [".git", ".knowstr", "node_modules"];

export async function loadIgnorePatterns(
  workspaceDir: string,
  ignoredPatterns: string[] = []
): Promise<Ignore> {
  const ig = ignore().add([...ALWAYS_IGNORED, ...ignoredPatterns]);
  const ignorePath = path.join(workspaceDir, ".knowstrignore");
  try {
    const content = await fs.readFile(ignorePath, "utf8");
    ig.add(content);
  } catch {
    // no .knowstrignore file
  }
  return ig;
}

async function collectMarkdownFiles(
  workspaceDir: string,
  ig: Ignore,
  relativeDir = ""
): Promise<string[]> {
  const dirPath = path.join(workspaceDir, relativeDir);
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const sortedEntries = entries
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));

  const nested = await Promise.all(
    sortedEntries.map(async (entry) => {
      const nextRelativePath = path.join(relativeDir, entry.name);

      if (entry.isDirectory()) {
        return ig.ignores(`${nextRelativePath}/`)
          ? []
          : collectMarkdownFiles(workspaceDir, ig, nextRelativePath);
      }

      if (
        !entry.isFile() ||
        !entry.name.endsWith(".md") ||
        ig.ignores(nextRelativePath)
      ) {
        return [];
      }

      return [path.join(workspaceDir, nextRelativePath)];
    })
  );
  return nested.flat();
}

export async function collectWorkspaceMarkdownFiles(
  workspaceDir: string,
  ignoredPatterns?: string[]
): Promise<string[]> {
  const ig = await loadIgnorePatterns(workspaceDir, ignoredPatterns);
  return collectMarkdownFiles(workspaceDir, ig);
}

function checkDuplicateDocIds(
  documents: ReadonlyArray<{ docId: string }>
): void {
  const counts = documents.reduce(
    (acc, doc) => ({ ...acc, [doc.docId]: (acc[doc.docId] || 0) + 1 }),
    {} as Record<string, number>
  );
  const duplicates = Object.entries(counts)
    .filter(([, count]) => count > 1)
    .map(([docId]) => docId)
    .sort();
  if (duplicates.length > 0) {
    throw new Error(
      `Workspace contains duplicate knowstr_doc_id values: ${duplicates.join(
        ", "
      )}`
    );
  }
}

function collectExplicitNodeIds(trees: MarkdownTreeNode[]): string[] {
  return trees.flatMap((tree) => [
    ...(tree.uuid !== undefined ? [tree.uuid] : []),
    ...collectExplicitNodeIds(tree.children),
  ]);
}

function collectSnapshotIds(trees: MarkdownTreeNode[]): string[] {
  return trees.flatMap((tree) => [
    ...(tree.snapshotId !== undefined ? [tree.snapshotId] : []),
    ...collectSnapshotIds(tree.children),
  ]);
}

function describeDuplicate(id: string, paths: string[]): string {
  const uniquePaths = [...new Set(paths)].sort();
  if (uniquePaths.length === 1) {
    return `${uniquePaths[0]} contains id:${id} more than once`;
  }
  return `${uniquePaths.join(" and ")} both contain id:${id}`;
}

function checkDuplicateNodeIds(
  files: ReadonlyArray<{ relativePath: string; tree: MarkdownTreeNode[] }>
): void {
  const pathsById = files.reduce((acc, file) => {
    collectExplicitNodeIds(file.tree).forEach((id) => {
      acc.set(id, [...(acc.get(id) ?? []), file.relativePath]);
    });
    return acc;
  }, new Map<string, string[]>());

  const duplicates = [...pathsById.entries()]
    .filter(([, paths]) => paths.length > 1)
    .sort(([left], [right]) => left.localeCompare(right));
  if (duplicates.length === 0) {
    return;
  }

  const conflictLines = duplicates.map(([id, paths]) =>
    describeDuplicate(id, paths)
  );
  throw new Error(
    [
      ...conflictLines,
      "  - if a file is a variant, give it fresh IDs (future: knowstr fork)",
      "  - if it's a backup, move it out or add it to .knowstrignore",
    ].join("\n")
  );
}

function checkSnapshotIds(
  files: ReadonlyArray<{ relativePath: string; tree: MarkdownTreeNode[] }>
): void {
  const malformed = files.flatMap((file) =>
    collectSnapshotIds(file.tree)
      .filter((snapshotId) => !isValidSnapshotId(snapshotId))
      .map(
        (snapshotId) =>
          `${file.relativePath}: invalid snapshot id "${snapshotId}" (expected snap_sha256_<64 lowercase hex chars>)`
      )
  );
  if (malformed.length > 0) {
    throw new Error(malformed.join("\n"));
  }
}

type ScanAcc = {
  documents: List<ScannedWorkspaceDocument>;
  context: WalkContext | undefined;
};

function parseFile(
  file: { relativePath: string; content: string },
  context: WalkContext | undefined
): { scanned: ScannedWorkspaceDocument; context: WalkContext } {
  const { relativePath, content: currentContent } = file;
  const fallbackTitle = path.basename(relativePath, ".md") || undefined;
  const parsed = parseToDocumentPreservingExplicitIds(LOCAL, currentContent, {
    filePath: relativePath,
    relativePath,
    ...(fallbackTitle !== undefined ? { fallbackTitle } : {}),
    ...(context !== undefined ? { context } : {}),
  });
  return {
    scanned: {
      ...parsed.document,
      filePath: relativePath,
      relativePath,
      currentContent,
      nodes: parsed.nodes,
    },
    context: parsed.context,
  };
}

export async function scanWorkspaceDocuments(
  profile: WorkspaceSaveProfile,
  options: {
    ignoredPatterns?: string[];
  } = {}
): Promise<WorkspaceScanResult> {
  const markdownFiles = await collectWorkspaceMarkdownFiles(
    profile.workspaceDir,
    options.ignoredPatterns
  );

  const files = await Promise.all(
    markdownFiles.map(async (absolutePath) => ({
      relativePath: path.relative(profile.workspaceDir, absolutePath),
      content: await fs.readFile(absolutePath, "utf8"),
    }))
  );

  const parsedTrees = files.map((file) => ({
    relativePath: file.relativePath,
    tree: parseMarkdown(file.content).tree,
  }));
  checkDuplicateNodeIds(parsedTrees);
  checkSnapshotIds(parsedTrees);

  const final = files.reduce<ScanAcc>(
    (acc, file) => {
      const { scanned, context } = parseFile(file, acc.context);
      return {
        documents: acc.documents.push(scanned),
        context,
      };
    },
    { documents: List<ScannedWorkspaceDocument>(), context: undefined }
  );
  const scannedDocuments = final.documents.toArray();

  checkDuplicateDocIds(scannedDocuments);

  const knowledgeDBs =
    final.context?.knowledgeDBs ?? ImmutableMap<SourceId, KnowledgeData>();
  const documents = ImmutableMap<string, Document>(
    scannedDocuments.map((document) => [
      documentKeyOf(document.sourceId, document.docId),
      document,
    ])
  );
  const documentByFilePath = scannedDocuments.reduce(
    (acc, document) => acc.set(document.filePath, document),
    ImmutableMap<string, Document>()
  );
  const derived = withRealWorldEntitiesForDocuments(
    knowledgeDBs,
    documents,
    documentByFilePath
  );
  return {
    documents: scannedDocuments.map((document) => ({
      ...document,
      realWorldEntities:
        derived.documents.get(documentKeyOf(document.sourceId, document.docId))
          ?.realWorldEntities ?? [],
    })),
    knowledgeDBs,
  };
}
