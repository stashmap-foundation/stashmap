import fs from "fs/promises";
import path from "path";
import { List, Map as ImmutableMap } from "immutable";
import ignore, { Ignore } from "ignore";
import { LOCAL } from "../../core/nodeRef";
import { Document, fileNameTitle, parseToDocument } from "../../core/Document";
import { isValidPath } from "../../core/linkPath";
import { WalkContext } from "../../core/markdownNodes";

export type WorkspaceSaveProfile = {
  workspaceDir: string;
};

export type ScannedWorkspaceDocument = Document & {
  currentContent: string;
  nodes: ImmutableMap<string, GraphNode>;
};

export type WorkspaceScanResult = {
  documents: ScannedWorkspaceDocument[];
  knowledgeDBs: KnowledgeDBs;
};

const ALWAYS_IGNORED = [".git", ".knowstr", "node_modules"];

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export async function loadIgnorePatterns(
  workspaceDir: string,
  ignoredPatterns: string[] = []
): Promise<Ignore> {
  const ig = ignore().add([...ALWAYS_IGNORED, ...ignoredPatterns]);
  const ignorePath = path.join(workspaceDir, ".knowstrignore");
  try {
    ig.add(await fs.readFile(ignorePath, "utf8"));
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
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

export function workspacePath(
  workspaceDir: string,
  absolutePath: string
): string {
  return path
    .relative(workspaceDir, absolutePath)
    .split(path.sep)
    .join("/")
    .normalize("NFC");
}

export async function collectWorkspaceMarkdownFiles(
  workspaceDir: string,
  ignoredPatterns?: string[]
): Promise<string[]> {
  const ig = await loadIgnorePatterns(workspaceDir, ignoredPatterns);
  return collectMarkdownFiles(workspaceDir, ig);
}

function checkPaths(paths: readonly string[]): void {
  const invalid = paths.filter((candidate) => !isValidPath(candidate));
  if (invalid.length > 0) {
    throw new Error(
      `Workspace paths must never contain :, #, ? or %: ${invalid.join(", ")}`
    );
  }
  const byFolded = paths.reduce(
    (acc, candidate) =>
      acc.set(candidate.toLowerCase(), [
        ...(acc.get(candidate.toLowerCase()) ?? []),
        candidate,
      ]),
    new Map<string, string[]>()
  );
  const clashes = [...byFolded.values()].filter((group) => group.length > 1);
  if (clashes.length > 0) {
    throw new Error(
      `Workspace paths differ only in case: ${clashes
        .map((group) => group.join(" and "))
        .join(", ")}`
    );
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
  const parsed = parseToDocument(LOCAL, currentContent, {
    path: relativePath,
    fallbackTitle: fileNameTitle(relativePath),
    ...(context !== undefined ? { context } : {}),
  });
  return {
    scanned: {
      ...parsed.document,
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
      relativePath: workspacePath(profile.workspaceDir, absolutePath),
      content: await fs.readFile(absolutePath, "utf8"),
    }))
  );
  checkPaths(files.map((file) => file.relativePath));

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
  return {
    documents: final.documents.toArray(),
    knowledgeDBs:
      final.context?.knowledgeDBs ?? ImmutableMap<SourceId, KnowledgeData>(),
  };
}
