import fs from "fs/promises";
import path from "path";
import { embeddedTarget } from "../../core/nodeSpans";
import { renderDocumentMarkdown } from "../../documentRenderer";
import {
  ScannedWorkspaceDocument,
  WorkspaceSaveProfile,
  scanWorkspaceDocuments,
} from "./workspaceScan";

export type SavedWorkspaceDocument = {
  document: ScannedWorkspaceDocument;
  content: string;
  warnings: string[];
};

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
  documents: SavedWorkspaceDocument[];
  changed_paths: string[];
  warnings: string[];
}> {
  const { documents: scannedDocuments, knowledgeDBs } =
    await scanWorkspaceDocuments(profile);
  const documents = scannedDocuments.map((document) => ({
    document,
    content: renderDocumentMarkdown(knowledgeDBs, document),
    warnings: documentWarnings(knowledgeDBs, document),
  }));

  const writes = documents
    .filter(({ document, content }) => document.currentContent !== content)
    .map(({ document, content }) => ({
      filePath: path.join(profile.workspaceDir, document.filePath),
      content,
    }));

  const result = await applyWorkspaceChanges(writes);
  return {
    documents,
    changed_paths: result.changed_paths,
    warnings: documents.flatMap((entry) => entry.warnings),
  };
}
