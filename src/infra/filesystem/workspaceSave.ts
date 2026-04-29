import fs from "fs/promises";
import { buildDocumentEventFromMarkdownTree } from "../../standaloneDocumentEvent";
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
  profile: WorkspaceSaveProfile,
  document: ScannedWorkspaceDocument
): NormalizedWorkspaceDocument {
  const rootTree = {
    ...document.mainRoot,
    frontMatter: document.frontMatter,
  };
  const builtEvent = buildDocumentEventFromMarkdownTree(
    profile.pubkey,
    rootTree
  );
  const normalizedContent = builtEvent.event.content;
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
  const scannedDocuments = await scanWorkspaceDocuments(profile);
  const normalizedDocuments = scannedDocuments.map((document) =>
    normalizeWorkspaceDocument(profile, document)
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
