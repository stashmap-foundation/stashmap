import fs from "fs/promises";
import path from "path";
import {
  WorkspaceSaveProfile,
  ScannedWorkspaceDocument,
  NodeIndexState,
  baselineFilePath,
  loadPreviousNodeIndex,
  normalizeWorkspaceDocument,
  scanWorkspaceDocuments,
  validateWorkspaceIntegrity,
  writeNodeIndex,
} from "./workspaceSave";

export type WorkspaceRmResult = {
  removed_files: string[];
  removed_baselines: string[];
  removed_node_ids: string[];
};

type FileTarget = {
  kind: "file";
  raw: string;
  filePath: string;
  relativePath: string;
  docId: string;
  nodeIds: string[];
};

type DocTarget = {
  kind: "doc";
  raw: string;
  docId: string;
  nodeIds: string[];
};

type NodeTarget = {
  kind: "node";
  raw: string;
  nodeId: string;
};

type ResolvedRmTarget = FileTarget | DocTarget | NodeTarget;

function looksLikePath(target: string): boolean {
  return (
    target.includes("/") || target.includes(path.sep) || target.endsWith(".md")
  );
}

function nodeIdsForDocId(nodeIndex: NodeIndexState, docId: string): string[] {
  return Object.entries(nodeIndex.nodes)
    .filter(([, value]) => value === docId)
    .map(([nodeId]) => nodeId);
}

async function resolveFileTarget(
  raw: string,
  workspaceDir: string,
  scannedByPath: Map<string, ScannedWorkspaceDocument>,
  nodeIndex: NodeIndexState
): Promise<FileTarget> {
  const absolute = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(workspaceDir, raw);
  const workspaceRoot = path.resolve(workspaceDir);
  const relativeFromWorkspace = path.relative(workspaceRoot, absolute);
  if (
    relativeFromWorkspace.startsWith("..") ||
    path.isAbsolute(relativeFromWorkspace)
  ) {
    throw new Error(
      `target ${raw}: path is outside of the workspace directory`
    );
  }

  const exists = await fs
    .stat(absolute)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    throw new Error(
      `target ${raw}: no such file. For an already-deleted doc, run \`knowstr rm <docId>\``
    );
  }

  const scanned = scannedByPath.get(absolute);
  if (!scanned) {
    throw new Error(
      `target ${raw}: file is not a knowstr-managed markdown document`
    );
  }

  return {
    kind: "file",
    raw,
    filePath: absolute,
    relativePath: scanned.relativePath,
    docId: scanned.docId,
    nodeIds: nodeIdsForDocId(nodeIndex, scanned.docId),
  };
}

function resolveUuidTarget(
  raw: string,
  nodeIndex: NodeIndexState,
  scannedDocsByDocId: Map<string, ScannedWorkspaceDocument>
): DocTarget | NodeTarget {
  const { nodes } = nodeIndex;
  const matchingNodeIds = nodeIdsForDocId(nodeIndex, raw);
  const isDocId = matchingNodeIds.length > 0;
  const isNodeId = nodes[raw] !== undefined;

  if (isDocId) {
    const scanned = scannedDocsByDocId.get(raw);
    if (scanned) {
      throw new Error(
        `target ${raw}: doc ${raw} still has a workspace file at ${scanned.relativePath}; pass the path instead`
      );
    }
    return {
      kind: "doc",
      raw,
      docId: raw,
      nodeIds: matchingNodeIds,
    };
  }

  if (isNodeId) {
    return {
      kind: "node",
      raw,
      nodeId: raw,
    };
  }

  throw new Error(
    `target ${raw}: no matching doc or node id in the workspace index`
  );
}

async function resolveTargets(
  rawTargets: string[],
  workspaceDir: string,
  scannedDocs: ScannedWorkspaceDocument[],
  nodeIndex: NodeIndexState
): Promise<ResolvedRmTarget[]> {
  const scannedByPath = new Map(scannedDocs.map((doc) => [doc.filePath, doc]));
  const scannedByDocId = new Map(scannedDocs.map((doc) => [doc.docId, doc]));

  const resolveOne = async (raw: string): Promise<ResolvedRmTarget> => {
    if (looksLikePath(raw)) {
      return resolveFileTarget(raw, workspaceDir, scannedByPath, nodeIndex);
    }
    return resolveUuidTarget(raw, nodeIndex, scannedByDocId);
  };

  return Promise.all(rawTargets.map(resolveOne));
}

function applyNodeFilter(
  nodeIndex: NodeIndexState,
  removedNodeIds: Set<string>
): NodeIndexState {
  const filtered = Object.fromEntries(
    Object.entries(nodeIndex.nodes).filter(
      ([nodeId]) => !removedNodeIds.has(nodeId)
    )
  );
  return { version: 1, nodes: filtered };
}

function checkNodeTargetsAbsentFromWorkspace(
  nodeTargets: NodeTarget[],
  workspaceNodeIds: Map<string, string>
): void {
  nodeTargets.forEach((target) => {
    const relativePath = workspaceNodeIds.get(target.nodeId);
    if (relativePath !== undefined) {
      throw new Error(
        `target ${target.raw}: node ${target.nodeId} is still in workspace at ${relativePath}; remove it from the file first`
      );
    }
  });
}

function buildWorkspaceNodeIdMap(
  profile: WorkspaceSaveProfile,
  scannedDocs: ScannedWorkspaceDocument[]
): Map<string, string> {
  return new Map(
    scannedDocs.flatMap((doc) => {
      const normalized = normalizeWorkspaceDocument(profile, doc);
      return [...normalized.activeNodeIds, ...normalized.deletedNodeIds].map(
        (nodeId) => [nodeId, normalized.relativePath] as const
      );
    })
  );
}

export async function runWorkspaceRm(
  profile: WorkspaceSaveProfile,
  rawTargets: string[]
): Promise<WorkspaceRmResult> {
  if (rawTargets.length === 0) {
    throw new Error("knowstr rm requires at least one target");
  }

  const scannedDocs = await scanWorkspaceDocuments(profile);
  const previousNodeIndex = await loadPreviousNodeIndex(profile.knowstrHome);

  const resolvedTargets = await resolveTargets(
    rawTargets,
    profile.workspaceDir,
    scannedDocs,
    previousNodeIndex
  );

  const fileTargets = resolvedTargets.filter(
    (target): target is FileTarget => target.kind === "file"
  );
  const docTargets = resolvedTargets.filter(
    (target): target is DocTarget => target.kind === "doc"
  );
  const nodeTargets = resolvedTargets.filter(
    (target): target is NodeTarget => target.kind === "node"
  );

  const workspaceNodeIds = buildWorkspaceNodeIdMap(profile, scannedDocs);
  checkNodeTargetsAbsentFromWorkspace(nodeTargets, workspaceNodeIds);

  const removedFilePaths = new Set(
    fileTargets.map((target) => target.filePath)
  );
  const removedDocIds = new Set([
    ...fileTargets.map((target) => target.docId),
    ...docTargets.map((target) => target.docId),
  ]);
  const removedNodeIds = new Set<string>([
    ...fileTargets.flatMap((target) => target.nodeIds),
    ...docTargets.flatMap((target) => target.nodeIds),
    ...nodeTargets.map((target) => target.nodeId),
  ]);

  const remainingScannedDocs = scannedDocs.filter(
    (doc) => !removedFilePaths.has(doc.filePath)
  );
  const remainingNormalized = remainingScannedDocs.map((doc) =>
    normalizeWorkspaceDocument(profile, doc)
  );
  const simulatedPreviousNodeIndex = applyNodeFilter(
    previousNodeIndex,
    removedNodeIds
  );

  await validateWorkspaceIntegrity(
    profile.knowstrHome,
    simulatedPreviousNodeIndex,
    remainingNormalized
  );

  await Promise.all(
    [...removedFilePaths].map((filePath) => fs.rm(filePath, { force: true }))
  );
  await Promise.all(
    [...removedDocIds].map((docId) =>
      fs.rm(baselineFilePath(profile.knowstrHome, docId), { force: true })
    )
  );

  await Promise.all(
    remainingNormalized
      .filter((doc) => doc.changed || doc.baselineChanged)
      .map(async (doc) => {
        if (doc.changed) {
          await fs.writeFile(doc.filePath, doc.normalizedContent, "utf8");
        }
        await fs.mkdir(
          path.dirname(baselineFilePath(profile.knowstrHome, doc.docId)),
          {
            recursive: true,
          }
        );
        await fs.writeFile(
          baselineFilePath(profile.knowstrHome, doc.docId),
          doc.normalizedContent,
          "utf8"
        );
      })
  );

  await writeNodeIndex(profile.knowstrHome, simulatedPreviousNodeIndex.nodes);

  return {
    removed_files: [...removedFilePaths],
    removed_baselines: [...removedDocIds],
    removed_node_ids: [...removedNodeIds],
  };
}
