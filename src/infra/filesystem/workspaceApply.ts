import fs from "fs/promises";
import path from "path";
import { Map as ImmutableMap, Set as ImmutableSet, List } from "immutable";
import {
  renderDocumentMarkdown,
  renderRootedMarkdown,
} from "../../documentRenderer";
import { joinID, shortID } from "../../core/connections";
import { parseToDocument } from "../../core/Document";
import { saveEditedWorkspaceDocuments } from "./workspaceSave";
import {
  ScannedWorkspaceDocument,
  WorkspaceSaveProfile,
  scanWorkspaceDocuments,
} from "./workspaceScan";

type InboxDocument = {
  filePath: string;
  relativePath: string;
  nodes: ImmutableMap<string, GraphNode>;
  rootShortId: string;
};

type GraphAddition = {
  parentShortId: string;
  nodeShortId: string;
  sourcePath: string;
  targetPath: string;
  inboxNodes: ImmutableMap<string, GraphNode>;
};

type DuplicateConflict = {
  nodeShortId: string;
  conflicting: boolean;
  addition?: GraphAddition;
};

type MaybeRelevantPlan = {
  filePath: string;
  rootShortId: string;
  nodes: ImmutableMap<string, GraphNode>;
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

async function scanInboxDocuments(
  profile: WorkspaceSaveProfile
): Promise<{ documents: InboxDocument[]; invalidPaths: string[] }> {
  const inboxDir = path.join(profile.workspaceDir, INBOX_DIR);
  const exists = await fs
    .stat(inboxDir)
    .then((stats) => stats.isDirectory())
    .catch(() => false);
  if (!exists) {
    return { documents: [], invalidPaths: [] };
  }

  const markdownFiles = await collectMarkdownFilesRecursively(inboxDir);
  const documents = await Promise.all(
    markdownFiles.map(async (filePath) => {
      const currentContent = await fs.readFile(filePath, "utf8");
      const relativePath = path.relative(profile.workspaceDir, filePath);
      const fallbackTitle = path.basename(relativePath, ".md") || undefined;
      const parsed = parseToDocument(profile.pubkey, currentContent, {
        filePath,
        relativePath,
        ...(fallbackTitle !== undefined ? { fallbackTitle } : {}),
      });
      if (!parsed.document.rootShortId) {
        throw new Error(`Inbox file ${relativePath} has no root`);
      }
      return {
        filePath,
        relativePath,
        nodes: parsed.nodes,
        rootShortId: parsed.document.rootShortId,
      };
    })
  );

  return { documents, invalidPaths: [] };
}

function indexDocumentTree(
  workspaceNodes: ImmutableMap<string, GraphNode>,
  filePath: string,
  shortId: string,
  acc: Record<string, string>
): Record<string, string> {
  if (acc[shortId]) return acc;
  const node = workspaceNodes.get(shortId);
  if (!node) return acc;
  return node.children.reduce(
    (next, childId) =>
      indexDocumentTree(workspaceNodes, filePath, shortID(childId), next),
    { ...acc, [shortId]: filePath }
  );
}

function buildLocalIndex(
  workspaceNodes: ImmutableMap<string, GraphNode>,
  documents: ScannedWorkspaceDocument[]
): {
  knownIds: Set<string>;
  targetPathByShortId: Record<string, string>;
} {
  const targetPathByShortId = documents.reduce(
    (acc, doc) =>
      doc.rootShortId
        ? indexDocumentTree(workspaceNodes, doc.filePath, doc.rootShortId, acc)
        : acc,
    {} as Record<string, string>
  );
  return {
    knownIds: new Set(Object.keys(targetPathByShortId)),
    targetPathByShortId,
  };
}

function makeUniqueMaybeRelevantPath(
  workspaceDir: string,
  sourcePath: string,
  usedPaths: string[]
): string {
  const baseName = path.basename(sourcePath, ".md") || "incoming";
  const directory = path.join(workspaceDir, MAYBE_RELEVANT_DIR);
  const candidate = (index: number): string =>
    path.join(directory, `${baseName}${index === 0 ? "" : `-${index + 1}`}.md`);
  const pick = (index: number): string => {
    const filePath = candidate(index);
    return usedPaths.includes(filePath) ? pick(index + 1) : filePath;
  };
  return pick(0);
}

type Classification = {
  additions: GraphAddition[];
  maybeRelevantPlan?: MaybeRelevantPlan;
  skippedKnownIds: string[];
};

type WalkAcc = {
  additions: GraphAddition[];
  skipped: string[];
  inserted: ImmutableSet<string>;
};

function walkInboxNode(
  inbox: InboxDocument,
  nodeShortId: string,
  parentShortId: string | undefined,
  knownIds: Set<string>,
  targetPathByShortId: Record<string, string>,
  acc: WalkAcc
): WalkAcc {
  const node = inbox.nodes.get(nodeShortId);
  if (!node) return acc;
  if (knownIds.has(nodeShortId)) {
    return node.children.reduce(
      (next, childId) =>
        walkInboxNode(
          inbox,
          shortID(childId),
          nodeShortId,
          knownIds,
          targetPathByShortId,
          next
        ),
      { ...acc, skipped: [...acc.skipped, nodeShortId] }
    );
  }
  const targetPath =
    parentShortId && knownIds.has(parentShortId)
      ? targetPathByShortId[parentShortId]
      : undefined;
  if (parentShortId && targetPath) {
    return {
      ...acc,
      additions: [
        ...acc.additions,
        {
          parentShortId,
          nodeShortId,
          sourcePath: inbox.filePath,
          targetPath,
          inboxNodes: inbox.nodes,
        },
      ],
      inserted: acc.inserted.add(nodeShortId),
    };
  }
  return node.children.reduce(
    (next, childId) =>
      walkInboxNode(
        inbox,
        shortID(childId),
        nodeShortId,
        knownIds,
        targetPathByShortId,
        next
      ),
    acc
  );
}

type TrimAcc = {
  nodes: ImmutableMap<string, GraphNode>;
};

type TrimResult = {
  shortId: string | undefined;
  acc: TrimAcc;
};

function trimMaybeRelevant(
  inbox: InboxDocument,
  nodeShortId: string,
  knownIds: Set<string>,
  inserted: ImmutableSet<string>,
  acc: TrimAcc
): TrimResult {
  if (inserted.has(nodeShortId)) return { shortId: undefined, acc };
  const node = inbox.nodes.get(nodeShortId);
  if (!node) return { shortId: undefined, acc };
  const childResult = node.children.reduce<{
    childIds: string[];
    acc: TrimAcc;
  }>(
    (next, childId) => {
      const result = trimMaybeRelevant(
        inbox,
        shortID(childId),
        knownIds,
        inserted,
        next.acc
      );
      return {
        childIds: result.shortId
          ? [...next.childIds, result.shortId]
          : next.childIds,
        acc: result.acc,
      };
    },
    { childIds: [] as string[], acc }
  );
  const isKnown = knownIds.has(nodeShortId);
  if (isKnown && childResult.childIds.length === 0) {
    return { shortId: undefined, acc: childResult.acc };
  }
  const trimmedNode: GraphNode = {
    ...node,
    children: List(
      childResult.childIds.map((id) => joinID(node.author, id) as ID)
    ),
    ...(isKnown ? { relevance: undefined } : {}),
  };
  return {
    shortId: nodeShortId,
    acc: { nodes: childResult.acc.nodes.set(nodeShortId, trimmedNode) },
  };
}

function classifyInboxDoc(
  inbox: InboxDocument,
  knownIds: Set<string>,
  targetPathByShortId: Record<string, string>,
  workspaceDir: string,
  usedPaths: string[]
): Classification {
  const walked = walkInboxNode(
    inbox,
    inbox.rootShortId,
    undefined,
    knownIds,
    targetPathByShortId,
    {
      additions: [],
      skipped: [],
      inserted: ImmutableSet<string>(),
    }
  );
  const trimmed = trimMaybeRelevant(
    inbox,
    inbox.rootShortId,
    knownIds,
    walked.inserted,
    { nodes: ImmutableMap<string, GraphNode>() }
  );
  const maybeRelevantPlan =
    trimmed.shortId && !knownIds.has(trimmed.shortId)
      ? {
          filePath: makeUniqueMaybeRelevantPath(
            workspaceDir,
            inbox.filePath,
            usedPaths
          ),
          rootShortId: trimmed.shortId,
          nodes: trimmed.acc.nodes,
        }
      : undefined;

  return {
    additions: walked.additions,
    ...(maybeRelevantPlan ? { maybeRelevantPlan } : {}),
    skippedKnownIds: walked.skipped,
  };
}

function renderAdditionSubtree(addition: GraphAddition): string {
  const root = addition.inboxNodes.get(addition.nodeShortId);
  if (!root) return "";
  const dbs: KnowledgeDBs = ImmutableMap<PublicKey, KnowledgeData>().set(
    root.author,
    { nodes: addition.inboxNodes } as KnowledgeData
  );
  return renderRootedMarkdown(dbs, root);
}

function dedupeAdditions(additions: GraphAddition[]): DuplicateConflict[] {
  const grouped = additions.reduce<Record<string, DuplicateConflict>>(
    (acc, addition) => {
      const key = addition.nodeShortId;
      const existing = acc[key];
      if (!existing) {
        return {
          ...acc,
          [key]: { nodeShortId: key, conflicting: false, addition },
        };
      }
      if (existing.conflicting || !existing.addition) return acc;
      const same =
        existing.addition.parentShortId === addition.parentShortId &&
        renderAdditionSubtree(existing.addition) ===
          renderAdditionSubtree(addition);
      return same
        ? acc
        : {
            ...acc,
            [key]: { nodeShortId: key, conflicting: true },
          };
    },
    {}
  );
  return Object.values(grouped);
}

function collectAdditionDescendants(
  addition: GraphAddition,
  workspaceAuthor: PublicKey,
  workspaceRoot: ID
): ImmutableMap<string, GraphNode> {
  const collected = new globalThis.Map<string, GraphNode>();
  const visit = (shortId: string, parent: LongID | undefined): void => {
    const node = addition.inboxNodes.get(shortId);
    if (!node) return;
    const isAdditionRoot = shortId === addition.nodeShortId;
    // eslint-disable-next-line functional/immutable-data
    collected.set(shortId, {
      ...node,
      author: workspaceAuthor,
      root: workspaceRoot,
      ...(parent !== undefined ? { parent } : {}),
      ...(isAdditionRoot ? { relevance: "maybe_relevant" } : {}),
    });
    node.children.forEach((childId) =>
      visit(shortID(childId), node.id as LongID)
    );
  };
  visit(addition.nodeShortId, undefined);
  return ImmutableMap(collected);
}

async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function removeInboxFiles(filePaths: string[]): Promise<void> {
  await Promise.all(
    filePaths.map((filePath) => fs.rm(filePath, { force: true }))
  );
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

export async function applyWorkspaceInbox(
  profile: WorkspaceSaveProfile,
  options: { dryRun?: boolean } = {}
): Promise<ApplyWorkspaceResult> {
  const { documents: localDocuments, knowledgeDBs: workspaceDBs } =
    await scanWorkspaceDocuments(profile);
  const workspaceNodes =
    workspaceDBs.get(profile.pubkey)?.nodes ??
    ImmutableMap<string, GraphNode>();
  const { knownIds, targetPathByShortId } = buildLocalIndex(
    workspaceNodes,
    localDocuments
  );

  const { documents: inboxDocuments, invalidPaths } = await scanInboxDocuments(
    profile
  );

  const classifyAcc = inboxDocuments.reduce(
    (acc, inbox) => {
      const classification = classifyInboxDoc(
        inbox,
        knownIds,
        targetPathByShortId,
        profile.workspaceDir,
        acc.usedMaybeRelevantPaths
      );
      return {
        additions: [...acc.additions, ...classification.additions],
        maybeRelevantPlans: classification.maybeRelevantPlan
          ? [...acc.maybeRelevantPlans, classification.maybeRelevantPlan]
          : acc.maybeRelevantPlans,
        skippedKnownIds: [
          ...acc.skippedKnownIds,
          ...classification.skippedKnownIds,
        ],
        usedMaybeRelevantPaths: classification.maybeRelevantPlan
          ? [
              ...acc.usedMaybeRelevantPaths,
              classification.maybeRelevantPlan.filePath,
            ]
          : acc.usedMaybeRelevantPaths,
      };
    },
    {
      additions: [] as GraphAddition[],
      maybeRelevantPlans: [] as MaybeRelevantPlan[],
      skippedKnownIds: [] as string[],
      usedMaybeRelevantPaths: [] as string[],
    }
  );

  const dedupedAdditions = dedupeAdditions(classifyAcc.additions);
  const additions = dedupedAdditions
    .filter((d) => !d.conflicting && d.addition)
    .map((d) => d.addition as GraphAddition);
  const conflictingIds = dedupedAdditions
    .filter((d) => d.conflicting)
    .map((d) => d.nodeShortId)
    .sort();
  const additionShortIds = new Set(additions.map((a) => a.nodeShortId));
  const skippedExistingIds = [...new Set(classifyAcc.skippedKnownIds)].sort();

  // Filter maybe_relevant plans whose ids overlap with known/added/conflicting.
  const usableMaybeRelevant = classifyAcc.maybeRelevantPlans.filter((plan) => {
    const ids = Array.from(plan.nodes.keys());
    return !ids.some(
      (id) =>
        knownIds.has(id) ||
        additionShortIds.has(id) ||
        conflictingIds.includes(id)
    );
  });

  const graphAdditionResults = additions.map((addition) => ({
    parent_id: addition.parentShortId,
    node_id: addition.nodeShortId,
    source_path: addition.sourcePath,
    target_path: addition.targetPath,
  }));

  if (options.dryRun) {
    return {
      dry_run: true,
      graph_additions: graphAdditionResults,
      maybe_relevant_paths: usableMaybeRelevant.map((plan) => plan.filePath),
      skipped_existing_ids: skippedExistingIds,
      conflicting_ids: conflictingIds,
      invalid_inbox_paths: [...invalidPaths].sort(),
      changed_paths: [],
      cleared_inbox_paths: [],
      ...(graphAdditionResults.length > 0 || usableMaybeRelevant.length > 0
        ? { log_path: path.join(profile.workspaceDir, LOG_FILE) }
        : {}),
    };
  }

  // Apply additions: render each target workspace doc with the candidate appended.
  const additionsByTarget = additions.reduce<Record<string, GraphAddition[]>>(
    (acc, addition) => {
      const list = acc[addition.targetPath] ?? [];
      return { ...acc, [addition.targetPath]: [...list, addition] };
    },
    {}
  );

  await Promise.all(
    Object.entries(additionsByTarget).map(async ([targetPath, group]) => {
      const targetDoc = localDocuments.find((d) => d.filePath === targetPath);
      if (!targetDoc?.rootShortId) return;
      const { rootShortId } = targetDoc;
      const targetRoot = workspaceNodes.get(rootShortId);
      if (!targetRoot) return;
      const updatedNodes = group.reduce((nodes, addition) => {
        const parent = nodes.get(addition.parentShortId);
        if (!parent) return nodes;
        const newDescendants = collectAdditionDescendants(
          addition,
          profile.pubkey,
          targetRoot.root
        );
        const additionRoot = newDescendants.get(addition.nodeShortId);
        if (!additionRoot) return nodes;
        const additionRootWithParent: GraphNode = {
          ...additionRoot,
          parent: parent.id as LongID,
        };
        const merged = nodes
          .merge(newDescendants)
          .set(addition.nodeShortId, additionRootWithParent);
        return merged.set(addition.parentShortId, {
          ...parent,
          children: parent.children.push(
            joinID(profile.pubkey, addition.nodeShortId) as ID
          ),
        });
      }, workspaceNodes);
      const dbs = ImmutableMap<PublicKey, KnowledgeData>().set(profile.pubkey, {
        nodes: updatedNodes,
      } as KnowledgeData);
      // eslint-disable-next-line testing-library/render-result-naming-convention
      const markdown = renderDocumentMarkdown(dbs, targetDoc);
      await fs.writeFile(targetPath, markdown, "utf8");
    })
  );

  await ensureDirectory(path.join(profile.workspaceDir, MAYBE_RELEVANT_DIR));
  await Promise.all(
    usableMaybeRelevant.map(async (plan) => {
      const root = plan.nodes.get(plan.rootShortId);
      if (!root) return;
      const dbs = ImmutableMap<PublicKey, KnowledgeData>().set(root.author, {
        nodes: plan.nodes,
      } as KnowledgeData);
      await fs.writeFile(
        plan.filePath,
        renderRootedMarkdown(dbs, root),
        "utf8"
      );
    })
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
    ...usableMaybeRelevant.map(
      (plan) => `created maybe_relevant/${path.basename(plan.filePath)}`
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
  const inboxPaths = inboxDocuments.map((doc) => doc.filePath);
  await removeInboxFiles(inboxPaths);

  return {
    dry_run: false,
    graph_additions: graphAdditionResults,
    maybe_relevant_paths: usableMaybeRelevant.map((plan) => plan.filePath),
    skipped_existing_ids: skippedExistingIds,
    conflicting_ids: conflictingIds,
    invalid_inbox_paths: [...invalidPaths].sort(),
    changed_paths: saveResult.changed_paths,
    cleared_inbox_paths: inboxPaths,
    ...(logLines.length > 0 ? { log_path: logPath } : {}),
  };
}
