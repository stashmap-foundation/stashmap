import fs from "fs/promises";
import path from "path";
import ignore, { Ignore } from "ignore";
import { buildDocumentEventFromMarkdownTree } from "../../standaloneDocumentEvent";
import {
  MarkdownTreeNode,
  parseMarkdownDocument,
} from "../../core/markdownTree";
import { extractTitle } from "../../core/markdownFrontMatter";
import { ensureKnowstrDocIdFrontMatter } from "../../core/knowstrFrontmatter";
import { plainSpans } from "../../core/nodeSpans";

export type WorkspaceSaveProfile = {
  pubkey: PublicKey;
  workspaceDir: string;
};

export type ScannedWorkspaceDocument = {
  filePath: string;
  relativePath: string;
  currentContent: string;
  docId: string;
  frontMatter: string;
  mainRoot: MarkdownTreeNode;
};

type NormalizedWorkspaceDocument = {
  filePath: string;
  relativePath: string;
  docId: string;
  normalizedContent: string;
  activeNodeIds: string[];
  changed: boolean;
};

const ALWAYS_IGNORED = [".git", ".knowstr", "node_modules"];
const RESERVED_WORKSPACE_IGNORES = ["inbox/"];

export function collectNodeIds(node: MarkdownTreeNode): string[] {
  return [
    ...(node.uuid ? [node.uuid] : []),
    ...node.children.flatMap((child) => collectNodeIds(child)),
  ];
}

function findDuplicateIds(values: string[]): string[] {
  const counts = values.reduce(
    (acc, value) => ({
      ...acc,
      [value]: (acc[value] || 0) + 1,
    }),
    {} as Record<string, number>
  );

  return Object.entries(counts)
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
}

export function parseWorkspaceDocumentRoots(
  tree: MarkdownTreeNode[],
  title: string | undefined,
  frontMatter: string,
  relativePath: string
): MarkdownTreeNode {
  const roots = tree.filter((root) => !root.hidden);
  if (roots.length === 0) {
    throw new Error(
      `Document ${relativePath} must contain exactly one main root`
    );
  }

  const singleRoot =
    roots.length === 1 && (!title || roots[0]?.blockKind === "heading")
      ? roots[0]
      : undefined;
  const titledRoot = title
    ? {
        spans: plainSpans(title),
        children: roots,
      }
    : undefined;
  const mainRoot = singleRoot || titledRoot;
  if (!mainRoot) {
    throw new Error(
      `Document ${relativePath} must contain exactly one top-level root`
    );
  }

  return {
    ...mainRoot,
    frontMatter,
  } as MarkdownTreeNode;
}

export async function loadIgnorePatterns(
  workspaceDir: string,
  ignoredPatterns: string[] = RESERVED_WORKSPACE_IGNORES
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

export async function scanWorkspaceDocuments(
  profile: WorkspaceSaveProfile,
  options: {
    ignoredPatterns?: string[];
  } = {}
): Promise<ScannedWorkspaceDocument[]> {
  const ig = await loadIgnorePatterns(
    profile.workspaceDir,
    options.ignoredPatterns
  );
  const markdownFiles = await collectMarkdownFiles(profile.workspaceDir, ig);

  return Promise.all(
    markdownFiles.map(async (filePath) => {
      const relativePath = path.relative(profile.workspaceDir, filePath);
      const currentContent = await fs.readFile(filePath, "utf8");
      const { tree, frontMatter: currentFrontMatter } =
        parseMarkdownDocument(currentContent);
      const title = currentFrontMatter
        ? extractTitle(currentFrontMatter)
        : undefined;
      const { docId, frontMatter } =
        ensureKnowstrDocIdFrontMatter(currentFrontMatter);
      const mainRoot = parseWorkspaceDocumentRoots(
        tree,
        title,
        frontMatter,
        relativePath
      );

      return {
        filePath,
        relativePath,
        currentContent,
        docId,
        frontMatter,
        mainRoot: { ...mainRoot, docId },
      };
    })
  );
}

function normalizeWorkspaceDocument(
  profile: WorkspaceSaveProfile,
  document: ScannedWorkspaceDocument
): NormalizedWorkspaceDocument {
  const rootTree = {
    ...document.mainRoot,
    frontMatter: document.frontMatter,
  };

  const builtEvent = buildDocumentEventFromMarkdownTree(
    profile.pubkey,
    rootTree
  );
  const normalizedContent = builtEvent.event.content;
  const { tree: normalizedTree, frontMatter: normalizedFrontMatter } =
    parseMarkdownDocument(normalizedContent);
  const normalizedTitle = normalizedFrontMatter
    ? extractTitle(normalizedFrontMatter)
    : undefined;
  const normalizedRoot = parseWorkspaceDocumentRoots(
    normalizedTree,
    normalizedTitle,
    document.frontMatter,
    document.relativePath
  );
  const activeNodeIds = collectNodeIds(normalizedRoot);

  return {
    filePath: document.filePath,
    relativePath: document.relativePath,
    docId: document.docId,
    normalizedContent,
    activeNodeIds,
    changed: document.currentContent !== normalizedContent,
  };
}

function collectAllNodeIds(documents: NormalizedWorkspaceDocument[]): string[] {
  return documents.flatMap((document) => document.activeNodeIds);
}

function validateWorkspaceIntegrity(
  normalizedDocuments: NormalizedWorkspaceDocument[]
): void {
  const docIdCounts = normalizedDocuments.reduce(
    (acc, document) => ({
      ...acc,
      [document.docId]: (acc[document.docId] || 0) + 1,
    }),
    {} as Record<string, number>
  );
  const duplicateDocIds = Object.entries(docIdCounts)
    .filter(([, count]) => count > 1)
    .map(([docId]) => docId)
    .sort();

  if (duplicateDocIds.length > 0) {
    throw new Error(
      `Workspace contains duplicate knowstr_doc_id values: ${duplicateDocIds.join(
        ", "
      )}`
    );
  }

  const allNodeIds = collectAllNodeIds(normalizedDocuments);
  const duplicateNodeIds = findDuplicateIds(allNodeIds);
  if (duplicateNodeIds.length > 0) {
    throw new Error(
      `Workspace contains duplicate node ids: ${duplicateNodeIds.join(", ")}`
    );
  }
}

export type WorkspaceWrite = {
  filePath: string;
  content: string;
};

export async function applyWorkspaceChanges(
  writes: ReadonlyArray<WorkspaceWrite>,
  deletions: ReadonlyArray<string> = []
): Promise<{ changed_paths: string[]; removed_paths: string[] }> {
  await Promise.all([
    ...writes.map((write) =>
      fs.writeFile(write.filePath, write.content, "utf8")
    ),
    ...deletions.map((filePath) => fs.unlink(filePath)),
  ]);
  return {
    changed_paths: writes.map((write) => write.filePath),
    removed_paths: [...deletions],
  };
}

export async function saveEditedWorkspaceDocuments(
  profile: WorkspaceSaveProfile
): Promise<{
  changed_paths: string[];
}> {
  const scannedDocuments = await scanWorkspaceDocuments(profile);
  const normalizedDocuments = scannedDocuments.map((document) =>
    normalizeWorkspaceDocument(profile, document)
  );
  validateWorkspaceIntegrity(normalizedDocuments);

  const writes = normalizedDocuments
    .filter((document) => document.changed)
    .map((document) => ({
      filePath: document.filePath,
      content: document.normalizedContent,
    }));

  const result = await applyWorkspaceChanges(writes);
  return { changed_paths: result.changed_paths };
}
