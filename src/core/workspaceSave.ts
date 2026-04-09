import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { buildDocumentEventFromMarkdownTree } from "../standaloneDocumentEvent";
import { MarkdownTreeNode, parseMarkdownHierarchy } from "../markdownTree";
import { extractMarkdownImportPayload } from "../markdownImport";

export type WorkspaceSaveProfile = {
  pubkey: PublicKey;
  workspaceDir: string;
  knowstrHome: string;
};

type ScannedWorkspaceDocument = {
  filePath: string;
  relativePath: string;
  currentContent: string;
  docId: string;
  frontMatter: string;
  baselineContent?: string;
  mainRoot: MarkdownTreeNode;
};

type NormalizedWorkspaceDocument = {
  filePath: string;
  relativePath: string;
  docId: string;
  normalizedContent: string;
  activeNodeIds: string[];
  changed: boolean;
  baselineChanged: boolean;
};

const SKIPPED_DIRS = new Set([".git", ".knowstr", "node_modules"]);
const DOC_ID_RE = /^knowstr_doc_id:\s*(.+)$/mu;

const EDITING_BLOCK = [
  "editing: |",
  "  Edit text freely. Never modify <!-- id:... --> comments.",
  "  Never add <!-- id:... --> to new items. knowstr save will reject invented IDs.",
  "  Markers: (!) relevant (?) maybe relevant (~) little relevant (x) not relevant (+) confirms (-) contra",
  "  Save changes with: knowstr save",
].join("\n");

function stripEditingBlock(innerContent: string): string {
  const lines = innerContent.split("\n");
  const editingIdx = lines.findIndex((line) => /^editing:\s*\|/u.test(line));
  if (editingIdx === -1) {
    return innerContent;
  }
  const endIdx = lines.findIndex(
    (line, index) => index > editingIdx && line.length > 0 && !/^\s/u.test(line)
  );
  const before = lines.slice(0, editingIdx);
  const after = endIdx === -1 ? [] : lines.slice(endIdx);
  return [...before, ...after].join("\n").replace(/\n+$/u, "");
}

function baselineFilePath(knowstrHome: string, docId: string): string {
  return path.join(knowstrHome, "base", "by-doc-id", `${docId}.md`);
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function ensureKnowstrDocIdFrontMatter(frontMatterRaw: string | undefined): {
  docId: string;
  frontMatter: string;
} {
  const rawInner = frontMatterRaw
    ? frontMatterRaw
        .replace(/^---\r?\n/u, "")
        .replace(/\r?\n---(?:\r?\n)?$/u, "")
    : "";
  const innerWithoutEditing = stripEditingBlock(rawInner);

  const docIdMatch = innerWithoutEditing.match(DOC_ID_RE);
  const docId = docIdMatch?.[1]
    ? stripWrappingQuotes(docIdMatch[1])
    : randomUUID();

  const innerWithDocId = docIdMatch
    ? innerWithoutEditing
    : `${innerWithoutEditing}${
        innerWithoutEditing ? "\n" : ""
      }knowstr_doc_id: ${docId}`;

  return {
    docId,
    frontMatter: `---\n${innerWithDocId}\n${EDITING_BLOCK}\n---\n`,
  };
}

function hasAnyUuidMarker(node: MarkdownTreeNode): boolean {
  if (node.uuid) {
    return true;
  }
  return node.children.some((child) => hasAnyUuidMarker(child));
}

function collectNodeIds(node: MarkdownTreeNode): string[] {
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

function parseWorkspaceDocumentRoots(
  body: string,
  title: string | undefined,
  frontMatter: string,
  relativePath: string
): MarkdownTreeNode {
  const roots = parseMarkdownHierarchy(body).filter((root) => !root.hidden);
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
        text: title,
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

async function readBaseline(
  knowstrHome: string,
  docId: string
): Promise<string | undefined> {
  try {
    return await fs.readFile(baselineFilePath(knowstrHome, docId), "utf8");
  } catch {
    return undefined;
  }
}

async function collectMarkdownFiles(
  workspaceDir: string,
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
      if (SKIPPED_DIRS.has(entry.name)) {
        return acc;
      }
      const nestedFiles = await collectMarkdownFiles(
        workspaceDir,
        nextRelativePath
      );
      return [...acc, ...nestedFiles];
    }

    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      return acc;
    }

    return [...acc, path.join(workspaceDir, nextRelativePath)];
  }, Promise.resolve([] as string[]));
}

async function scanWorkspaceDocuments(
  profile: WorkspaceSaveProfile
): Promise<ScannedWorkspaceDocument[]> {
  const markdownFiles = await collectMarkdownFiles(profile.workspaceDir);

  return Promise.all(
    markdownFiles.map(async (filePath) => {
      const relativePath = path.relative(profile.workspaceDir, filePath);
      const currentContent = await fs.readFile(filePath, "utf8");
      const {
        body,
        frontMatter: currentFrontMatter,
        metadata,
      } = extractMarkdownImportPayload(currentContent);
      const { docId, frontMatter } =
        ensureKnowstrDocIdFrontMatter(currentFrontMatter);
      const mainRoot = parseWorkspaceDocumentRoots(
        body,
        metadata.title,
        frontMatter,
        relativePath
      );

      return {
        filePath,
        relativePath,
        currentContent,
        docId,
        frontMatter,
        baselineContent: await readBaseline(profile.knowstrHome, docId),
        mainRoot,
      };
    })
  );
}

function normalizeWorkspaceDocument(
  profile: WorkspaceSaveProfile,
  document: ScannedWorkspaceDocument
): NormalizedWorkspaceDocument {
  const rootTree =
    document.baselineContent === undefined
      ? parseWorkspaceDocumentRoots(
          extractMarkdownImportPayload(document.currentContent).body,
          extractMarkdownImportPayload(document.currentContent).metadata.title,
          document.frontMatter,
          document.relativePath
        )
      : {
          ...document.mainRoot,
          frontMatter: document.frontMatter,
        };

  if (document.baselineContent === undefined && hasAnyUuidMarker(rootTree)) {
    throw new Error(
      `New document ${document.relativePath} must not contain pre-existing id markers`
    );
  }

  const builtEvent = buildDocumentEventFromMarkdownTree(
    profile.pubkey,
    rootTree
  );
  const normalizedContent = builtEvent.event.content;
  const { body: normalizedBody, metadata: normalizedMetadata } =
    extractMarkdownImportPayload(normalizedContent);
  const normalizedRoot = parseWorkspaceDocumentRoots(
    normalizedBody,
    normalizedMetadata.title,
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
    baselineChanged: document.baselineContent !== normalizedContent,
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

async function writeBaseline(
  knowstrHome: string,
  docId: string,
  content: string
): Promise<void> {
  const filePath = baselineFilePath(knowstrHome, docId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

export async function saveEditedWorkspaceDocuments(
  profile: WorkspaceSaveProfile
): Promise<{
  changed_paths: string[];
  updated_paths: string[];
}> {
  const scannedDocuments = await scanWorkspaceDocuments(profile);
  const normalizedDocuments = scannedDocuments.map((document) =>
    normalizeWorkspaceDocument(profile, document)
  );
  validateWorkspaceIntegrity(normalizedDocuments);

  const updatedPaths = await normalizedDocuments.reduce(
    async (previous, document) => {
      const acc = await previous;

      if (!document.changed && !document.baselineChanged) {
        return acc;
      }

      if (document.changed) {
        await fs.writeFile(
          document.filePath,
          document.normalizedContent,
          "utf8"
        );
      }
      await writeBaseline(
        profile.knowstrHome,
        document.docId,
        document.normalizedContent
      );

      return [...acc, document.filePath];
    },
    Promise.resolve([] as string[])
  );

  return {
    changed_paths: normalizedDocuments
      .filter((document) => document.changed)
      .map((document) => document.filePath),
    updated_paths: updatedPaths,
  };
}
