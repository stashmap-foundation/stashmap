import fs from "fs/promises";
import path from "path";
import { Map as ImmutableMap, Set as ImmutableSet } from "immutable";
import ignore, { Ignore } from "ignore";
import {
  MarkdownTreeNode,
  firstTopLevelNodeText,
  parseMarkdownDocument,
} from "../../core/markdownTree";
import { ensureKnowstrDocIdFrontMatter } from "../../core/knowstrFrontmatter";
import { plainSpans } from "../../core/nodeSpans";
import { createNodesFromMarkdownTrees } from "../../core/markdownNodes";

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
  title: string;
  mainRoot: MarkdownTreeNode;
};

const ALWAYS_IGNORED = [".git", ".knowstr", "node_modules"];
const RESERVED_WORKSPACE_IGNORES = ["inbox/"];

export function collectNodeIds(node: MarkdownTreeNode): string[] {
  return [
    ...(node.uuid ? [node.uuid] : []),
    ...node.children.flatMap((child) => collectNodeIds(child)),
  ];
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

  const documents = await Promise.all(
    markdownFiles.map(async (filePath) => {
      const relativePath = path.relative(profile.workspaceDir, filePath);
      const currentContent = await fs.readFile(filePath, "utf8");
      const parsed = parseMarkdownDocument(currentContent);
      const { docId, frontMatter } = ensureKnowstrDocIdFrontMatter(
        parsed.frontMatter
      );
      const fallbackTitle = path.basename(relativePath, ".md") || undefined;
      const title =
        parsed.title ??
        fallbackTitle ??
        firstTopLevelNodeText(parsed.tree) ??
        "Untitled";
      const mainRoot = parseWorkspaceDocumentRoots(
        parsed.tree,
        parsed.title,
        frontMatter,
        relativePath
      );

      return {
        filePath,
        relativePath,
        currentContent,
        docId,
        frontMatter,
        title,
        mainRoot: { ...mainRoot, docId },
      };
    })
  );

  checkDuplicateDocIds(documents);

  documents.reduce(
    (ctx, doc) => createNodesFromMarkdownTrees(ctx, [doc.mainRoot])[0],
    {
      knowledgeDBs: ImmutableMap<PublicKey, KnowledgeData>(),
      publicKey: profile.pubkey,
      affectedRoots: ImmutableSet<ID>(),
    }
  );

  return documents;
}
