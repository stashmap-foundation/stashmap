import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { buildDocumentEventFromMarkdownTree } from "../standaloneDocumentEvent";
import { MarkdownTreeNode, parseMarkdownHierarchy } from "../markdownTree";
import { extractMarkdownImportPayload } from "../markdownImport";

type WorkspaceSaveProfile = {
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
  deleteRoot?: MarkdownTreeNode;
};

type NodeIndexState = {
  version: 1;
  nodes: Record<string, string>;
};

type NormalizedWorkspaceDocument = {
  filePath: string;
  relativePath: string;
  docId: string;
  normalizedContent: string;
  activeNodeIds: string[];
  deletedNodeIds: string[];
  changed: boolean;
  baselineChanged: boolean;
};

const SKIPPED_DIRS = new Set([".git", ".knowstr", "node_modules"]);
const DOC_ID_RE = /^knowstr_doc_id:\s*(.+)$/mu;

function baselineFilePath(knowstrHome: string, docId: string): string {
  return path.join(knowstrHome, "base", "by-doc-id", `${docId}.md`);
}

function nodeIndexPath(knowstrHome: string): string {
  return path.join(knowstrHome, "state", "node-index.json");
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
  if (!frontMatterRaw) {
    const docId = randomUUID();
    return {
      docId,
      frontMatter: `---\nknowstr_doc_id: ${docId}\n---\n`,
    };
  }

  const match = frontMatterRaw.match(DOC_ID_RE);
  if (match?.[1]) {
    return {
      docId: stripWrappingQuotes(match[1]),
      frontMatter: frontMatterRaw,
    };
  }

  const innerContent = frontMatterRaw
    .replace(/^---\r?\n/u, "")
    .replace(/\r?\n---(?:\r?\n)?$/u, "");
  const docId = randomUUID();
  const trailingNewline =
    innerContent.endsWith("\n") || innerContent.length === 0;
  const mergedContent = `${innerContent}${
    trailingNewline ? "" : "\n"
  }knowstr_doc_id: ${docId}\n`;

  return {
    docId,
    frontMatter: `---\n${mergedContent}---\n`,
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
): {
  mainRoot: MarkdownTreeNode;
  deleteRoot?: MarkdownTreeNode;
} {
  const roots = parseMarkdownHierarchy(body).filter((root) => !root.hidden);
  if (roots.length === 0) {
    throw new Error(
      `Document ${relativePath} must contain exactly one main root`
    );
  }

  const deleteRootCandidate = roots[roots.length - 1];
  const hasDeleteRoot =
    deleteRootCandidate?.text === "Delete" &&
    deleteRootCandidate.blockKind === "heading" &&
    deleteRootCandidate.headingLevel === 1;
  const deleteRoot = hasDeleteRoot ? deleteRootCandidate : undefined;
  const activeRoots = deleteRoot ? roots.slice(0, -1) : roots;

  const hasNestedDeleteSection = activeRoots.some((root) =>
    root.children.some((child) => child.text === "Delete")
  );
  if (hasNestedDeleteSection) {
    throw new Error(
      'Delete section must be a separate "# Delete" root at the end of the file'
    );
  }
  if (activeRoots.length === 0) {
    throw new Error(
      `Document ${relativePath} must contain exactly one main root`
    );
  }

  const singleRoot =
    activeRoots.length === 1 &&
    (!title || activeRoots[0]?.blockKind === "heading")
      ? activeRoots[0]
      : undefined;
  const titledRoot = title
    ? {
        text: title,
        children: activeRoots,
      }
    : undefined;
  const mainRoot = singleRoot || titledRoot;
  if (!mainRoot) {
    throw new Error(
      `Document ${relativePath} must contain exactly one top-level root`
    );
  }

  return {
    mainRoot: {
      ...mainRoot,
      frontMatter,
    } as MarkdownTreeNode,
    ...(deleteRoot ? { deleteRoot } : {}),
  };
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

async function loadPreviousNodeIndex(
  knowstrHome: string
): Promise<NodeIndexState> {
  try {
    const raw = await fs.readFile(nodeIndexPath(knowstrHome), "utf8");
    const parsed = JSON.parse(raw) as NodeIndexState;
    return {
      version: 1,
      nodes: parsed.nodes || {},
    };
  } catch {
    return {
      version: 1,
      nodes: {},
    };
  }
}

async function writeNodeIndex(
  knowstrHome: string,
  nodes: Record<string, string>
): Promise<void> {
  const filePath = nodeIndexPath(knowstrHome);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    `${JSON.stringify({ version: 1, nodes }, null, 2)}\n`,
    "utf8"
  );
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
      const { mainRoot, deleteRoot } = parseWorkspaceDocumentRoots(
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
        ...(deleteRoot ? { deleteRoot } : {}),
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
        ).mainRoot
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
  ).mainRoot;
  const activeNodeIds = collectNodeIds(normalizedRoot);

  return {
    filePath: document.filePath,
    relativePath: document.relativePath,
    docId: document.docId,
    normalizedContent,
    activeNodeIds,
    deletedNodeIds: document.deleteRoot
      ? collectNodeIds(document.deleteRoot)
      : [],
    changed: document.currentContent !== normalizedContent,
    baselineChanged: document.baselineContent !== normalizedContent,
  };
}

function buildWorkspaceNodeIndex(
  normalizedDocuments: NormalizedWorkspaceDocument[]
): {
  nodeIndex: Record<string, string>;
  allNodeIds: string[];
  deletedNodeIds: string[];
} {
  return normalizedDocuments.reduce(
    (acc, document) => ({
      nodeIndex: {
        ...acc.nodeIndex,
        ...document.activeNodeIds.reduce(
          (docAcc, nodeId) => ({
            ...docAcc,
            [nodeId]: document.docId,
          }),
          {} as Record<string, string>
        ),
      },
      allNodeIds: [
        ...acc.allNodeIds,
        ...document.activeNodeIds,
        ...document.deletedNodeIds,
      ],
      deletedNodeIds: [...acc.deletedNodeIds, ...document.deletedNodeIds],
    }),
    {
      nodeIndex: {} as Record<string, string>,
      allNodeIds: [] as string[],
      deletedNodeIds: [] as string[],
    }
  );
}

function validateWorkspaceIntegrity(
  previousNodeIndex: NodeIndexState,
  normalizedDocuments: NormalizedWorkspaceDocument[]
): Record<string, string> {
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

  const { nodeIndex, allNodeIds, deletedNodeIds } =
    buildWorkspaceNodeIndex(normalizedDocuments);
  const duplicateNodeIds = findDuplicateIds(allNodeIds);
  if (duplicateNodeIds.length > 0) {
    throw new Error(
      `Workspace contains duplicate node ids: ${duplicateNodeIds.join(", ")}`
    );
  }

  const allowedNodeIds = new Set([
    ...Object.keys(nodeIndex),
    ...deletedNodeIds,
  ]);
  const lostNodeIds = Object.keys(previousNodeIndex.nodes)
    .filter((nodeId) => !allowedNodeIds.has(nodeId))
    .sort();

  if (lostNodeIds.length > 0) {
    throw new Error(
      `Workspace loses existing node ids: ${lostNodeIds.join(", ")}`
    );
  }

  return nodeIndex;
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
  const previousNodeIndex = await loadPreviousNodeIndex(profile.knowstrHome);
  const nextNodeIndex = validateWorkspaceIntegrity(
    previousNodeIndex,
    normalizedDocuments
  );

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

  await writeNodeIndex(profile.knowstrHome, nextNodeIndex);

  return {
    changed_paths: normalizedDocuments
      .filter((document) => document.changed)
      .map((document) => document.filePath),
    updated_paths: updatedPaths,
  };
}
