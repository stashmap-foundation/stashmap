import fs from "fs/promises";
import path from "path";
import { Map as ImmutableMap } from "immutable";
import ignore, { Ignore } from "ignore";
import { LOCAL } from "../../core/nodeRef";
import {
  Document,
  parseToDocumentPreservingExplicitIds,
} from "../../core/Document";
import { WalkContext } from "../../core/markdownNodes";
import { MarkdownTreeNode, parseMarkdown } from "../../core/markdownTree";

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

  return sortedEntries.reduce(async (previous, entry) => {
    const acc = await previous;
    const nextRelativePath = path.join(relativeDir, entry.name);

    if (entry.isDirectory()) {
      if (ig.ignores(`${nextRelativePath}/`)) {
        return acc;
      }
      const nestedFiles = await collectMarkdownFiles(
        workspaceDir,
        ig,
        nextRelativePath
      );
      return [...acc, ...nestedFiles];
    }

    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      return acc;
    }

    if (ig.ignores(nextRelativePath)) {
      return acc;
    }

    return [...acc, path.join(workspaceDir, nextRelativePath)];
  }, Promise.resolve([] as string[]));
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

function describeDuplicate(id: string, paths: string[]): string {
  const uniquePaths = [...new Set(paths)].sort();
  if (uniquePaths.length === 1) {
    return `${uniquePaths[0]} contains id:${id} more than once`;
  }
  return `${uniquePaths.join(" and ")} both contain id:${id}`;
}

function checkDuplicateNodeIds(
  files: ReadonlyArray<{ relativePath: string; content: string }>
): void {
  const pathsById = files.reduce((acc, file) => {
    collectExplicitNodeIds(parseMarkdown(file.content).tree).forEach((id) => {
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

type ScanAcc = {
  documents: ScannedWorkspaceDocument[];
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

  checkDuplicateNodeIds(files);

  const final = files.reduce<ScanAcc>(
    (acc, file) => {
      const { scanned, context } = parseFile(file, acc.context);
      return {
        documents: [...acc.documents, scanned],
        context,
      };
    },
    { documents: [], context: undefined }
  );

  checkDuplicateDocIds(final.documents);

  const knowledgeDBs =
    final.context?.knowledgeDBs ?? ImmutableMap<SourceId, KnowledgeData>();
  return { documents: final.documents, knowledgeDBs };
}
