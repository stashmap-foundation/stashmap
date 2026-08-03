import fs from "fs/promises";
import path from "path";
import { embeddedTarget } from "../../core/nodeSpans";
import { renderDocumentMarkdown } from "../../documentRenderer";
import {
  ScannedWorkspaceDocument,
  WorkspaceSaveProfile,
  scanWorkspaceDocuments,
} from "./workspaceScan";

type NormalizedWorkspaceDocument = {
  filePath: string;
  relativePath: string;
  docId: string;
  normalizedContent: string;
  changed: boolean;
};

function normalizeWorkspaceDocument(
  knowledgeDBs: KnowledgeDBs,
  document: ScannedWorkspaceDocument
): NormalizedWorkspaceDocument {
  // eslint-disable-next-line testing-library/render-result-naming-convention
  const normalizedContent = renderDocumentMarkdown(knowledgeDBs, document);
  return {
    filePath: document.filePath,
    relativePath: document.relativePath,
    docId: document.docId,
    normalizedContent,
    changed: document.currentContent !== normalizedContent,
  };
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

function documentWarnings(
  knowledgeDBs: KnowledgeDBs,
  document: ScannedWorkspaceDocument
): string[] {
  const nodes = knowledgeDBs.get(document.sourceId)?.nodes;
  const roots = document.topNodeShortIds.map((id) => nodes?.get(id));
  const arrangementRoots = roots.filter(
    (root) => embeddedTarget(root) !== undefined
  );

  if (document.docId.startsWith("arr:") && arrangementRoots.length === 0) {
    throw new Error(
      `${document.relativePath}: arr: is reserved for arrangement documents`
    );
  }

  const rootWarnings =
    roots.length === 0
      ? [`${document.relativePath}: shared documents need a root`]
      : [];
  const assetRoots = roots.filter((root) => root?.id.startsWith("asset:"));
  const validAssetRoots = assetRoots.filter(
    (root) => root && /^asset:.+/u.test(root.id)
  );
  const assetWarnings =
    assetRoots.length > 0 &&
    (roots.length !== 1 || validAssetRoots.length !== 1)
      ? [
          `${document.relativePath}: asset entry documents need exactly one asset root`,
        ]
      : [];
  if (!document.docId.startsWith("arr:")) {
    return [...rootWarnings, ...assetWarnings];
  }
  const sourceRoot = document.docId.slice("arr:".length);
  const arrangementWarnings =
    roots.length !== 1 || embeddedTarget(roots[0]) !== sourceRoot
      ? [
          `${document.relativePath}: ${document.docId} must have one root embedding ${sourceRoot}`,
        ]
      : [];
  return [...rootWarnings, ...assetWarnings, ...arrangementWarnings];
}

export async function saveEditedWorkspaceDocuments(
  profile: WorkspaceSaveProfile
): Promise<{
  changed_paths: string[];
  warnings: string[];
}> {
  const { documents: scannedDocuments, knowledgeDBs } =
    await scanWorkspaceDocuments(profile);
  const normalizedDocuments = scannedDocuments.map((document) =>
    normalizeWorkspaceDocument(knowledgeDBs, document)
  );
  const warnings = scannedDocuments.flatMap((document) =>
    documentWarnings(knowledgeDBs, document)
  );

  const writes = normalizedDocuments
    .filter((document) => document.changed)
    .map((document) => ({
      filePath: path.join(profile.workspaceDir, document.filePath),
      content: document.normalizedContent,
    }));

  const result = await applyWorkspaceChanges(writes);
  return { changed_paths: result.changed_paths, warnings };
}
