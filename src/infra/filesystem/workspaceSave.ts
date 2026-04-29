import fs from "fs/promises";
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
  profile: WorkspaceSaveProfile,
  document: ScannedWorkspaceDocument
): NormalizedWorkspaceDocument {
  const rootNode = knowledgeDBs
    .get(profile.pubkey)
    ?.nodes.get(document.rootShortId);
  if (!rootNode) {
    throw new Error(`Materialized root not found for ${document.relativePath}`);
  }
  // eslint-disable-next-line testing-library/render-result-naming-convention
  const normalizedContent = renderDocumentMarkdown(knowledgeDBs, rootNode);
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

export async function saveEditedWorkspaceDocuments(
  profile: WorkspaceSaveProfile
): Promise<{
  changed_paths: string[];
}> {
  const { documents: scannedDocuments, knowledgeDBs } =
    await scanWorkspaceDocuments(profile);
  const normalizedDocuments = scannedDocuments.map((document) =>
    normalizeWorkspaceDocument(knowledgeDBs, profile, document)
  );

  const writes = normalizedDocuments
    .filter((document) => document.changed)
    .map((document) => ({
      filePath: document.filePath,
      content: document.normalizedContent,
    }));

  const result = await applyWorkspaceChanges(writes);
  return { changed_paths: result.changed_paths };
}
