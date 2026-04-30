import fs from "fs/promises";
import path from "path";
import { Map as ImmutableMap } from "immutable";
import ignore, { Ignore } from "ignore";
import { Document, parseToDocument } from "../../core/Document";
import { WalkContext } from "../../core/markdownNodes";

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
const RESERVED_WORKSPACE_IGNORES = ["inbox/"];

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

type ScanAcc = {
  documents: ScannedWorkspaceDocument[];
  context: WalkContext | undefined;
};

async function readAndParseFile(
  profile: WorkspaceSaveProfile,
  absolutePath: string,
  context: WalkContext | undefined
): Promise<{ scanned: ScannedWorkspaceDocument; context: WalkContext }> {
  const relativePath = path.relative(profile.workspaceDir, absolutePath);
  const currentContent = await fs.readFile(absolutePath, "utf8");
  const fallbackTitle = path.basename(relativePath, ".md") || undefined;
  const parsed = parseToDocument(profile.pubkey, currentContent, {
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
  const ig = await loadIgnorePatterns(
    profile.workspaceDir,
    options.ignoredPatterns
  );
  const markdownFiles = await collectMarkdownFiles(profile.workspaceDir, ig);

  const final = await markdownFiles.reduce<Promise<ScanAcc>>(
    async (previous, filePath) => {
      const acc = await previous;
      const { scanned, context } = await readAndParseFile(
        profile,
        filePath,
        acc.context
      );
      return {
        documents: [...acc.documents, scanned],
        context,
      };
    },
    Promise.resolve({ documents: [], context: undefined })
  );

  checkDuplicateDocIds(final.documents);

  const knowledgeDBs =
    final.context?.knowledgeDBs ?? ImmutableMap<PublicKey, KnowledgeData>();
  return { documents: final.documents, knowledgeDBs };
}
