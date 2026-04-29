import fs from "fs/promises";
import path from "path";
import { buildDocumentEventFromMarkdownTree } from "../../standaloneDocumentEvent";
import { extractTitle } from "../../core/markdownFrontMatter";
import {
  MarkdownTreeNode,
  parseMarkdownDocument,
} from "../../core/markdownTree";
import { saveEditedWorkspaceDocuments } from "./workspaceSave";
import {
  ScannedWorkspaceDocument,
  WorkspaceSaveProfile,
  collectNodeIds,
  parseWorkspaceDocumentRoots,
  scanWorkspaceDocuments,
} from "./workspaceScan";

type InboxDocument = {
  filePath: string;
  relativePath: string;
  mainRoot: MarkdownTreeNode;
};

type LocalNodeLocation = {
  filePath: string;
  node: MarkdownTreeNode;
};

type GraphAdditionCandidate = {
  parentId: string;
  node: MarkdownTreeNode;
  sourcePath: string;
  targetPath: string;
};

type MaybeRelevantCandidate = {
  sourcePath: string;
  root: MarkdownTreeNode;
};

type DuplicateCandidateConflict = {
  nodeId: string;
  conflicting: boolean;
  candidate?: GraphAdditionCandidate;
};

export type ApplyWorkspaceResult = {
  dry_run: boolean;
  graph_additions: Array<{
    parent_id: string;
    node_id: string;
    source_path: string;
    target_path: string;
  }>;
  maybe_relevant_paths: string[];
  skipped_existing_ids: string[];
  conflicting_ids: string[];
  invalid_inbox_paths: string[];
  changed_paths: string[];
  cleared_inbox_paths: string[];
  log_path?: string;
};

const INBOX_DIR = "inbox";
const MAYBE_RELEVANT_DIR = "maybe_relevant";
const LOG_FILE = "knowstr_log.md";
const DUMMY_PUBKEY = "a".repeat(64) as PublicKey;

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/gu, "\n");
}

function cloneTree(node: MarkdownTreeNode): MarkdownTreeNode {
  return {
    ...node,
    children: node.children.map((child) => cloneTree(child)),
  };
}

function markMaybeRelevantRoot(node: MarkdownTreeNode): MarkdownTreeNode {
  return {
    ...cloneTree(node),
    relevance: "maybe_relevant",
  };
}

function collectNodeIndex(
  node: MarkdownTreeNode,
  filePath: string
): Record<string, LocalNodeLocation> {
  const ownEntry = node.uuid
    ? {
        [node.uuid]: {
          filePath,
          node,
        },
      }
    : {};

  return node.children.reduce(
    (acc, child) => ({
      ...acc,
      ...collectNodeIndex(child, filePath),
    }),
    ownEntry
  );
}

function collectKnownNodeIds(
  node: MarkdownTreeNode,
  knownIds: Set<string>
): string[] {
  return [
    ...(node.uuid && knownIds.has(node.uuid) ? [node.uuid] : []),
    ...node.children.flatMap((child) => collectKnownNodeIds(child, knownIds)),
  ];
}

function collectGraphAdditionCandidates(
  node: MarkdownTreeNode,
  knownIds: Set<string>,
  targetPathById: Record<string, string>
): GraphAdditionCandidate[] {
  const isKnown = !!node.uuid && knownIds.has(node.uuid);
  const targetPath = node.uuid ? targetPathById[node.uuid] : undefined;

  return node.children.flatMap((child) => {
    const childIsKnown = !!child.uuid && knownIds.has(child.uuid);
    return isKnown && !childIsKnown && node.uuid && targetPath
      ? [
          {
            parentId: node.uuid,
            node: markMaybeRelevantRoot(child),
            sourcePath: "",
            targetPath,
          },
        ]
      : collectGraphAdditionCandidates(child, knownIds, targetPathById);
  });
}

function trimMaybeRelevantTree(
  node: MarkdownTreeNode,
  knownIds: Set<string>,
  insertedRootIds: Set<string>
): MarkdownTreeNode | undefined {
  if (node.uuid && insertedRootIds.has(node.uuid)) {
    return undefined;
  }

  const trimmedChildren = node.children
    .map((child) => trimMaybeRelevantTree(child, knownIds, insertedRootIds))
    .filter((child): child is MarkdownTreeNode => !!child);
  const isKnown = !!node.uuid && knownIds.has(node.uuid);
  const keepNode = !isKnown || trimmedChildren.length > 0;

  return keepNode
    ? {
        ...cloneTree(node),
        relevance: isKnown ? undefined : node.relevance,
        children: trimmedChildren,
      }
    : undefined;
}

function serializeTreeForComparison(node: MarkdownTreeNode): string {
  return normalizeLineEndings(
    buildDocumentEventFromMarkdownTree(DUMMY_PUBKEY, node).event.content
  );
}

function sameCandidate(
  left: GraphAdditionCandidate,
  right: GraphAdditionCandidate
): boolean {
  return (
    left.parentId === right.parentId &&
    serializeTreeForComparison(left.node) ===
      serializeTreeForComparison(right.node)
  );
}

function dedupeGraphCandidates(
  candidates: GraphAdditionCandidate[]
): DuplicateCandidateConflict[] {
  const grouped = candidates.reduce((acc, candidate) => {
    const nodeId = candidate.node.uuid;
    if (!nodeId) {
      return acc;
    }
    const existing = acc[nodeId];
    if (!existing) {
      return {
        ...acc,
        [nodeId]: {
          nodeId,
          conflicting: false,
          candidate,
        },
      };
    }
    if (existing.conflicting || !existing.candidate) {
      return acc;
    }
    return {
      ...acc,
      [nodeId]: sameCandidate(existing.candidate, candidate)
        ? existing
        : {
            nodeId,
            conflicting: true,
          },
    };
  }, {} as Record<string, DuplicateCandidateConflict>);

  return Object.values(grouped);
}

function appendChildByParentId(
  node: MarkdownTreeNode,
  parentId: string,
  childToAppend: MarkdownTreeNode
): MarkdownTreeNode {
  return node.uuid === parentId
    ? {
        ...node,
        children: [...node.children, cloneTree(childToAppend)],
      }
    : {
        ...node,
        children: node.children.map((child) =>
          appendChildByParentId(child, parentId, childToAppend)
        ),
      };
}

async function collectMarkdownFilesRecursively(
  dirPath: string
): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const sortedEntries = entries
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));

  return sortedEntries.reduce(async (previous, entry) => {
    const acc = await previous;
    const nextPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      return [...acc, ...(await collectMarkdownFilesRecursively(nextPath))];
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      return [...acc, nextPath];
    }
    return acc;
  }, Promise.resolve([] as string[]));
}

function hasMissingNodeIds(node: MarkdownTreeNode): boolean {
  return !node.uuid || node.children.some((child) => hasMissingNodeIds(child));
}

function normalizeInboxRoot(
  profile: WorkspaceSaveProfile,
  root: MarkdownTreeNode,
  relativePath: string
): MarkdownTreeNode {
  const normalizedContent = buildDocumentEventFromMarkdownTree(
    profile.pubkey,
    root
  ).event.content;
  const { tree, frontMatter } = parseMarkdownDocument(normalizedContent);
  const title = frontMatter ? extractTitle(frontMatter) : undefined;
  return parseWorkspaceDocumentRoots(tree, title, "", relativePath);
}

async function scanInboxDocuments(
  profile: WorkspaceSaveProfile
): Promise<{ documents: InboxDocument[]; invalidPaths: string[] }> {
  const inboxDir = path.join(profile.workspaceDir, INBOX_DIR);
  const exists = await fs
    .stat(inboxDir)
    .then((stats) => stats.isDirectory())
    .catch(() => false);

  if (!exists) {
    return {
      documents: [],
      invalidPaths: [],
    };
  }

  const markdownFiles = await collectMarkdownFilesRecursively(inboxDir);
  const scanned = await Promise.all(
    markdownFiles.map(async (filePath) => {
      const currentContent = await fs.readFile(filePath, "utf8");
      const relativePath = path.relative(profile.workspaceDir, filePath);
      const { tree, frontMatter } = parseMarkdownDocument(currentContent);
      const title = frontMatter ? extractTitle(frontMatter) : undefined;
      const parsedRoot = parseWorkspaceDocumentRoots(
        tree,
        title,
        "",
        relativePath
      );
      return {
        filePath,
        relativePath,
        mainRoot: normalizeInboxRoot(profile, parsedRoot, relativePath),
      };
    })
  );

  return scanned.reduce(
    (acc, document) =>
      hasMissingNodeIds(document.mainRoot)
        ? {
            ...acc,
            invalidPaths: [...acc.invalidPaths, document.filePath],
          }
        : {
            ...acc,
            documents: [...acc.documents, document],
          },
    {
      documents: [] as InboxDocument[],
      invalidPaths: [] as string[],
    }
  );
}

function makeLocalNodeIndex(
  documents: ScannedWorkspaceDocument[]
): Record<string, LocalNodeLocation> {
  return documents.reduce(
    (acc, document) => ({
      ...acc,
      ...collectNodeIndex(document.mainRoot, document.filePath),
    }),
    {} as Record<string, LocalNodeLocation>
  );
}

function makeUniqueMaybeRelevantPath(
  workspaceDir: string,
  sourcePath: string,
  usedPaths: string[]
): string {
  const baseName = path.basename(sourcePath, ".md") || "incoming";
  const extension = ".md";
  const directory = path.join(workspaceDir, MAYBE_RELEVANT_DIR);
  const candidate = (index: number): string =>
    path.join(
      directory,
      `${baseName}${index === 0 ? "" : `-${index + 1}`}${extension}`
    );
  const pick = (index: number): string => {
    const filePath = candidate(index);
    return usedPaths.includes(filePath) ? pick(index + 1) : filePath;
  };
  return pick(0);
}

function buildLogContent(
  existingContent: string | undefined,
  lines: string[]
): string {
  const baseContent =
    existingContent && existingContent.trim().length > 0
      ? existingContent.replace(/\n*$/u, "\n")
      : "# ~Log\n";
  return `${baseContent}${lines.map((line) => `- ${line}`).join("\n")}\n`;
}

function getDocumentByPath(
  documents: ScannedWorkspaceDocument[],
  filePath: string
): ScannedWorkspaceDocument {
  const document = documents.find((item) => item.filePath === filePath);
  if (!document) {
    throw new Error(`Missing workspace document: ${filePath}`);
  }
  return document;
}

async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function removeInboxFiles(filePaths: string[]): Promise<void> {
  await Promise.all(
    filePaths.map((filePath) => fs.rm(filePath, { force: true }))
  );
}

export async function applyWorkspaceInbox(
  profile: WorkspaceSaveProfile,
  options: {
    dryRun?: boolean;
  } = {}
): Promise<ApplyWorkspaceResult> {
  const localDocuments = await scanWorkspaceDocuments(profile);
  const localIndex = makeLocalNodeIndex(localDocuments);
  const knownIds = new Set(Object.keys(localIndex));
  const targetPathById = Object.fromEntries(
    Object.entries(localIndex).map(([id, value]) => [id, value.filePath])
  );
  const { documents: inboxDocuments, invalidPaths } = await scanInboxDocuments(
    profile
  );

  const classified = inboxDocuments.reduce(
    (acc, document) => {
      const rawGraphCandidates = collectGraphAdditionCandidates(
        document.mainRoot,
        knownIds,
        targetPathById
      ).map((candidate) => ({
        ...candidate,
        sourcePath: document.filePath,
      }));
      const insertedRootIds = new Set(
        rawGraphCandidates
          .map((candidate) => candidate.node.uuid)
          .filter((value): value is string => !!value)
      );
      const maybeRelevantRoot = trimMaybeRelevantTree(
        document.mainRoot,
        knownIds,
        insertedRootIds
      );
      return {
        graphCandidates: [...acc.graphCandidates, ...rawGraphCandidates],
        maybeRelevantCandidates:
          maybeRelevantRoot &&
          maybeRelevantRoot.uuid &&
          !knownIds.has(maybeRelevantRoot.uuid)
            ? [
                ...acc.maybeRelevantCandidates,
                {
                  sourcePath: document.filePath,
                  root: maybeRelevantRoot,
                },
              ]
            : acc.maybeRelevantCandidates,
        skippedExistingIds: [
          ...acc.skippedExistingIds,
          ...collectKnownNodeIds(document.mainRoot, knownIds),
        ],
      };
    },
    {
      graphCandidates: [] as GraphAdditionCandidate[],
      maybeRelevantCandidates: [] as MaybeRelevantCandidate[],
      skippedExistingIds: [] as string[],
    }
  );

  const dedupedGraphCandidates = dedupeGraphCandidates(
    classified.graphCandidates
  );
  const graphCandidates = dedupedGraphCandidates
    .filter((candidate) => !candidate.conflicting && candidate.candidate)
    .map((candidate) => candidate.candidate as GraphAdditionCandidate);
  const conflictingIds = dedupedGraphCandidates
    .filter((candidate) => candidate.conflicting)
    .map((candidate) => candidate.nodeId)
    .sort();
  const graphCandidateIds = graphCandidates
    .map((candidate) => candidate.node.uuid)
    .filter((value): value is string => !!value);
  const skippedExistingIds = [...new Set(classified.skippedExistingIds)].sort();
  const graphAdditionResults = graphCandidates.map((candidate) => ({
    parent_id: candidate.parentId,
    node_id: candidate.node.uuid as string,
    source_path: candidate.sourcePath,
    target_path: candidate.targetPath,
  }));
  const maybeRelevantPlans = classified.maybeRelevantCandidates.reduce(
    (acc, candidate) => {
      const candidateIds = collectNodeIds(candidate.root);
      const usedIds = new Set(acc.usedIds);
      const overlaps = candidateIds.some(
        (id) =>
          knownIds.has(id) ||
          graphCandidateIds.includes(id) ||
          conflictingIds.includes(id) ||
          usedIds.has(id)
      );
      if (overlaps) {
        return acc;
      }
      const filePath = makeUniqueMaybeRelevantPath(
        profile.workspaceDir,
        candidate.sourcePath,
        acc.usedPaths
      );
      return {
        plans: [
          ...acc.plans,
          {
            filePath,
            root: candidate.root,
          },
        ],
        usedIds: [...acc.usedIds, ...candidateIds],
        usedPaths: [...acc.usedPaths, filePath],
      };
    },
    {
      plans: [] as Array<{ filePath: string; root: MarkdownTreeNode }>,
      usedIds: [] as string[],
      usedPaths: [] as string[],
    }
  ).plans;

  if (options.dryRun) {
    return {
      dry_run: true,
      graph_additions: graphAdditionResults,
      maybe_relevant_paths: maybeRelevantPlans.map((plan) => plan.filePath),
      skipped_existing_ids: skippedExistingIds,
      conflicting_ids: conflictingIds,
      invalid_inbox_paths: [...invalidPaths].sort(),
      changed_paths: [],
      cleared_inbox_paths: [],
      ...(graphAdditionResults.length > 0 || maybeRelevantPlans.length > 0
        ? { log_path: path.join(profile.workspaceDir, LOG_FILE) }
        : {}),
    };
  }

  const updatedRootsByPath = graphCandidates.reduce(
    (acc, candidate) => ({
      ...acc,
      [candidate.targetPath]: appendChildByParentId(
        acc[candidate.targetPath] ||
          getDocumentByPath(localDocuments, candidate.targetPath).mainRoot,
        candidate.parentId,
        candidate.node
      ),
    }),
    {} as Record<string, MarkdownTreeNode>
  );

  await Promise.all(
    Object.entries(updatedRootsByPath).map(async ([filePath, root]) => {
      const currentDocument = getDocumentByPath(localDocuments, filePath);
      await fs.writeFile(
        filePath,
        buildDocumentEventFromMarkdownTree(profile.pubkey, {
          ...root,
          frontMatter: currentDocument.frontMatter,
        }).event.content,
        "utf8"
      );
    })
  );

  await ensureDirectory(path.join(profile.workspaceDir, MAYBE_RELEVANT_DIR));
  await Promise.all(
    maybeRelevantPlans.map(({ filePath, root }) =>
      fs.writeFile(
        filePath,
        buildDocumentEventFromMarkdownTree(profile.pubkey, root).event.content,
        "utf8"
      )
    )
  );

  const logPath = path.join(profile.workspaceDir, LOG_FILE);
  const logLines = [
    ...graphAdditionResults.map(
      ({ node_id: nodeId, parent_id: parentId, source_path: sourcePath }) =>
        `applied (?) ${nodeId} under ${parentId} from ${path.relative(
          profile.workspaceDir,
          sourcePath
        )}`
    ),
    ...maybeRelevantPlans.map(
      ({ filePath }) => `created maybe_relevant/${path.basename(filePath)}`
    ),
    ...conflictingIds.map((id) => `conflict on incoming id ${id}`),
    ...invalidPaths.map(
      (filePath) =>
        `skipped invalid inbox file ${path.relative(
          profile.workspaceDir,
          filePath
        )}`
    ),
  ];

  if (logLines.length > 0) {
    const existingLogContent = await fs
      .readFile(logPath, "utf8")
      .catch(() => "");
    await fs.writeFile(
      logPath,
      buildLogContent(existingLogContent, logLines),
      "utf8"
    );
  }

  const saveResult = await saveEditedWorkspaceDocuments(profile);
  const inboxPaths = inboxDocuments.map((document) => document.filePath);
  await removeInboxFiles(inboxPaths);

  return {
    dry_run: false,
    graph_additions: graphAdditionResults,
    maybe_relevant_paths: maybeRelevantPlans.map((plan) => plan.filePath),
    skipped_existing_ids: skippedExistingIds,
    conflicting_ids: conflictingIds,
    invalid_inbox_paths: [...invalidPaths].sort(),
    changed_paths: saveResult.changed_paths,
    cleared_inbox_paths: inboxPaths,
    ...(logLines.length > 0 ? { log_path: logPath } : {}),
  };
}
